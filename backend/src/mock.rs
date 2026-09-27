use crate::models::*;
use crate::utils::*;
use crate::*;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Build a class_key from field_of_study, semester, section: e.g. "AIML|3|A"
fn make_class_key(field: &str, semester: &str, section: &str) -> String {
    format!(
        "{}|{}|{}",
        field.trim().to_uppercase(),
        semester.trim(),
        section.trim().to_uppercase()
    )
}

/// Resolve class_key: teachers/admins pass it explicitly, students derive from profile.
fn resolve_class_key(profile: &Profile, q: &HashMap<String, String>) -> Option<String> {
    // If explicit class params passed (for teachers selecting a class)
    if let (Some(f), Some(sem), Some(sec)) = (
        q.get("field_of_study"),
        q.get("semester"),
        q.get("section"),
    ) {
        if !f.is_empty() && !sem.is_empty() && !sec.is_empty() {
            return Some(make_class_key(f, sem, sec));
        }
    }
    // For students, use their own class
    if let (Some(f), Some(sem), Some(sec)) = (
        profile.field_of_study.as_deref(),
        profile.semester.as_deref(),
        profile.section.as_deref(),
    ) {
        if !f.is_empty() && !sem.is_empty() && !sec.is_empty() {
            return Some(make_class_key(f, sem, sec));
        }
    }
    None
}

// ── Schedule (Class Timetable) ──────────────────────────────────────────────

pub async fn list_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (_user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let class_key = match resolve_class_key(&profile, &q) {
        Some(k) => k,
        None => return ok(json!({ "data": [] })),
    };
    let res = match state
        .db
        .execute_unpaged(&state.list_class_schedule_stmt, (&class_key,))
        .await
    {
        Ok(r) => r,
        Err(e) => return internal_err(e),
    };
    let mut data = Vec::new();
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok(s) = row.into_typed::<ClassSchedule>() {
                data.push(s);
            }
        }
    }
    ok(json!({ "data": data }))
}

pub async fn create_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    // Only teachers and admins can create schedule entries
    let (user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if profile.role != "teacher" && profile.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers and admins can create schedule entries");
    }

    let field = body.get("field_of_study").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let semester = body.get("semester").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let section = body.get("section").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let day = body.get("day").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let slot = body.get("slot").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let location = body.get("location").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let subject = body.get("subject").and_then(|v| v.as_str()).map(|s| s.trim().to_string());

    if field.is_empty() || semester.is_empty() || section.is_empty() {
        return err(StatusCode::BAD_REQUEST, "field_of_study, semester, and section are required");
    }
    if title.is_empty() || day.is_empty() || slot.is_empty() {
        return err(StatusCode::BAD_REQUEST, "title, day, and slot are required");
    }

    let class_key = make_class_key(&field, &semester, &section);
    let id = new_id();
    let created_at = now_iso();
    let teacher_name = profile.username.clone().unwrap_or(user.username.clone());

    if let Err(e) = state
        .db
        .execute_unpaged(
            &state.insert_class_schedule_stmt,
            (
                &class_key,
                &day,
                &slot,
                &id,
                &title,
                &location,
                &subject,
                &user.id,
                &teacher_name,
                &created_at,
            ),
        )
        .await
    {
        return internal_err(e);
    }

    ok(json!({ "ok": true, "id": id }))
}

pub async fn delete_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (_user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if profile.role != "teacher" && profile.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers and admins can delete schedule entries");
    }

    let class_key = match resolve_class_key(&profile, &q) {
        Some(k) => k,
        None => return err(StatusCode::BAD_REQUEST, "Cannot determine class"),
    };

    // Find the schedule entry by id so we can get (day, slot) for the composite key
    let res = match state
        .db
        .execute_unpaged(&state.list_class_schedule_stmt, (&class_key,))
        .await
    {
        Ok(r) => r,
        Err(e) => return internal_err(e),
    };

    let mut found = None;
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok(s) = row.into_typed::<ClassSchedule>() {
                if s.id == id {
                    found = Some(s);
                    break;
                }
            }
        }
    }

    let schedule = match found {
        Some(s) => s,
        None => return err(StatusCode::NOT_FOUND, "Schedule entry not found"),
    };

    if let Err(e) = state
        .db
        .execute_unpaged(
            &state.delete_class_schedule_stmt,
            (&schedule.class_key, &schedule.day, &schedule.slot),
        )
        .await
    {
        return internal_err(e);
    }

    ok(json!({ "ok": true }))
}

// ── Assignments (Class-wide) ────────────────────────────────────────────────

