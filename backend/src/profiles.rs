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

pub async fn list_students(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (u, _) = match require_teacher(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    let requested_field = q.get("field").cloned().unwrap_or_else(|| "ALL".to_string());
    let field_filter = normalize_branch(&requested_field);
    let should_filter_by_field =
        !requested_field.trim().eq_ignore_ascii_case("ALL") && !field_filter.is_empty();
    let search_query = q
        .get("q")
        .map(|value| value.trim().to_lowercase())
        .unwrap_or_default();
    let page: i64 = q.get("page").and_then(|v| v.parse().ok()).unwrap_or(1);
    let page_size: i64 = q
        .get("page_size")
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);
    let offset = (page - 1) * page_size;

    let subject_access = match fetch_teacher_subject_access(&state, &u.id).await {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let home_classes = match fetch_teacher_home_classes(&state, &u.id).await {
        Ok(v) => v,
        Err(e) => return internal_err(e),
    };
    let (allowed_class_keys, _allowed_class_subject_keys, _home_class_keys, _allowed_classes) =
        build_teacher_access_summary(&subject_access, &home_classes);

    if allowed_class_keys.is_empty() {
        return ok(json!({"data": []}));
    }

    let mut candidates: Vec<Profile> = if !search_query.is_empty() && state.meili_url.is_some() {
        match search_students_in_meili(
            &state,
            &search_query,
            if should_filter_by_field {
                Some(field_filter.as_str())
            } else {
                None
            },
        )
        .await
        {
            Ok(items) if !items.is_empty() => items,
            Ok(_) | Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    if candidates.is_empty() {
        let rows = match sqlx::query(
            "SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, about_me, degrees, resume_url, payout_details FROM profiles WHERE role='student' LIMIT $1 OFFSET $2",
        )
        .bind(page_size)
        .bind(offset)
        .fetch_all(&state.pg_pool)
        .await
        {
            Ok(v) => v,
            Err(e) => return internal_err(e),
        };
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
            candidates.push(profile);
        }
    }

    let mut data = Vec::new();
    for p in candidates {
        let Some(field_of_study_val) = p.field_of_study.clone() else {
            continue;
        };
        let Some(semester_val) = p.semester.clone() else {
            continue;
        };
        let Some(section_val) = p.section.clone() else {
            continue;
        };

        let Some((norm_field, norm_sem, norm_sec)) =
            normalize_class_triplet(&field_of_study_val, &semester_val, &section_val)
        else {
            continue;
        };

        if should_filter_by_field && norm_field != field_filter {
            continue;
        }

        let student_class_key = class_key(&norm_field, &norm_sem, &norm_sec);
        if !allowed_class_keys.contains(&student_class_key) {
            continue;
        }

        if !search_query.is_empty() {
            let hay = format!(
                "{} {} {} {} {} {}",
                p.email.to_lowercase(),
                p.id.to_lowercase(),
                p.username.clone().unwrap_or_default().to_lowercase(),
                norm_field.to_lowercase(),
                norm_sem.to_lowercase(),
                norm_sec.to_lowercase()
            );
            if !hay.contains(&search_query) {
                continue;
            }
        }

        data.push(p);
    }
    ok(json!({"data": data}))
}

pub async fn profile_by_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "teacher" && reqp.id != id {
        return err(StatusCode::FORBIDDEN, "Access denied");
    }

    let Some(p) = get_profile(&state, &id).await else {
        return ok(json!({"data": Value::Null}));
    };
    ok(json!({"data": json!({
        "id": p.id, "email": p.email, "username": p.username, "role": p.role, "field_of_study": p.field_of_study, 
        "semester": p.semester, "section": p.section, "about_me": p.about_me, "degrees": p.degrees, 
        "resume_url": p.resume_url, "payout_details": p.payout_details
    }) }))
}

pub async fn profile_link_rfid(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" && u.id != id {
        return err(StatusCode::FORBIDDEN, "Access denied");
    }
    let Some(target_profile) = get_profile(&state, &id).await else {
        return err(StatusCode::NOT_FOUND, "Profile not found");
    };
    let rfid = body
        .get("rfid_uid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if rfid.is_empty() {
        return err(StatusCode::BAD_REQUEST, "RFID UID is required");
    }

    // First clear old one if it existed for this user (denormalization cleanup)
    if let Some(old_rfid) = target_profile.rfid_uid.clone() {
        let _ = state
            .db
            .query_unpaged(
                "DELETE FROM profiles_by_rfid WHERE rfid_uid=?",
                (&old_rfid.to_string(),),
            )
            .await;
    }

    let updated_at = now_iso();
    if let Err(e) = sqlx::query("UPDATE profiles SET rfid_uid=$1, updated_at=$2 WHERE id=$3")
        .bind(&rfid)
        .bind(&updated_at)
        .bind(&id)
        .execute(&state.pg_pool)
        .await
    {
        let msg = e.to_string();
        if msg.to_lowercase().contains("unique") {
            return err(
                StatusCode::CONFLICT,
                "RFID UID is already linked to another user",
            );
        }
        return internal_err(e);
    }

    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO profiles_by_rfid (rfid_uid, id, role) VALUES (?, ?, ?)",
            (&rfid, &id, &target_profile.role),
        )
        .await;
    ok(json!({"ok": true}))
}

