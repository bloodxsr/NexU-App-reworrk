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

pub async fn admin_get_teacher_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(teacher_id): Path<String>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(
            StatusCode::FORBIDDEN,
            "Only admins can manage teacher access",
        );
    }

    let Some(target_profile) = get_profile(&state, &teacher_id).await else {
        return err(StatusCode::NOT_FOUND, "Teacher profile not found");
    };
    if target_profile.role != "teacher" {
        return err(StatusCode::BAD_REQUEST, "Target user is not a teacher");
    }

    match build_teacher_access_payload(&state, &teacher_id).await {
        Ok(data) => ok(json!({"data": data})),
        Err(e) => internal_err(e),
    }
}

pub async fn admin_add_teacher_subject_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(teacher_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(
            StatusCode::FORBIDDEN,
            "Only admins can manage teacher access",
        );
    }

    let Some(target_profile) = get_profile(&state, &teacher_id).await else {
        return err(StatusCode::NOT_FOUND, "Teacher profile not found");
    };
    if target_profile.role != "teacher" {
        return err(StatusCode::BAD_REQUEST, "Target user is not a teacher");
    }

    let field_input = body
        .get("field_of_study")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let semester_input = body.get("semester").and_then(|v| v.as_str()).unwrap_or("");
    let section_input = body.get("section").and_then(|v| v.as_str()).unwrap_or("");
    let subject_input = body.get("subject").and_then(|v| v.as_str()).unwrap_or("");

    let Some((field_of_study, semester, section)) =
        normalize_class_triplet(field_input, semester_input, section_input)
    else {
        return err(StatusCode::BAD_REQUEST, "Invalid class selector");
    };
    let Some(subject) = canonical_subject(subject_input) else {
        return err(StatusCode::BAD_REQUEST, "Invalid subject");
    };

    let updated_at = now_iso();
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO teacher_subject_access
          (teacher_id, field_of_study, semester, section, subject, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (teacher_id, field_of_study, semester, section, subject)
        DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(&teacher_id)
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .bind(&subject)
    .bind(&u.id)
    .bind(&updated_at)
    .execute(&state.pg_pool)
    .await
    {
        return internal_err(e);
    }

    ok(json!({"ok": true}))
}

pub async fn admin_remove_teacher_subject_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(teacher_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(
            StatusCode::FORBIDDEN,
            "Only admins can manage teacher access",
        );
    }

    let Some(target_profile) = get_profile(&state, &teacher_id).await else {
        return err(StatusCode::NOT_FOUND, "Teacher profile not found");
    };
    if target_profile.role != "teacher" {
        return err(StatusCode::BAD_REQUEST, "Target user is not a teacher");
    }

    let field_input = body
        .get("field_of_study")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let semester_input = body.get("semester").and_then(|v| v.as_str()).unwrap_or("");
    let section_input = body.get("section").and_then(|v| v.as_str()).unwrap_or("");
    let subject_input = body.get("subject").and_then(|v| v.as_str()).unwrap_or("");

    let Some((field_of_study, semester, section)) =
        normalize_class_triplet(field_input, semester_input, section_input)
    else {
        return err(StatusCode::BAD_REQUEST, "Invalid class selector");
    };
    let Some(subject) = canonical_subject(subject_input) else {
        return err(StatusCode::BAD_REQUEST, "Invalid subject");
    };

    if let Err(e) = sqlx::query(
        "DELETE FROM teacher_subject_access WHERE teacher_id=$1 AND field_of_study=$2 AND semester=$3 AND section=$4 AND subject=$5",
    )
    .bind(&teacher_id)
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .bind(&subject)
    .execute(&state.pg_pool)
    .await
    {
        return internal_err(e);
    }

    ok(json!({"ok": true}))
}

