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

pub async fn attendance_for_student(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(student_id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (u, reqp) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    if reqp.role == "student" && reqp.id != student_id {
        return err(StatusCode::FORBIDDEN, "Access denied");
    }
    if reqp.role != "student" && reqp.role != "teacher" && reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Access denied");
    }

    let subject = q
        .get("subject")
        .cloned()
        .unwrap_or_else(|| "ALL".to_string());
    if subject != "ALL" && !valid_subjects().contains(subject.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Invalid subject filter");
    }

    if reqp.role == "teacher" {
        let Some((student_field, student_semester, student_section)) =
            get_student_class_context(&state, &student_id).await
        else {
            return err(StatusCode::NOT_FOUND, "Student not found");
        };

        let subject_access = match fetch_teacher_subject_access(&state, &u.id).await {
            Ok(v) => v,
            Err(e) => return internal_err(e),
        };
        let home_classes = match fetch_teacher_home_classes(&state, &u.id).await {
            Ok(v) => v,
            Err(e) => return internal_err(e),
        };
        let (_class_keys, class_subject_keys, home_class_keys, _allowed_classes) =
            build_teacher_access_summary(&subject_access, &home_classes);

        let student_class_key = class_key(&student_field, &student_semester, &student_section);
        let can_view = if subject == "ALL" {
            home_class_keys.contains(&student_class_key)
        } else {
            home_class_keys.contains(&student_class_key)
                || class_subject_keys.contains(&class_subject_key(
                    &student_field,
                    &student_semester,
                    &student_section,
                    &subject,
                ))
        };

        if !can_view {
            return err(
                StatusCode::FORBIDDEN,
                "Not allowed to view attendance for this student/class",
            );
        }
    }

    let res = if subject == "ALL" {
        match state
            .db
            .execute_unpaged(&state.attendance_by_student_stmt, (&student_id,))
            .await
        {
            Ok(r) => r,
            Err(e) => return internal_err(e),
        }
    } else {
        match state.db.query_unpaged(
            "SELECT student_id, subject, date, id, status, marked_by, created_at, updated_at FROM attendance WHERE student_id=? AND subject=?",
            (&student_id, &subject),
        ).await {
            Ok(r) => r,
            Err(e) => return internal_err(e),
        }
    };

    let mut data = Vec::new();
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok((sid, subj, date, id, status, marked_by, created_at, updated_at)) = row
                .into_typed::<(
                    String,
                    String,
                    String,
                    String,
                    String,
                    String,
                    String,
                    String,
                )>()
            {
                data.push(json!({
                    "id": id,
                    "student_id": sid,
                    "date": date,
                    "subject": subj,
                    "status": status,
                    "marked_by": marked_by,
                    "created_at": created_at,
                    "updated_at": updated_at
                }));
            }
        }
    }

    data.sort_by(|a, b| {
        let ad = a.get("date").and_then(Value::as_str).unwrap_or("");
        let bd = b.get("date").and_then(Value::as_str).unwrap_or("");
        bd.cmp(ad)
    });

    ok(json!({"data": data}))
}

