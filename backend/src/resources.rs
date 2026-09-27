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

pub async fn list_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (_u, p) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let field = q.get("field").cloned().unwrap_or_default();
    let semester = q.get("semester").cloned().unwrap_or_default();
    let section = q.get("section").cloned().unwrap_or_default();
    let search_term = q
        .get("q")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    // Student constraints: cannot view resources for future semesters
    if p.role == "student" {
        let current_sem: i32 = p.semester.as_deref().unwrap_or("1").parse().unwrap_or(1);
        let requested_sem: i32 = semester.parse().unwrap_or(1);
        if requested_sem > current_sem {
            return err(
                StatusCode::FORBIDDEN,
                "Access denied: You cannot view resources for future semesters.",
            );
        }
    }

    if field.is_empty() || semester.is_empty() || section.is_empty() {
        return ok(json!({"data": []}));
    }

    let data = if search_term.is_empty() {
        match fetch_resources_for_class(&state, &field, &semester, &section).await {
            Ok(items) => items,
            Err(error_msg) => return internal_err(error_msg),
        }
    } else if state.meili_url.is_some() {
        match search_resources_in_meili(&state, &field, &semester, &section, &search_term).await {
            Ok(items) if !items.is_empty() => items,
            Ok(_) => match fetch_resources_for_class(&state, &field, &semester, &section).await {
                Ok(items) => items
                    .into_iter()
                    .filter(|item| resource_matches_search_query(item, &search_term))
                    .collect(),
                Err(db_error_msg) => return internal_err(db_error_msg),
            },
            Err(error_msg) => {
                eprintln!(
                    "warning: meilisearch unavailable, using db fallback: {}",
                    error_msg
                );
                match fetch_resources_for_class(&state, &field, &semester, &section).await {
                    Ok(items) => items
                        .into_iter()
                        .filter(|item| resource_matches_search_query(item, &search_term))
                        .collect(),
                    Err(db_error_msg) => return internal_err(db_error_msg),
                }
            }
        }
    } else {
        match fetch_resources_for_class(&state, &field, &semester, &section).await {
            Ok(items) => items
                .into_iter()
                .filter(|item| resource_matches_search_query(item, &search_term))
                .collect(),
            Err(error_msg) => return internal_err(error_msg),
        }
    };

    ok(json!({"data": data}))
}

pub async fn create_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateResourceReq>,
) -> impl IntoResponse {
    let (u, p) = match require_teacher(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    if body.title.is_empty()
        || body.file_url.trim().is_empty()
        || body.field_of_study.is_empty()
        || body.semester.is_empty()
        || body.section.is_empty()
        || body.subject.is_empty()
    {
        return err(StatusCode::BAD_REQUEST, "Missing required fields");
    }
    if !valid_branches().contains(body.field_of_study.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Invalid field of study");
    }
    if !valid_semesters().contains(body.semester.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Invalid semester");
    }
    if !valid_sections().contains(body.section.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Invalid section");
    }
    if !valid_subjects().contains(body.subject.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Invalid subject");
    }
    if body.rtype != "note" && body.rtype != "assignment" {
        return err(StatusCode::BAD_REQUEST, "Invalid resource type");
    }
    if body.rtype == "assignment"
        && body
            .deadline
            .as_ref()
            .map(|d| !is_iso_date_only(d))
            .unwrap_or(true)
    {
        return err(
            StatusCode::BAD_REQUEST,
            "Deadline is required for assignments",
        );
    }

    if p.role == "teacher" {
        let subject_access = fetch_teacher_subject_access(&state, &u.id)
            .await
            .unwrap_or_default();
        let home_classes = fetch_teacher_home_classes(&state, &u.id)
            .await
            .unwrap_or_default();
        let (_class_keys, class_subject_keys, _home_class_keys, _) =
            build_teacher_access_summary(&subject_access, &home_classes);

        let teaches_subj = class_subject_keys.contains(&class_subject_key(
            &body.field_of_study,
            &body.semester,
            &body.section,
            &body.subject,
        ));

        if !teaches_subj {
            return err(
                StatusCode::FORBIDDEN,
                "You do not have access to upload resources for this subject",
            );
        }
    }

    let Some(object_key) = resource_object_key_from_url(&body.file_url) else {
        return err(StatusCode::BAD_REQUEST, "Invalid uploaded file path");
    };

    if !object_exists_in_bucket(&state.s3_client, &state.bucket_name, &object_key).await {
        let fallback_path = state.resource_uploads_dir.join(&object_key);
        if fallback_path.exists() {
            let bytes = match fs::read(&fallback_path).await {
                Ok(payload) => payload,
                Err(read_err) => {
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        &format!("failed to read fallback file: {}", read_err),
                    );
                }
            };
            if let Err(upload_err) = upload_object_bytes(
                &state.s3_client,
                &state.bucket_name,
                &object_key,
                bytes,
                Some(infer_content_type(&object_key)),
            )
            .await
            {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("failed to upload fallback file: {}", upload_err),
                );
            }
        } else {
            return err(StatusCode::BAD_REQUEST, "Uploaded file not found");
        }
    }

    let id = new_id();
    let created_at = now_iso();
    let deadline_val = body.deadline.unwrap_or_default();

    if let Err(e) = state
        .db
        .execute_unpaged(
            &state.insert_resource_stmt,
            (
                &body.field_of_study,
                &body.semester,
                &body.section,
                &created_at,
                &id,
                &body.title,
                &body.file_url,
                &body.rtype,
                &u.id,
                &deadline_val,
                &body.subject,
            ),
        )
        .await
    {
        return internal_err(e);
    }

    let indexed = Resource {
        field_of_study: body.field_of_study.clone(),
        semester: body.semester.clone(),
        section: body.section.clone(),
        created_at: created_at.clone(),
        id: id.clone(),
        title: body.title.clone(),
        file_url: Some(body.file_url.clone()),
        resource_type: Some(body.rtype.clone()),
        teacher_id: Some(u.id.clone()),
        deadline: if deadline_val.is_empty() {
            None
        } else {
            Some(deadline_val.clone())
        },
        subject: Some(body.subject.clone()),
    };
    if let Err(err_msg) = index_resource_document(&state, &indexed).await {
        eprintln!(
            "warning: failed to index resource {} in meilisearch: {}",
            id, err_msg
        );
    }

    ok(json!({"ok": true, "id": id}))
}