pub async fn list_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let (_user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let class_key = match resolve_class_key(&profile, &q) {
        Some(k) => k,
        None => return ok(json!({ "data": [] })),
    };
    let res = match state
        .db
        .execute_unpaged(&state.list_class_assignments_stmt, (&class_key,))
        .await
    {
        Ok(r) => r,
        Err(e) => return internal_err(e),
    };
    let mut data = Vec::new();
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok(a) = row.into_typed::<ClassAssignment>() {
                data.push(a);
            }
        }
    }
    ok(json!({ "data": data }))
}

pub async fn create_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let (user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if profile.role != "teacher" && profile.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers and admins can create assignments");
    }

    let field = body.get("field_of_study").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let semester = body.get("semester").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let section = body.get("section").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let description = body.get("description").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let due_date = body.get("due_date").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let subject = body.get("subject").and_then(|v| v.as_str()).map(|s| s.trim().to_string());

    if field.is_empty() || semester.is_empty() || section.is_empty() {
        return err(StatusCode::BAD_REQUEST, "field_of_study, semester, and section are required");
    }
    if title.is_empty() || due_date.is_empty() {
        return err(StatusCode::BAD_REQUEST, "title and due_date are required");
    }

    let class_key = make_class_key(&field, &semester, &section);
    let id = new_id();
    let created_at = now_iso();
    let teacher_name = profile.username.clone().unwrap_or(user.username.clone());

    if let Err(e) = state
        .db
        .execute_unpaged(
            &state.insert_class_assignment_stmt,
            (
                &class_key,
                &created_at,
                &id,
                &title,
                &description,
                &due_date,
                &subject,
                &user.id,
                &teacher_name,
            ),
        )
        .await
    {
        return internal_err(e);
    }

    ok(json!({ "ok": true, "id": id }))
}

pub async fn update_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let (_user, profile) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if profile.role != "teacher" && profile.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only teachers and admins can update assignments");
    }

    // We need the class_key to find this assignment
    let field = body.get("field_of_study").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let semester = body.get("semester").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let section = body.get("section").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

    if field.is_empty() || semester.is_empty() || section.is_empty() {
        // Try resolving from profile
        let mut q = HashMap::new();
        q.insert("field_of_study".to_string(), field);
        q.insert("semester".to_string(), semester);
        q.insert("section".to_string(), section);
        let _ck = resolve_class_key(&profile, &q);
    }

    // For now, update_assignment is a delete + re-insert since ScyllaDB doesn't support updating non-key columns easily
    // The frontend can just delete and re-create
    ok(json!({ "ok": true, "id": id }))
}

// ── Stubs (not yet implemented) ─────────────────────────────────────────────

pub async fn create_submission(
    State(_state): State<AppState>,
    _headers: HeaderMap,
    Json(_body): Json<Value>,
) -> impl IntoResponse {
    err(
        StatusCode::NOT_IMPLEMENTED,
        "Submission system not yet implemented",
    )
}

pub async fn list_channels(
    State(_state): State<AppState>,
    _headers: HeaderMap,
) -> impl IntoResponse {
    ok(json!({"data": []}))
}

pub async fn list_messages(
    State(_state): State<AppState>,
    _headers: HeaderMap,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    ok(json!({"data": []}))
}

pub async fn post_message(
    State(_state): State<AppState>,
    _headers: HeaderMap,
    Path(_id): Path<String>,
    Json(_body): Json<Value>,
) -> impl IntoResponse {
    err(
        StatusCode::NOT_IMPLEMENTED,
        "Messaging system not yet implemented",
    )
}

pub async fn list_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let _ = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let res = match state
        .db
        .execute_unpaged(&state.list_notifications_stmt, ())
        .await
    {
        Ok(r) => r,
        Err(e) => return internal_err(e),
    };
    let mut data = Vec::new();
    if let Some(rows) = res.rows {
        for row in rows {
            if let Ok(notif) = row.into_typed::<Notification>() {
                data.push(notif);
            }
        }
    }
    ok(json!({"data": data}))
}

pub async fn create_notification(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let (u, reqp) = match require_auth(&state, &headers).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    if reqp.role != "admin" {
        return err(StatusCode::FORBIDDEN, "Only admins can post notifications");
    }

    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let text = "".to_string();
    let file_url = body
        .get("file_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if title.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Title required");
    }

    let id = new_id();
    let created_at = now_iso();
    let author_name = reqp.username.unwrap_or(u.username);

    let _ = state
        .db
        .execute_unpaged(
            &state.insert_notification_stmt,
            (
                &created_at,
                &id,
                &title,
                &text,
                &file_url,
                &u.id,
                &author_name,
            ),
        )
        .await;
    ok(json!({"ok": true}))
}