pub async fn profile_update_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" && u.id != id {
        return err(StatusCode::FORBIDDEN, "Access denied");
    }

    if reqp.role != "admin" {
        let admin_only_keys = [
            "role",
            "field_of_study",
            "semester",
            "section",
            "rfid_uid",
            "teacher_subject_access",
            "home_classes",
            "class_permissions",
            "attendance_permissions",
        ];
        if admin_only_keys.iter().any(|key| body.get(*key).is_some()) {
            return err(
                StatusCode::FORBIDDEN,
                "Only admins can update access-control fields",
            );
        }
    }

    let about_me = body.get("about_me").and_then(|v| v.as_str());
    let degrees = body.get("degrees").and_then(|v| v.as_str());
    let resume_url = body.get("resume_url").and_then(|v| v.as_str());
    let payout_details = body.get("payout_details").and_then(|v| v.as_str());

    if reqp.role == "teacher"
        && (about_me.is_some()
            || degrees.is_some()
            || resume_url.is_some()
            || payout_details.is_some())
    {
        return err(
            StatusCode::FORBIDDEN,
            "Teachers cannot edit credential or profile metadata fields",
        );
    }

    let updated_at = now_iso();
    if let Some(am) = about_me {
        let _ = sqlx::query("UPDATE profiles SET about_me=$1, updated_at=$2 WHERE id=$3")
            .bind(am.to_string())
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.pg_pool)
            .await;
    }
    if let Some(deg) = degrees {
        let _ = sqlx::query("UPDATE profiles SET degrees=$1, updated_at=$2 WHERE id=$3")
            .bind(deg.to_string())
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.pg_pool)
            .await;
    }
    if let Some(ru) = resume_url {
        let _ = sqlx::query("UPDATE profiles SET resume_url=$1, updated_at=$2 WHERE id=$3")
            .bind(ru.to_string())
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.pg_pool)
            .await;
    }
    if let Some(pd) = payout_details {
        let _ = sqlx::query("UPDATE profiles SET payout_details=$1, updated_at=$2 WHERE id=$3")
            .bind(pd.to_string())
            .bind(&updated_at)
            .bind(&id)
            .execute(&state.pg_pool)
            .await;
    }

    if let Some(updated_profile) = get_profile(&state, &id).await {
        let _ = index_student_document(&state, &updated_profile).await;
    }

    ok(json!({"ok": true}))
}

