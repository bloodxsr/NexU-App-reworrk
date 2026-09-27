use anyhow::Context;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::{config::Region, primitives::ByteStream, Client as S3Client};
use chrono::Datelike;
use chrono::{Duration, Utc};
use rand::RngCore;
use regex::Regex;
use scylla::{Session, SessionBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration as StdDuration,
};
use tokio::fs;
use tower_http::services::ServeDir;

pub mod admin;
pub mod attendance;
pub mod auth;
pub mod mock;
mod models;
pub mod profiles;
pub mod resources;
pub mod setup;
pub mod teacher;
pub mod utils;

pub use admin::*;
pub use attendance::*;
pub use auth::*;
pub use mock::*;
use models::*;
pub use profiles::*;
pub use resources::*;
pub use setup::*;
pub use teacher::*;
pub use utils::*;

#[allow(dead_code)]
const MAX_FILE_DATA_URL_LEN: usize = 12 * 1024 * 1024;
#[allow(dead_code)]
const MAX_RESOURCE_DATA_URL_LEN: usize = 16 * 1024 * 1024;
const RESOURCE_UPLOADS_PREFIX: &str = "/uploads/resources/";

#[derive(Clone)]
#[allow(dead_code)]
struct AppState {
    db: Arc<Session>,
    auth_attempts: Arc<Mutex<HashMap<String, AttemptState>>>,
    uploads_dir: PathBuf,
    resource_uploads_dir: PathBuf,
    http_client: reqwest::Client,
    get_profile_stmt: scylla::prepared_statement::PreparedStatement,
    session_user_stmt: scylla::prepared_statement::PreparedStatement,
    user_by_id_stmt: scylla::prepared_statement::PreparedStatement,
    list_resources_stmt: scylla::prepared_statement::PreparedStatement,
    insert_resource_stmt: scylla::prepared_statement::PreparedStatement,
    list_notifications_stmt: scylla::prepared_statement::PreparedStatement,
    insert_notification_stmt: scylla::prepared_statement::PreparedStatement,
    list_students_stmt: scylla::prepared_statement::PreparedStatement,
    attendance_by_student_stmt: scylla::prepared_statement::PreparedStatement,
    list_class_schedule_stmt: scylla::prepared_statement::PreparedStatement,
    insert_class_schedule_stmt: scylla::prepared_statement::PreparedStatement,
    delete_class_schedule_stmt: scylla::prepared_statement::PreparedStatement,
    list_class_assignments_stmt: scylla::prepared_statement::PreparedStatement,
    insert_class_assignment_stmt: scylla::prepared_statement::PreparedStatement,
    delete_class_assignment_stmt: scylla::prepared_statement::PreparedStatement,
    s3_client: S3Client,
    bucket_name: String,
    pg_pool: PgPool,
    meili_url: Option<String>,
    meili_api_key: Option<String>,
    meili_resources_index: String,
    meili_students_index: String,
    session_ttl_hours: i64,
    max_auth_attempts: u32,
    auth_window_secs: i64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3001);
    let (uploads_dir, resource_uploads_dir) = init_directories().await?;

    let (s3_client, bucket_name) = init_s3(&resource_uploads_dir).await?;

    let (meili_url, meili_api_key, meili_resources_index, meili_students_index) =
        init_meilisearch().await?;
    let pg_pool = init_postgres().await?;

    let db = init_scylla(&pg_pool).await?;

    let get_profile_stmt = db.prepare("SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, about_me, degrees, resume_url, payout_details FROM profiles WHERE id=?").await.expect("prepare profile query");
    let session_user_stmt = db
        .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash=?")
        .await
        .expect("prepare session query");
    let user_by_id_stmt = db
        .prepare("SELECT id, email, username, password, created_at FROM users WHERE id=?")
        .await
        .expect("prepare user query");
    let list_resources_stmt = db.prepare("SELECT field_of_study, semester, section, created_at, id, title, file_url, type AS resource_type, teacher_id, deadline, subject FROM resources WHERE field_of_study=? AND semester=? AND section=?").await.expect("prepare resources query");
    let insert_resource_stmt = db.prepare("INSERT INTO resources (field_of_study, semester, section, created_at, id, title, file_url, type, teacher_id, deadline, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").await.expect("prepare insert resource");
    let list_notifications_stmt = db.prepare("SELECT id, title, body, file_url, author_id, author_name, created_at FROM notifications WHERE partition='global'").await.expect("prepare list notifications");
    let insert_notification_stmt = db.prepare("INSERT INTO notifications (partition, created_at, id, title, body, file_url, author_id, author_name) VALUES ('global', ?, ?, ?, ?, ?, ?, ?)").await.expect("prepare insert notification");
    let list_students_stmt = db.prepare("SELECT id, email, username, role, field_of_study, semester, section, created_at, updated_at FROM profiles_by_role WHERE role='student'").await.expect("prepare list students");
    let attendance_by_student_stmt = db.prepare("SELECT student_id, subject, date, id, status, marked_by, created_at, updated_at FROM attendance WHERE student_id=?").await.expect("prepare attendance query");
    let list_class_schedule_stmt = db.prepare("SELECT class_key, day, slot, id, title, location, subject, teacher_id, teacher_name, created_at FROM class_schedules WHERE class_key=?").await.expect("prepare list class schedule");
    let insert_class_schedule_stmt = db.prepare("INSERT INTO class_schedules (class_key, day, slot, id, title, location, subject, teacher_id, teacher_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").await.expect("prepare insert class schedule");
    let delete_class_schedule_stmt = db.prepare("DELETE FROM class_schedules WHERE class_key=? AND day=? AND slot=?").await.expect("prepare delete class schedule");
    let list_class_assignments_stmt = db.prepare("SELECT class_key, created_at, id, title, description, due_date, subject, teacher_id, teacher_name FROM class_assignments WHERE class_key=?").await.expect("prepare list class assignments");
    let insert_class_assignment_stmt = db.prepare("INSERT INTO class_assignments (class_key, created_at, id, title, description, due_date, subject, teacher_id, teacher_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").await.expect("prepare insert class assignment");
    let delete_class_assignment_stmt = db.prepare("DELETE FROM class_assignments WHERE class_key=? AND created_at=?").await.expect("prepare delete class assignment");
    let http_client = reqwest::Client::new();

    if let Some(url) = &meili_url {
        if let Err(err_msg) = ensure_meili_resources_index(
            &http_client,
            url,
            meili_api_key.as_deref(),
            &meili_resources_index,
        )
        .await
        {
            eprintln!(
                "warning: failed to prepare meilisearch resources index: {}",
                err_msg
            );
        }
        if let Err(err_msg) = ensure_meili_students_index(
            &http_client,
            url,
            meili_api_key.as_deref(),
            &meili_students_index,
        )
        .await
        {
            eprintln!(
                "warning: failed to prepare meilisearch students index: {}",
                err_msg
            );
        }
    }

    let state = AppState {
        db,
        auth_attempts: Arc::new(Mutex::new(HashMap::new())),
        uploads_dir,
        resource_uploads_dir,
        http_client,
        get_profile_stmt,
        session_user_stmt,
        user_by_id_stmt,
        list_resources_stmt,
        insert_resource_stmt,
        list_notifications_stmt,
        insert_notification_stmt,
        list_students_stmt,
        attendance_by_student_stmt,
        list_class_schedule_stmt,
        insert_class_schedule_stmt,
        delete_class_schedule_stmt,
        list_class_assignments_stmt,
        insert_class_assignment_stmt,
        delete_class_assignment_stmt,
        s3_client,
        bucket_name,
        pg_pool,
        meili_url,
        meili_api_key,
        meili_resources_index,
        meili_students_index,
        session_ttl_hours: std::env::var("SESSION_TTL_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(336), // 24 * 14
        max_auth_attempts: std::env::var("MAX_AUTH_ATTEMPTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(25),
        auth_window_secs: std::env::var("AUTH_WINDOW_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(900), // 60 * 15
    };
    if let Err(err_msg) = sync_students_index_from_postgres(&state).await {
        eprintln!(
            "warning: failed to bootstrap student search index: {}",
            err_msg
        );
    }

    // Spawn maintenance loop
    let maintenance_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(StdDuration::from_secs(86400)); // 24 hours
        loop {
            interval.tick().await;
            if let Err(e) = perform_student_maintenance(&maintenance_state).await {
                eprintln!("Maintenance error: {}", e);
            }
        }
    });

    let api = Router::new()
        .route("/auth/signup", post(auth_signup))
        .route("/auth/signin", post(auth_signin))
        .route("/auth/session", get(auth_session))
        .route("/auth/signout", post(auth_signout))
        .route("/profiles/students", get(list_students))
        .route("/profiles", get(list_all_profiles))
        .route("/profiles/:id", get(profile_by_id))
        .route("/profiles/teacher/access", get(teacher_my_access))
        .route(
            "/attendance/student/:student_id",
            get(attendance_for_student),
        )
        .route("/attendance/upsert", post(attendance_upsert))
        .route(
            "/admin/teacher-access/:teacher_id",
            get(admin_get_teacher_access),
        )
        .route(
            "/admin/teacher-access/:teacher_id/subject",
            post(admin_add_teacher_subject_access),
        )
        .route(
            "/admin/teacher-access/:teacher_id/subject/remove",
            post(admin_remove_teacher_subject_access),
        )
        .route(
            "/admin/teacher-access/:teacher_id/home",
            post(admin_assign_home_teacher_class),
        )
        .route(
            "/admin/teacher-access/:teacher_id/home/remove",
            post(admin_remove_home_teacher_class),
        )
        .route("/resources", get(list_resources).post(create_resource))
        .route("/uploads/resources", put(upload_resource_pdf))
        .route(
            "/admin/whitelist/students",
            post(admin_upload_student_whitelist),
        )
        .route(
            "/admin/whitelist/teachers",
            post(admin_upload_teacher_whitelist),
        )
        .route("/submissions", post(create_submission))
        .route(
            "/assignments",
            get(list_assignments).post(create_assignment),
        )
        .route("/assignments/:id", patch(update_assignment))
        .route("/schedule", get(list_schedule).post(create_schedule))
        .route("/schedule/:id", delete(delete_schedule))
        .route(
            "/teacher_attendance/rfid_log",
            post(teacher_attendance_rfid_log),
        )
        .route(
            "/teacher_attendance/update",
            post(teacher_attendance_update),
        )
        .route(
            "/teacher_attendance/:teacher_id",
            get(teacher_attendance_get),
        )
        .route("/profiles/:id/rfid", post(profile_link_rfid))
        .route("/profiles/:id/meta", post(profile_update_meta))
        .route(
            "/notifications",
            get(list_notifications).post(create_notification),
        )
        .route("/channels", get(list_channels))
        .route(
            "/channels/:id/messages",
            get(list_messages).post(post_message),
        );
    let max_api_body_bytes: usize = std::env::var("MAX_API_BODY_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20 * 1024 * 1024);

    let api = api.layer(DefaultBodyLimit::max(max_api_body_bytes));

    let app = Router::new()
        .nest("/api", api)
        .route("/uploads/resources/:object_key", get(get_resource_file))
        .nest_service("/uploads", ServeDir::new("data/uploads"))
        .fallback_service(ServeDir::new("dist").append_index_html_on_directories(true))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Nexu Rust server running on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
    Ok(())
}