pub async fn admin_assign_home_teacher_class(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(teacher_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(
            StatusCode::FORBIDDEN,
            "Only admins can manage teacher access",
        );
    }

    let Some(target_profile) = get_profile(&state, &teacher_id).await else {
        return err(StatusCode::NOT_FOUND, "Teacher profile not found");
    };
    if target_profile.role != "teacher" {
        return err(StatusCode::BAD_REQUEST, "Target user is not a teacher");
    }

    let field_input = body
        .get("field_of_study")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let semester_input = body.get("semester").and_then(|v| v.as_str()).unwrap_or("");
    let section_input = body.get("section").and_then(|v| v.as_str()).unwrap_or("");

    let Some((field_of_study, semester, section)) =
        normalize_class_triplet(field_input, semester_input, section_input)
    else {
        return err(StatusCode::BAD_REQUEST, "Invalid class selector");
    };

    let _previous_teacher_id: Option<String> = match sqlx::query(
        "SELECT teacher_id FROM class_home_teacher WHERE field_of_study=$1 AND semester=$2 AND section=$3 LIMIT 1",
    )
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .fetch_optional(&state.pg_pool)
    .await
    {
        Ok(Some(row)) => row.try_get("teacher_id").ok(),
        Ok(None) => None,
        Err(e) => return internal_err(e),
    };

    let updated_at = now_iso();
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO class_home_teacher (field_of_study, semester, section, teacher_id, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (field_of_study, semester, section)
        DO UPDATE SET teacher_id = EXCLUDED.teacher_id, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .bind(&teacher_id)
    .bind(&u.id)
    .bind(&updated_at)
    .execute(&state.pg_pool)
    .await
    {
        return internal_err(e);
    }

    ok(json!({"ok": true}))
}

pub async fn admin_remove_home_teacher_class(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(teacher_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(
            StatusCode::FORBIDDEN,
            "Only admins can manage teacher access",
        );
    }

    let Some(target_profile) = get_profile(&state, &teacher_id).await else {
        return err(StatusCode::NOT_FOUND, "Teacher profile not found");
    };
    if target_profile.role != "teacher" {
        return err(StatusCode::BAD_REQUEST, "Target user is not a teacher");
    }

    let field_input = body
        .get("field_of_study")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let semester_input = body.get("semester").and_then(|v| v.as_str()).unwrap_or("");
    let section_input = body.get("section").and_then(|v| v.as_str()).unwrap_or("");

    let Some((field_of_study, semester, section)) =
        normalize_class_triplet(field_input, semester_input, section_input)
    else {
        return err(StatusCode::BAD_REQUEST, "Invalid class selector");
    };

    let assigned_teacher_id: Option<String> = match sqlx::query(
        "SELECT teacher_id FROM class_home_teacher WHERE field_of_study=$1 AND semester=$2 AND section=$3 LIMIT 1",
    )
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .fetch_optional(&state.pg_pool)
    .await
    {
        Ok(Some(row)) => row.try_get("teacher_id").ok(),
        Ok(None) => None,
        Err(e) => return internal_err(e),
    };

    if assigned_teacher_id.as_deref().is_none() {
        return ok(json!({"ok": true}));
    }
    if assigned_teacher_id.as_deref() != Some(teacher_id.as_str()) {
        return err(
            StatusCode::CONFLICT,
            "Class is assigned to a different home teacher",
        );
    }

    if let Err(e) = sqlx::query(
        "DELETE FROM class_home_teacher WHERE field_of_study=$1 AND semester=$2 AND section=$3",
    )
    .bind(&field_of_study)
    .bind(&semester)
    .bind(&section)
    .execute(&state.pg_pool)
    .await
    {
        return internal_err(e);
    }

    ok(json!({"ok": true}))
}

pub async fn admin_upload_student_whitelist(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let (_, reqp) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Admin access required");
    }

    let content = String::from_utf8_lossy(&body);
    let mut lines = content.lines();

    let header = match lines.next() {
        Some(h) => h,
        None => return err(StatusCode::BAD_REQUEST, "Empty CSV file"),
    };

    let cols: Vec<String> = header.split(',').map(|s| s.trim().to_lowercase()).collect();

    let email_idx = cols.iter().position(|c| c.contains("email"));
    let field_idx = cols
        .iter()
        .position(|c| c.contains("field") || c.contains("branch") || c.contains("course"));
    let sem_idx = cols
        .iter()
        .position(|c| c.contains("semester") || c.contains("sem"));
    let sec_idx = cols
        .iter()
        .position(|c| c.contains("section") || c.contains("sec"));

    if email_idx.is_none() || field_idx.is_none() || sem_idx.is_none() || sec_idx.is_none() {
        return err(
            StatusCode::BAD_REQUEST,
            "CSV missing required headers (email, field, semester, section)",
        );
    }

    let e_idx = email_idx.unwrap();
    let f_idx = field_idx.unwrap();
    let sm_idx = sem_idx.unwrap();
    let sc_idx = sec_idx.unwrap();

    let mut count = 0;
    for line in lines {
        let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if parts.len() > e_idx
            && parts.len() > f_idx
            && parts.len() > sm_idx
            && parts.len() > sc_idx
        {
            let email = parts[e_idx].to_lowercase();
            let raw_field = parts[f_idx];
            let semester = parts[sm_idx];
            let section = parts[sc_idx].to_uppercase();

            let field = normalize_branch(raw_field);
            if !valid_branches().contains(field.as_str()) {
                continue; // Skip invalid branches or handle as error
            }

            let _ = sqlx::query(
                "INSERT INTO authorized_students (email, field_of_study, semester, section) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET field_of_study=$2, semester=$3, section=$4"
            )
            .bind(&email)
            .bind(&field)
            .bind(semester)
            .bind(&section)
            .execute(&state.pg_pool).await;

            let _ = state.db.query_unpaged(
                "INSERT INTO authorized_students (email, field_of_study, semester, section) VALUES (?, ?, ?, ?)",
                (email, field, semester, section)
            ).await;

            count += 1;
        }
    }

    ok(
        json!({"success": true, "message": format!("Auto-extracted and uploaded {} students to whitelist", count)}),
    )
}

pub async fn admin_upload_teacher_whitelist(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let (_, reqp) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Admin access required");
    }

    let content = String::from_utf8_lossy(&body);
    let mut count = 0;

    // CSV format: email
    for line in content.lines().skip(1) {
        // Skip header
        let email = line.trim().to_lowercase();
        if !email.is_empty() {
            let _ = sqlx::query(
                "INSERT INTO authorized_teachers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING"
            )
            .bind(&email)
            .execute(&state.pg_pool).await;

            let _ = state
                .db
                .query_unpaged(
                    "INSERT INTO authorized_teachers (email) VALUES (?)",
                    (email,),
                )
                .await;

            count += 1;
        }
    }

    ok(json!({"success": true, "message": format!("Uploaded {} teachers to whitelist", count)}))
}
