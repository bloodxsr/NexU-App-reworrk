use crate::models::*;
use crate::utils::*;
use crate::*;
use anyhow::Context;
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::{config::Region, primitives::ByteStream, Client as S3Client};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{Datelike, Duration, Utc};
use rand::RngCore;
use regex::Regex;
use scylla::{Session, SessionBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::Duration as StdDuration,
};
use tokio::fs;

pub async fn init_directories() -> anyhow::Result<(PathBuf, PathBuf)> {
    let root = std::env::current_dir().context("failed to get current directory")?;
    let data_dir = root.join("data");
    let uploads_dir = data_dir.join("uploads");
    let resource_uploads_dir = uploads_dir.join("resources");
    std::fs::create_dir_all(&resource_uploads_dir)
        .context("failed to create resource uploads directory")?;
    Ok((uploads_dir, resource_uploads_dir))
}

pub async fn init_s3(resource_uploads_dir: &PathBuf) -> anyhow::Result<(S3Client, String)> {
    let minio_endpoint =
        std::env::var("MINIO_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".to_string());
    let minio_access_key =
        std::env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "nexu_admin".to_string());
    let minio_secret_key =
        std::env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "nexu_secret_123".to_string());
    let bucket_name =
        std::env::var("MINIO_BUCKET").unwrap_or_else(|_| "nexu-resources".to_string());
    let region =
        Region::new(std::env::var("MINIO_REGION").unwrap_or_else(|_| "us-east-1".to_string()));

    let shared_config = aws_config::defaults(BehaviorVersion::latest())
        .region(region.clone())
        .credentials_provider(Credentials::new(
            minio_access_key,
            minio_secret_key,
            None,
            None,
            "nexu-minio",
        ))
        .load()
        .await;
    let s3_config = aws_sdk_s3::config::Builder::from(&shared_config)
        .endpoint_url(minio_endpoint)
        .region(region)
        .force_path_style(true)
        .build();
    let s3_client = S3Client::from_conf(s3_config);

    ensure_bucket_exists(&s3_client, &bucket_name)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    migrate_local_resource_uploads(&s3_client, &bucket_name, resource_uploads_dir)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok((s3_client, bucket_name))
}