pub async fn attendance_upsert(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "teacher" && reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers can save attendance");
    }

    let records = body
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if records.is_empty() {
        return err(StatusCode::BAD_REQUEST, "records must be a non-empty array");
    }

    let teacher_subject_keys = if reqp.role == "teacher" {
        let subject_access = match fetch_teacher_subject_access(&state, &u.id).await {
            Ok(v) => v,
            Err(e) => return internal_err(e),
        };
        let home_classes = match fetch_teacher_home_classes(&state, &u.id).await {
            Ok(v) => v,
            Err(e) => return internal_err(e),
        };
        let (_class_keys, class_subject_keys, _home_class_keys, _allowed_classes) =
            build_teacher_access_summary(&subject_access, &home_classes);
        class_subject_keys
    } else {
        HashSet::new()
    };

    let mut student_class_cache: HashMap<String, (String, String, String)> = HashMap::new();

    for record in records {
        let student_id = record
            .get("student_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let date = record
            .get("date")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let subject = record
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let status = record
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let marked_by = if reqp.role == "admin" {
            record
                .get("marked_by")
                .and_then(|v| v.as_str())
                .unwrap_or(u.id.as_str())
                .trim()
                .to_string()
        } else {
            u.id.clone()
        };

        if student_id.is_empty()
            || !is_iso_date_only(&date)
            || !valid_subjects().contains(subject.as_str())
        {
            return err(StatusCode::BAD_REQUEST, "Invalid attendance record payload");
        }
        if status != "present" && status != "absent" {
            return err(StatusCode::BAD_REQUEST, "Invalid attendance status");
        }

        if reqp.role == "teacher" {
            let class_ctx = if let Some(existing) = student_class_cache.get(&student_id) {
                existing.clone()
            } else {
                let Some(found) = get_student_class_context(&state, &student_id).await else {
                    return err(
                        StatusCode::BAD_REQUEST,
                        "Invalid student_id in attendance payload",
                    );
                };
                student_class_cache.insert(student_id.clone(), found.clone());
                found
            };

            let subject_key = class_subject_key(&class_ctx.0, &class_ctx.1, &class_ctx.2, &subject);
            if !teacher_subject_keys.contains(&subject_key) {
                return err(
                    StatusCode::FORBIDDEN,
                    "Not allowed to mark attendance for this class/subject",
                );
            }
        }

        let row_id = record
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let id = if row_id.is_empty() { new_id() } else { row_id };

        let now = now_iso();
        if let Err(e) = state.db.query_unpaged(
            "INSERT INTO attendance (student_id, subject, date, id, status, marked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (&student_id, &subject, &date, &id, &status, &marked_by, &now, &now),
        ).await {
            return internal_err(e);
        }
    }

    ok(json!({"ok": true}))
}

pub async fn teacher_attendance_rfid_log(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let uid = body
        .get("uid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let date = body
        .get("date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if uid.is_empty() || date.is_empty() {
        return err(StatusCode::BAD_REQUEST, "uid and date required");
    }

    // Reverse auth using RFID tag from PostgreSQL profile records.
    let teacher_id =
        match sqlx::query("SELECT id FROM profiles WHERE rfid_uid=$1 AND role='teacher' LIMIT 1")
            .bind(&uid)
            .fetch_optional(&state.pg_pool)
            .await
        {
            Ok(Some(row)) => match row.try_get::<String, _>("id") {
                Ok(v) => v,
                Err(_) => return err(StatusCode::NOT_FOUND, "Unregistered Tag"),
            },
            Ok(None) => return err(StatusCode::NOT_FOUND, "Unregistered Tag"),
            Err(e) => return internal_err(e),
        };
    let created_at = now_iso();
    let _ = state.db.query_unpaged("INSERT INTO teacher_attendance (teacher_id, date, status, updated_by, created_at, updated_at) VALUES (?, ?, 'present', 'hardware', ?, ?)", (&teacher_id, &date, &created_at, &created_at)).await;
    ok(json!({"ok": true}))
}

pub async fn teacher_attendance_update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let date = body
        .get("date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if date.is_empty() || status.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Required fields missing");
    }
    let updated = now_iso();
    let _ = state.db.query_unpaged("INSERT INTO teacher_attendance (teacher_id, date, status, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'manual', ?, ?)", (&u.id, &date, &status, &updated, &updated)).await;
    ok(json!({"ok": true}))
}

pub async fn teacher_attendance_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(tid): Path<String>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if u.id != tid {
        return err(StatusCode::FORBIDDEN, "Access Denied");
    }

    let res = match state.db.query_unpaged("SELECT teacher_id, date, status, updated_by, created_at, updated_at FROM teacher_attendance WHERE teacher_id=?", (&tid.to_string(),)).await {
        Ok(r) => r,
        Err(e) => return internal_err(e)
    };

    let mut data = Vec::new();
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok((_tid, date, status, updated_by, created, updated)) =
                row.into_typed::<(String, String, String, Option<String>, String, String)>()
            {
                data.push(json!({"id": format!("{}-{}", &tid, &date), "teacher_id": &tid, "date": date, "status": status, "updated_by": updated_by, "created_at": created, "updated_at": updated}));
            }
        }
    }
    ok(json!({"data": data}))
}