pub async fn list_all_profiles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only admins can view all profiles");
    }

    let rows = match sqlx::query(
        "SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, about_me, degrees, resume_url, payout_details FROM profiles",
    )
    .fetch_all(&state.pg_pool)
    .await
    {
        Ok(v) => v,
        Err(e) => return internal_err(e),
    };

    let mut data = Vec::new();
    for row in rows {
        let id: String = match row.try_get("id") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let email: String = match row.try_get("email") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let username: Option<String> = row.try_get("username").ok().flatten();
        let role: String = match row.try_get("role") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let field_of_study: Option<String> = row.try_get("field_of_study").ok().flatten();
        let semester: Option<String> = row.try_get("semester").ok().flatten();
        let section: Option<String> = row.try_get("section").ok().flatten();
        let rfid_uid: Option<String> = row.try_get("rfid_uid").ok().flatten();
        let about_me: Option<String> = row.try_get("about_me").ok().flatten();
        let degrees: Option<String> = row.try_get("degrees").ok().flatten();
        let resume_url: Option<String> = row.try_get("resume_url").ok().flatten();
        let payout_details: Option<String> = row.try_get("payout_details").ok().flatten();

        let mut attendance_percentage: Option<f64> = None;

        if role == "student" {
            if let Ok(att_res) = state
                .db
                .query_unpaged("SELECT status FROM attendance WHERE student_id=?", (&id,))
                .await
            {
                if let Some(att_rows) = att_res.rows {
                    let total = att_rows.len() as f64;
                    if total > 0.0 {
                        let mut present = 0.0;
                        for r in att_rows {
                            if let Ok((status,)) = r.into_typed::<(String,)>() {
                                if status == "present" {
                                    present += 1.0;
                                }
                            }
                        }
                        attendance_percentage = Some((present / total) * 100.0);
                    } else {
                        attendance_percentage = Some(0.0);
                    }
                }
            }
        } else if role == "teacher" {
            if let Ok(att_res) = state
                .db
                .query_unpaged(
                    "SELECT status FROM teacher_attendance WHERE teacher_id=?",
                    (&id,),
                )
                .await
            {
                if let Some(att_rows) = att_res.rows {
                    let total = att_rows.len() as f64;
                    if total > 0.0 {
                        let mut present = 0.0;
                        for r in att_rows {
                            if let Ok((status,)) = r.into_typed::<(String,)>() {
                                if status == "present" {
                                    present += 1.0;
                                }
                            }
                        }
                        attendance_percentage = Some((present / total) * 100.0);
                    } else {
                        attendance_percentage = Some(0.0);
                    }
                }
            }
        }

        data.push(json!({
            "id": id, "email": email, "username": username, "role": role,
            "field_of_study": field_of_study, "semester": semester, "section": section,
            "rfid_uid": rfid_uid, "about_me": about_me, "degrees": degrees,
            "resume_url": resume_url, "payout_details": payout_details,
            "attendance_percentage": attendance_percentage
        }));
    }
    ok(json!({"data": data}))
}

pub async fn search_students_in_meili(
    state: &AppState,
    search_term: &str,
    field_filter: Option<&str>,
) -> Result<Vec<Profile>, String> {
    let Some(meili_url) = state.meili_url.as_deref() else {
        return Err("meilisearch not configured".to_string());
    };
    let endpoint = format!(
        "{}/indexes/{}/search",
        meili_url.trim_end_matches('/'),
        state.meili_students_index
    );
    let filter =
        field_filter.map(|field| format!("field_of_study = \"{}\"", meili_filter_escape(field)));
    let request = state.http_client.post(endpoint).json(&json!({
        "q": search_term,
        "limit": 300,
        "filter": filter,
    }));
    let response = meili_request_with_auth(request, state.meili_api_key.as_deref())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("meili student search failed {} {}", status, body));
    }

    let payload: Value = response.json().await.map_err(|err| err.to_string())?;
    let mut data = Vec::new();
    if let Some(hits) = payload.get("hits").and_then(|value| value.as_array()) {
        for hit in hits {
            if let Ok(item) = serde_json::from_value::<Profile>(hit.clone()) {
                if item.role == "student" {
                    data.push(item);
                }
            }
        }
    }
    Ok(data)
}