pub async fn init_meilisearch() -> anyhow::Result<(Option<String>, Option<String>, String, String)>
{
    let meili_url = std::env::var("MEILI_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty());
    let meili_api_key = std::env::var("MEILI_MASTER_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let meili_resources_index =
        std::env::var("MEILI_INDEX_RESOURCES").unwrap_or_else(|_| "resources".to_string());
    let meili_students_index =
        std::env::var("MEILI_INDEX_STUDENTS").unwrap_or_else(|_| "students".to_string());

    if let Some(ref url) = meili_url {
        let http_client = reqwest::Client::new();
        ensure_meili_resources_index(
            &http_client,
            url,
            meili_api_key.as_deref(),
            &meili_resources_index,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
        ensure_meili_students_index(
            &http_client,
            url,
            meili_api_key.as_deref(),
            &meili_students_index,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    }

    Ok((
        meili_url,
        meili_api_key,
        meili_resources_index,
        meili_students_index,
    ))
}

pub async fn init_postgres() -> anyhow::Result<PgPool> {
    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://nexu_admin:nexu_secret_123@127.0.0.1:5432/nexu".to_string()
    });
    let pg_pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres")?;
    migrate_postgres(&pg_pool).await;
    Ok(pg_pool)
}

pub async fn init_scylla(pg_pool: &PgPool) -> anyhow::Result<Arc<Session>> {
    let uri = std::env::var("SCYLLA_URI").unwrap_or_else(|_| "127.0.0.1:9042".to_string());
    let mut builder = SessionBuilder::new();
    for node in uri.split(',') {
        builder = builder.known_node(node.trim());
    }
    let session = builder
        .build()
        .await
        .context("failed to build scylla session")?;
    let db = Arc::new(session);
    migrate(&db).await;
    let _ = sync_relational_data_from_scylla_to_postgres(&db, pg_pool).await;
    Ok(db)
}

pub async fn migrate(session: &Arc<Session>) {
    let rf = std::env::var("SCYLLA_RF").unwrap_or_else(|_| "3".to_string());
    session
        .query_unpaged(format!("CREATE KEYSPACE IF NOT EXISTS nexu WITH REPLICATION = {{ 'class' : 'NetworkTopologyStrategy', 'datacenter1' : {} }}", rf), ())
        .await
        .expect("create keyspace");
    // Ensure replication factor is up to date for existing keyspaces
    let _ = session.query_unpaged(format!("ALTER KEYSPACE nexu WITH REPLICATION = {{ 'class' : 'NetworkTopologyStrategy', 'datacenter1' : {} }}", rf), ()).await;
    session
        .use_keyspace("nexu", false)
        .await
        .expect("use keyspace");

    let tables = vec![
        "CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text, username text, password text, created_at text)",
        "CREATE TABLE IF NOT EXISTS users_by_email (email text PRIMARY KEY, id text)",
        "CREATE TABLE IF NOT EXISTS users_by_username (username text PRIMARY KEY, id text)",
        "CREATE TABLE IF NOT EXISTS profiles (id text PRIMARY KEY, email text, username text, role text, field_of_study text, semester text, section text, rfid_uid text, created_at text, updated_at text, about_me text, degrees text, resume_url text, payout_details text)",
        "CREATE TABLE IF NOT EXISTS teacher_attendance (teacher_id text, date text, status text, updated_by text, created_at text, updated_at text, PRIMARY KEY (teacher_id, date))",
        "CREATE TABLE IF NOT EXISTS resources (field_of_study text, semester text, section text, created_at text, id text, title text, file_url text, type text, teacher_id text, deadline text, subject text, PRIMARY KEY ((field_of_study, semester, section), created_at)) WITH CLUSTERING ORDER BY (created_at DESC)",
        "CREATE TABLE IF NOT EXISTS submissions (resource_id text, student_id text, id text, file_name text, file_data_url text, created_at text, PRIMARY KEY (resource_id, student_id))",
        "CREATE TABLE IF NOT EXISTS assignments (user_id text, due_date text, id text, title text, description text, status text, created_at text, updated_at text, PRIMARY KEY (user_id, due_date)) WITH CLUSTERING ORDER BY (due_date ASC)",
        "CREATE TABLE IF NOT EXISTS schedules (user_id text, day text, slot text, id text, title text, location text, created_at text, PRIMARY KEY (user_id, day, slot)) WITH CLUSTERING ORDER BY (day ASC, slot ASC)",
        "CREATE TABLE IF NOT EXISTS channels (id text PRIMARY KEY, name text)",
        "CREATE TABLE IF NOT EXISTS channel_messages (channel_id text, created_at text, id text, sender_id text, sender_email text, body text, PRIMARY KEY (channel_id, created_at)) WITH CLUSTERING ORDER BY (created_at ASC)",
        "CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, id text, user_id text, created_at text, expires_at text, last_seen_at text, user_agent text, ip text)",
        "CREATE TABLE IF NOT EXISTS sessions_by_user (user_id text, expires_at text, token_hash text, PRIMARY KEY (user_id, expires_at))",
        "CREATE TABLE IF NOT EXISTS attendance (student_id text, subject text, date text, id text, status text, marked_by text, created_at text, updated_at text, PRIMARY KEY (student_id, subject, date)) WITH CLUSTERING ORDER BY (subject ASC, date DESC)",
        "CREATE TABLE IF NOT EXISTS profiles_by_role (role text, email text, id text, field_of_study text, semester text, section text, username text, created_at text, updated_at text, PRIMARY KEY (role, email)) WITH CLUSTERING ORDER BY (email ASC)",
        "CREATE TABLE IF NOT EXISTS profiles_by_rfid (rfid_uid text PRIMARY KEY, id text, role text)",
        "CREATE TABLE IF NOT EXISTS teacher_subject_access (teacher_id text, field_of_study text, semester text, section text, subject text, updated_by text, updated_at text, PRIMARY KEY (teacher_id, field_of_study, semester, section, subject))",
        "CREATE TABLE IF NOT EXISTS class_home_teacher (field_of_study text, semester text, section text, teacher_id text, updated_by text, updated_at text, PRIMARY KEY ((field_of_study, semester, section)))",
        "CREATE TABLE IF NOT EXISTS home_classes_by_teacher (teacher_id text, field_of_study text, semester text, section text, updated_by text, updated_at text, PRIMARY KEY (teacher_id, field_of_study, semester, section))",
        "CREATE TABLE IF NOT EXISTS notifications (partition text, created_at text, id text, title text, body text, file_url text, author_id text, author_name text, PRIMARY KEY (partition, created_at)) WITH CLUSTERING ORDER BY (created_at DESC)",
        "CREATE TABLE IF NOT EXISTS authorized_students (email text PRIMARY KEY, field_of_study text, semester text, section text)",
        "CREATE TABLE IF NOT EXISTS authorized_teachers (email text PRIMARY KEY)",
        // Class-based schedule & assignments (teacher/admin sets, students view)
        "CREATE TABLE IF NOT EXISTS class_schedules (class_key text, day text, slot text, id text, title text, location text, subject text, teacher_id text, teacher_name text, created_at text, PRIMARY KEY (class_key, day, slot)) WITH CLUSTERING ORDER BY (day ASC, slot ASC)",
        "CREATE TABLE IF NOT EXISTS class_assignments (class_key text, created_at text, id text, title text, description text, due_date text, subject text, teacher_id text, teacher_name text, PRIMARY KEY (class_key, created_at)) WITH CLUSTERING ORDER BY (created_at DESC)",
    ];

    for t in tables {
        session.query_unpaged(t, ()).await.expect("create table");
    }

    let _ = session
        .query_unpaged("ALTER TABLE notifications ADD file_url text", ())
        .await;
    let _ = session
        .query_unpaged("ALTER TABLE resources ADD subject text", ())
        .await;
    let _ = session
        .query_unpaged("ALTER TABLE profiles ADD about_me text", ())
        .await;
    let _ = session
        .query_unpaged("ALTER TABLE profiles ADD degrees text", ())
        .await;
    let _ = session
        .query_unpaged("ALTER TABLE profiles ADD resume_url text", ())
        .await;
    let _ = session
        .query_unpaged("ALTER TABLE profiles ADD payout_details text", ())
        .await;

    // Seed default channels
    for (id, name) in [
        ("announcements", "Announcements"),
        ("faculty-desk", "Faculty Desk"),
        ("project-groups", "Project Groups"),
    ] {
        let _ = session
            .query_unpaged(
                "INSERT INTO channels (id, name) VALUES (?, ?) IF NOT EXISTS",
                (id, name),
            )
            .await;
    }
}

pub async fn migrate_postgres(pg_pool: &PgPool) {
    let ddl = [
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            username TEXT,
            role TEXT NOT NULL,
            field_of_study TEXT,
            semester TEXT,
            section TEXT,
            rfid_uid TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            about_me TEXT,
            degrees TEXT,
            resume_url TEXT,
            payout_details TEXT
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS teacher_subject_access (
            teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            field_of_study TEXT NOT NULL,
            semester TEXT NOT NULL,
            section TEXT NOT NULL,
            subject TEXT NOT NULL,
            updated_by TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (teacher_id, field_of_study, semester, section, subject)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS class_home_teacher (
            field_of_study TEXT NOT NULL,
            semester TEXT NOT NULL,
            section TEXT NOT NULL,
            teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            updated_by TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (field_of_study, semester, section)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS authorized_students (
            email TEXT PRIMARY KEY,
            field_of_study TEXT NOT NULL,
            semester TEXT NOT NULL,
            section TEXT NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS authorized_teachers (
            email TEXT PRIMARY KEY
        )
        "#,
    ];
    for stmt in ddl {
        if let Err(err_msg) = sqlx::query(stmt).execute(pg_pool).await {
            panic!("postgres migration failed: {}", err_msg);
        }
    }
}

pub async fn sync_relational_data_from_scylla_to_postgres(
    session: &Arc<Session>,
    pg_pool: &PgPool,
) -> Result<(), String> {
    let users_res = session
        .query_unpaged(
            "SELECT id, email, username, password, created_at FROM users",
            (),
        )
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rows) = users_res.rows {
        for row in rows {
            if let Ok((id, email, username, password, created_at)) =
                row.into_typed::<(String, String, String, String, String)>()
            {
                sqlx::query(
                    r#"
                    INSERT INTO users (id, email, username, password, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO UPDATE SET
                      email = EXCLUDED.email,
                      username = EXCLUDED.username,
                      password = EXCLUDED.password,
                      created_at = EXCLUDED.created_at
                    "#,
                )
                .bind(id)
                .bind(email)
                .bind(username)
                .bind(password)
                .bind(created_at)
                .execute(pg_pool)
                .await
                .map_err(|err| err.to_string())?;
            }
        }
    }

    let profiles_res = session
        .query_unpaged(
            "SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, created_at, updated_at, about_me, degrees, resume_url, payout_details FROM profiles",
            (),
        )
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rows) = profiles_res.rows {
        for row in rows {
            if let Ok((
                id,
                email,
                username,
                role,
                field_of_study,
                semester,
                section,
                rfid_uid,
                created_at,
                updated_at,
                about_me,
                degrees,
                resume_url,
                payout_details,
            )) = row.into_typed::<(
                String,
                String,
                Option<String>,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
                String,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<String>,
            )>() {
                sqlx::query(
                    r#"
                    INSERT INTO profiles (
                      id, email, username, role, field_of_study, semester, section, rfid_uid,
                      created_at, updated_at, about_me, degrees, resume_url, payout_details
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (id) DO UPDATE SET
                      email = EXCLUDED.email,
                      username = EXCLUDED.username,
                      role = EXCLUDED.role,
                      field_of_study = EXCLUDED.field_of_study,
                      semester = EXCLUDED.semester,
                      section = EXCLUDED.section,
                      rfid_uid = EXCLUDED.rfid_uid,
                      created_at = EXCLUDED.created_at,
                      updated_at = EXCLUDED.updated_at,
                      about_me = EXCLUDED.about_me,
                      degrees = EXCLUDED.degrees,
                      resume_url = EXCLUDED.resume_url,
                      payout_details = EXCLUDED.payout_details
                    "#,
                )
                .bind(id)
                .bind(email)
                .bind(username)
                .bind(role)
                .bind(field_of_study)
                .bind(semester)
                .bind(section)
                .bind(rfid_uid)
                .bind(created_at)
                .bind(updated_at)
                .bind(about_me)
                .bind(degrees)
                .bind(resume_url)
                .bind(payout_details)
                .execute(pg_pool)
                .await
                .map_err(|err| err.to_string())?;
            }
        }
    }

    let subject_res = session
        .query_unpaged(
            "SELECT teacher_id, field_of_study, semester, section, subject, updated_by, updated_at FROM teacher_subject_access",
            (),
        )
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rows) = subject_res.rows {
        for row in rows {
            if let Ok((
                teacher_id,
                field_of_study,
                semester,
                section,
                subject,
                updated_by,
                updated_at,
            )) = row.into_typed::<(String, String, String, String, String, String, String)>()
            {
                sqlx::query(
                    r#"
                    INSERT INTO teacher_subject_access
                      (teacher_id, field_of_study, semester, section, subject, updated_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (teacher_id, field_of_study, semester, section, subject) DO UPDATE SET
                      updated_by = EXCLUDED.updated_by,
                      updated_at = EXCLUDED.updated_at
                    "#,
                )
                .bind(teacher_id)
                .bind(field_of_study)
                .bind(semester)
                .bind(section)
                .bind(subject)
                .bind(updated_by)
                .bind(updated_at)
                .execute(pg_pool)
                .await
                .map_err(|err| err.to_string())?;
            }
        }
    }

    let home_res = session
        .query_unpaged(
            "SELECT field_of_study, semester, section, teacher_id, updated_by, updated_at FROM class_home_teacher",
            (),
        )
        .await
        .map_err(|err| err.to_string())?;
    if let Some(rows) = home_res.rows {
        for row in rows {
            if let Ok((field_of_study, semester, section, teacher_id, updated_by, updated_at)) =
                row.into_typed::<(String, String, String, String, String, String)>()
            {
                sqlx::query(
                    r#"
                    INSERT INTO class_home_teacher
                      (field_of_study, semester, section, teacher_id, updated_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (field_of_study, semester, section) DO UPDATE SET
                      teacher_id = EXCLUDED.teacher_id,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = EXCLUDED.updated_at
                    "#,
                )
                .bind(field_of_study)
                .bind(semester)
                .bind(section)
                .bind(teacher_id)
                .bind(updated_by)
                .bind(updated_at)
                .execute(pg_pool)
                .await
                .map_err(|err| err.to_string())?;
            }
        }
    }

    Ok(())
}

pub async fn ensure_meili_resources_index(
    http_client: &reqwest::Client,
    meili_url: &str,
    meili_api_key: Option<&str>,
    meili_index: &str,
) -> Result<(), String> {
    let create_url = format!("{}/indexes", meili_url.trim_end_matches('/'));
    let create_req = http_client
        .post(create_url)
        .json(&json!({ "uid": meili_index, "primaryKey": "id" }));
    let create_res = meili_request_with_auth(create_req, meili_api_key)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !create_res.status().is_success() && create_res.status().as_u16() != 409 {
        let status = create_res.status();
        let body = create_res.text().await.unwrap_or_default();
        return Err(format!("meili create index failed {} {}", status, body));
    }

    let settings_url = format!(
        "{}/indexes/{}/settings",
        meili_url.trim_end_matches('/'),
        meili_index
    );
    let settings_req = http_client.patch(settings_url).json(&json!({
        "searchableAttributes": ["title", "subject", "type", "created_at"],
        "filterableAttributes": ["field_of_study", "semester", "section", "type", "subject"],
        "sortableAttributes": ["created_at"]
    }));
    let settings_res = meili_request_with_auth(settings_req, meili_api_key)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !settings_res.status().is_success() {
        let status = settings_res.status();
        let body = settings_res.text().await.unwrap_or_default();
        return Err(format!("meili settings update failed {} {}", status, body));
    }
    Ok(())
}

pub async fn ensure_meili_students_index(
    http_client: &reqwest::Client,
    meili_url: &str,
    meili_api_key: Option<&str>,
    meili_index: &str,
) -> Result<(), String> {
    let create_url = format!("{}/indexes", meili_url.trim_end_matches('/'));
    let create_req = http_client
        .post(create_url)
        .json(&json!({ "uid": meili_index, "primaryKey": "id" }));
    let create_res = meili_request_with_auth(create_req, meili_api_key)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !create_res.status().is_success() && create_res.status().as_u16() != 409 {
        let status = create_res.status();
        let body = create_res.text().await.unwrap_or_default();
        return Err(format!("meili create index failed {} {}", status, body));
    }

    let settings_url = format!(
        "{}/indexes/{}/settings",
        meili_url.trim_end_matches('/'),
        meili_index
    );
    let settings_req = http_client.patch(settings_url).json(&json!({
        "searchableAttributes": ["username", "email", "field_of_study", "semester", "section"],
        "filterableAttributes": ["role", "field_of_study", "semester", "section"],
        "sortableAttributes": ["username", "email"]
    }));
    let settings_res = meili_request_with_auth(settings_req, meili_api_key)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !settings_res.status().is_success() {
        let status = settings_res.status();
        let body = settings_res.text().await.unwrap_or_default();
        return Err(format!("meili settings update failed {} {}", status, body));
    }
    Ok(())
}

pub async fn index_resource_document(state: &AppState, resource: &Resource) -> Result<(), String> {
    let Some(meili_url) = state.meili_url.as_deref() else {
        return Ok(());
    };
    let endpoint = format!(
        "{}/indexes/{}/documents",
        meili_url.trim_end_matches('/'),
        state.meili_resources_index
    );
    let payload = vec![resource];
    let request = state.http_client.post(endpoint).json(&payload);
    let response = meili_request_with_auth(request, state.meili_api_key.as_deref())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("meili document index failed {} {}", status, body));
    }
    Ok(())
}

pub async fn index_student_document(state: &AppState, profile: &Profile) -> Result<(), String> {
    if profile.role != "student" {
        return Ok(());
    }
    let Some(meili_url) = state.meili_url.as_deref() else {
        return Ok(());
    };
    let endpoint = format!(
        "{}/indexes/{}/documents",
        meili_url.trim_end_matches('/'),
        state.meili_students_index
    );
    let payload = vec![profile];
    let request = state.http_client.post(endpoint).json(&payload);
    let response = meili_request_with_auth(request, state.meili_api_key.as_deref())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("meili student index failed {} {}", status, body));
    }
    Ok(())
}

pub async fn sync_students_index_from_postgres(state: &AppState) -> Result<(), String> {
    let Some(meili_url) = state.meili_url.as_deref() else {
        return Ok(());
    };
    let rows = sqlx::query(
        "SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, about_me, degrees, resume_url, payout_details FROM profiles WHERE role='student'",
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|err| err.to_string())?;

    let mut profiles: Vec<Profile> = Vec::new();
    for row in rows {
        let profile = Profile {
            id: match row.try_get("id") {
                Ok(v) => v,
                Err(_) => continue,
            },
            email: match row.try_get("email") {
                Ok(v) => v,
                Err(_) => continue,
            },
            username: row.try_get("username").ok().flatten(),
            role: "student".to_string(),
            field_of_study: row.try_get("field_of_study").ok().flatten(),
            semester: row.try_get("semester").ok().flatten(),
            section: row.try_get("section").ok().flatten(),
            rfid_uid: row.try_get("rfid_uid").ok().flatten(),
            about_me: row.try_get("about_me").ok().flatten(),
            degrees: row.try_get("degrees").ok().flatten(),
            resume_url: row.try_get("resume_url").ok().flatten(),
            payout_details: row.try_get("payout_details").ok().flatten(),
        };
        profiles.push(profile);
    }
    if profiles.is_empty() {
        return Ok(());
    }

    let endpoint = format!(
        "{}/indexes/{}/documents",
        meili_url.trim_end_matches('/'),
        state.meili_students_index
    );
    let request = state.http_client.post(endpoint).json(&profiles);
    let response = meili_request_with_auth(request, state.meili_api_key.as_deref())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "meili bulk student index failed {} {}",
            status, body
        ));
    }
    Ok(())
}