pub async fn upload_resource_pdf(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "teacher" && reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers can upload resources");
    }

    if body.is_empty() || body.len() > MAX_FILE_DATA_URL_LEN {
        return err(StatusCode::BAD_REQUEST, "File size must be under 12MB");
    }

    let requested_name = q
        .get("name")
        .cloned()
        .unwrap_or_else(|| "resource.bin".to_string());
    let file_name = std::path::Path::new(&requested_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("resource.bin");

    let mut safe: String = file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() {
        safe = "resource.bin".to_string();
    }

    let stored_name = format!("{}-{}", new_id(), safe);
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| infer_content_type(&stored_name).to_string());
    if let Err(upload_err) = upload_object_bytes(
        &state.s3_client,
        &state.bucket_name,
        &stored_name,
        body.to_vec(),
        Some(&content_type),
    )
    .await
    {
        return internal_err(upload_err);
    }

    ok(json!({"file_url": format!("{}{}", RESOURCE_UPLOADS_PREFIX, stored_name)}))
}

pub async fn get_resource_file(
    State(state): State<AppState>,
    Path(object_key): Path<String>,
) -> axum::response::Response {
    let Some(safe_key) = sanitize_resource_object_key(&object_key) else {
        return err(StatusCode::BAD_REQUEST, "Invalid file key").into_response();
    };

    if let Ok(object) = state
        .s3_client
        .get_object()
        .bucket(&state.bucket_name)
        .key(&safe_key)
        .send()
        .await
    {
        let content_type = object
            .content_type()
            .map(|value| value.to_string())
            .unwrap_or_else(|| infer_content_type(&safe_key).to_string());
        let bytes = match object.body.collect().await {
            Ok(aggregated) => aggregated.into_bytes(),
            Err(read_err) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to read object body: {}", read_err),
                )
                .into_response();
            }
        };
        let mut headers = HeaderMap::new();
        if let Ok(value) = header::HeaderValue::from_str(&content_type) {
            headers.insert(header::CONTENT_TYPE, value);
        }
        return (StatusCode::OK, headers, bytes).into_response();
    }

    let local_path = state.resource_uploads_dir.join(&safe_key);
    if local_path.exists() {
        let payload = match fs::read(&local_path).await {
            Ok(bytes) => bytes,
            Err(read_err) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to read fallback file: {}", read_err),
                )
                .into_response();
            }
        };
        let mut headers = HeaderMap::new();
        if let Ok(value) = header::HeaderValue::from_str(infer_content_type(&safe_key)) {
            headers.insert(header::CONTENT_TYPE, value);
        }
        return (StatusCode::OK, headers, payload).into_response();
    }

    err(StatusCode::NOT_FOUND, "File not found").into_response()
}

pub async fn search_resources_in_meili(
    state: &AppState,
    field: &str,
    semester: &str,
    section: &str,
    search_term: &str,
) -> Result<Vec<Resource>, String> {
    let Some(meili_url) = state.meili_url.as_deref() else {
        return Err("meilisearch not configured".to_string());
    };
    let endpoint = format!(
        "{}/indexes/{}/search",
        meili_url.trim_end_matches('/'),
        state.meili_resources_index
    );
    let filter = format!(
        "field_of_study = \"{}\" AND semester = \"{}\" AND section = \"{}\"",
        meili_filter_escape(field),
        meili_filter_escape(semester),
        meili_filter_escape(section)
    );
    let request = state.http_client.post(endpoint).json(&json!({
        "q": search_term,
        "filter": filter,
        "limit": 200
    }));
    let response = meili_request_with_auth(request, state.meili_api_key.as_deref())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("meili search failed {} {}", status, body));
    }

    let payload: Value = response.json().await.map_err(|err| err.to_string())?;
    let mut items: Vec<Resource> = Vec::new();
    if let Some(hits) = payload.get("hits").and_then(|value| value.as_array()) {
        for hit in hits {
            if let Ok(item) = serde_json::from_value::<Resource>(hit.clone()) {
                items.push(item);
            }
        }
    }
    Ok(items)
}

pub async fn fetch_resources_for_class(
    state: &AppState,
    field: &str,
    semester: &str,
    section: &str,
) -> Result<Vec<Resource>, String> {
    let response = state
        .db
        .execute_unpaged(&state.list_resources_stmt, (field, semester, section))
        .await
        .map_err(|err| err.to_string())?;

    let mut data: Vec<Resource> = Vec::new();
    if let Some(rows) = response.rows {
        for row in rows {
            if let Ok(resource) = row.into_typed::<Resource>() {
                data.push(resource);
            }
        }
    }
    Ok(data)
}

pub fn resource_matches_search_query(resource: &Resource, search_term: &str) -> bool {
    let q = search_term.trim().to_lowercase();
    if q.is_empty() {
        return true;
    }
    let title = resource.title.to_lowercase();
    let rtype = resource
        .resource_type
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();
    let subject = resource
        .subject
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();
    let teacher_id = resource
        .teacher_id
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();
    title.contains(&q) || rtype.contains(&q) || subject.contains(&q) || teacher_id.contains(&q)
}

pub fn sanitize_resource_object_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 255
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return None;
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "._-".contains(ch))
    {
        return Some(trimmed.to_string());
    }
    None
}

pub fn resource_object_key_from_url(file_url: &str) -> Option<String> {
    let cleaned = file_url.trim();
    let without_query = cleaned.split('?').next().unwrap_or(cleaned);
    let idx = without_query.find(RESOURCE_UPLOADS_PREFIX)?;
    let suffix = &without_query[idx + RESOURCE_UPLOADS_PREFIX.len()..];
    sanitize_resource_object_key(suffix)
}

pub fn infer_content_type(file_name: &str) -> &'static str {
    if file_name.ends_with(".pdf") {
        return "application/pdf";
    }
    if file_name.ends_with(".doc") {
        return "application/msword";
    }
    if file_name.ends_with(".docx") {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if file_name.ends_with(".ppt") {
        return "application/vnd.ms-powerpoint";
    }
    if file_name.ends_with(".pptx") {
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    "application/octet-stream"
}

pub fn meili_filter_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn meili_request_with_auth(
    request: reqwest::RequestBuilder,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    match api_key {
        Some(key) if !key.trim().is_empty() => request.bearer_auth(key.trim()),
        _ => request,
    }
}

pub async fn ensure_bucket_exists(s3_client: &S3Client, bucket_name: &str) -> Result<(), String> {
    if s3_client
        .head_bucket()
        .bucket(bucket_name)
        .send()
        .await
        .is_ok()
    {
        return Ok(());
    }
    s3_client
        .create_bucket()
        .bucket(bucket_name)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub async fn upload_object_bytes(
    s3_client: &S3Client,
    bucket_name: &str,
    object_key: &str,
    bytes: Vec<u8>,
    content_type: Option<&str>,
) -> Result<(), String> {
    let mut request = s3_client
        .put_object()
        .bucket(bucket_name)
        .key(object_key)
        .body(ByteStream::from(bytes));
    if let Some(value) = content_type {
        request = request.content_type(value.to_string());
    }
    request.send().await.map_err(|err| err.to_string())?;
    Ok(())
}

pub async fn object_exists_in_bucket(
    s3_client: &S3Client,
    bucket_name: &str,
    object_key: &str,
) -> bool {
    s3_client
        .head_object()
        .bucket(bucket_name)
        .key(object_key)
        .send()
        .await
        .is_ok()
}