pub async fn perform_student_maintenance(state: &AppState) -> anyhow::Result<()> {
    let now = Utc::now();
    let current_year = now.year();
    let current_month = now.month();

    // Fetch all students from Postgres (single source of truth for relational data)
    // Fetch all students from Postgres
    let rows = match sqlx::query(
        "SELECT id, email, role, semester, created_at FROM profiles WHERE role = 'student'",
    )
    .fetch_all(&state.pg_pool)
    .await
    {
        Ok(v) => v,
        Err(_) => return Ok(()), // Skip if table not ready yet
    };

    for row in rows {
        let s_id: String = row.try_get("id").unwrap_or_default();
        let s_email: String = row.try_get("email").unwrap_or_default();
        let s_role: String = row.try_get("role").unwrap_or_default();
        let s_semester: Option<String> = row.try_get("semester").ok();
        let s_created_at: String = row.try_get("created_at").unwrap_or_default();

        let enrollment_date = match chrono::DateTime::parse_from_rfc3339(&s_created_at) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };

        let years_diff = current_year - enrollment_date.year();
        let target_semester_val = (years_diff * 2) + (if current_month >= 8 { 1 } else { 0 });

        let (new_semester, new_role) = if target_semester_val > 8 {
            (Some("8".to_string()), "graduated".to_string())
        } else if target_semester_val <= 0 {
            (Some("1".to_string()), s_role.clone())
        } else {
            (Some(target_semester_val.to_string()), s_role.clone())
        };

        // Update if changed
        if new_semester != s_semester || new_role != s_role {
            let updated_at = now_iso();

            // 1. Update Postgres
            let _ = sqlx::query(
                "UPDATE profiles SET semester = $1, role = $2, updated_at = $3 WHERE id = $4",
            )
            .bind(&new_semester)
            .bind(&new_role)
            .bind(&updated_at)
            .bind(&s_id)
            .execute(&state.pg_pool)
            .await;

            // 2. Update Scylla
            let _ = state
                .db
                .query_unpaged(
                    "UPDATE profiles SET semester = ?, role = ?, updated_at = ? WHERE id = ?",
                    (&new_semester, &new_role, &updated_at, &s_id),
                )
                .await;

            // 3. Update profiles_by_role
            if new_role != s_role {
                let _ = state
                    .db
                    .query_unpaged(
                        "DELETE FROM profiles_by_role WHERE role = ? AND email = ?",
                        (&s_role, &s_email),
                    )
                    .await;
            }

            // Scylla UPDATE on clustering key is not allowed, so we use DELETE/INSERT if needed,
            // but semester is not a key in profiles_by_role primary key, so UPDATE works.
            // Wait, profiles_by_role PK is (role, email). So if role changed, we must DELETE/INSERT.
            let profile = get_profile(state, &s_id).await;
            if let Some(p) = profile {
                let _ = state.db.query_unpaged(
                    "INSERT INTO profiles_by_role (role, email, id, field_of_study, semester, section, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (&new_role, &s_email, &s_id, p.field_of_study, &new_semester, p.section, p.username, s_created_at.clone(), updated_at)
                ).await;
            }

            println!(
                "Maintenance: Updated student {} to semester {} (role: {})",
                s_email,
                new_semester.as_deref().unwrap_or("?"),
                new_role
            );
        }
    }

    Ok(())
}

pub async fn migrate_local_resource_uploads(
    s3_client: &S3Client,
    bucket_name: &str,
    resource_uploads_dir: &PathBuf,
) -> Result<(), String> {
    if !resource_uploads_dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(resource_uploads_dir).map_err(|err| err.to_string())?;
    let mut migrated_count: usize = 0;

    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(object_key) = sanitize_resource_object_key(name) else {
            continue;
        };

        if object_exists_in_bucket(s3_client, bucket_name, &object_key).await {
            continue;
        }

        let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
        upload_object_bytes(
            s3_client,
            bucket_name,
            &object_key,
            bytes,
            Some(infer_content_type(&object_key)),
        )
        .await?;
        migrated_count += 1;
    }

    if migrated_count > 0 {
        println!(
            "migrated {} local resource file(s) to bucket {}",
            migrated_count, bucket_name
        );
    }
    Ok(())
}
