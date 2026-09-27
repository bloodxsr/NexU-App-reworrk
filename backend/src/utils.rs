use crate::models::*;
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

pub fn err(code: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (
        code,
        Json(json!({
            "success": false,
            "data": null,
            "error": message
        })),
    )
}

pub fn internal_err<E: std::fmt::Display>(error: E) -> (StatusCode, Json<Value>) {
    eprintln!("Internal Error: {}", error);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "success": false,
            "data": null,
            "error": "Internal server error occurred"
        })),
    )
}

pub fn ok(data: Value) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(data))
}

#[allow(dead_code)]
pub fn is_iso_date_only(v: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap())
        .is_match(v)
}

pub fn valid_branches() -> HashSet<&'static str> {
    HashSet::from(["AIML", "IIOT", "CSE", "CYBER", "AIDS", "CSAM"])
}

pub fn valid_semesters() -> HashSet<&'static str> {
    HashSet::from(["1", "2", "3", "4", "5", "6", "7", "8"])
}

pub fn valid_sections() -> HashSet<&'static str> {
    HashSet::from(["A", "B", "C"])
}

pub fn valid_subjects() -> HashSet<&'static str> {
    HashSet::from([
        "Electrical Science",
        "Applied Mathematics I",
        "Engineering Graphics",
        "Manufacturing Processes",
        "Communication Skills",
        "Applied Physics I",
        "Indian Constitution",
        "Engineering Mechanics",
        "Programming in C",
        "Workshop Practice",
        "Environmental Science",
        "Applied Chemistry",
        "Human Values and Professional Ethics",
        "Applied Physics II",
        "Applied Mathematics II",
        "Probability, Statistics and Linear Algebra",
        "Data Structures",
        "Critical Reasoning and System Thinking",
        "Digital Logic Design",
        "Universal Human Values",
        "Principles of Artificial Intelligence",
    ])
}

pub fn normalize_branch(value: &str) -> String {
    let v = value.trim().to_uppercase();
    if v == "CYBERSECURITY" || v == "CYBER SECURITY" {
        return "CYBER".to_string();
    }
    if v == "CS-AM" || v == "CS AM" {
        return "CSAM".to_string();
    }
    if v == "AI & DS" || v == "AI AND DS" {
        return "AIDS".to_string();
    }
    v
}

pub fn normalize_semester(value: &str) -> String {
    value.trim().to_string()
}

pub fn normalize_section(value: &str) -> String {
    value.trim().to_uppercase()
}

pub fn canonical_subject(value: &str) -> Option<String> {
    let v = value.trim().to_lowercase();
    match v.as_str() {
        "electrical science" => Some("Electrical Science".to_string()),
        "applied mathematics i" => Some("Applied Mathematics I".to_string()),
        "engineering graphics" => Some("Engineering Graphics".to_string()),
        "manufacturing processes" => Some("Manufacturing Processes".to_string()),
        "communication skills" => Some("Communication Skills".to_string()),
        "applied physics i" => Some("Applied Physics I".to_string()),
        "indian constitution" => Some("Indian Constitution".to_string()),
        "engineering mechanics" => Some("Engineering Mechanics".to_string()),
        "programming in c" => Some("Programming in C".to_string()),
        "workshop practice" => Some("Workshop Practice".to_string()),
        "environmental science" => Some("Environmental Science".to_string()),
        "applied chemistry" => Some("Applied Chemistry".to_string()),
        "human values and professional ethics" => {
            Some("Human Values and Professional Ethics".to_string())
        }
        "applied physics ii" => Some("Applied Physics II".to_string()),
        "applied mathematics ii" => Some("Applied Mathematics II".to_string()),
        "probability, statistics and linear algebra" => {
            Some("Probability, Statistics and Linear Algebra".to_string())
        }
        "data structures" => Some("Data Structures".to_string()),
        "critical reasoning and system thinking" => {
            Some("Critical Reasoning and System Thinking".to_string())
        }
        "digital logic design" => Some("Digital Logic Design".to_string()),
        "universal human values" => Some("Universal Human Values".to_string()),
        "principles of artificial intelligence" => {
            Some("Principles of Artificial Intelligence".to_string())
        }
        _ => {
            // Fallback for any subject already in our valid list if it's not in the match but in the set
            for s in valid_subjects() {
                if s.to_lowercase() == v {
                    return Some(s.to_string());
                }
            }
            None
        }
    }
}

pub fn normalize_class_triplet(
    field: &str,
    semester: &str,
    section: &str,
) -> Option<(String, String, String)> {
    let field_of_study = normalize_branch(field);
    let semester_val = normalize_semester(semester);
    let section_val = normalize_section(section);
    if !valid_branches().contains(field_of_study.as_str())
        || !valid_semesters().contains(semester_val.as_str())
        || !valid_sections().contains(section_val.as_str())
    {
        return None;
    }
    Some((field_of_study, semester_val, section_val))
}

pub fn class_key(field_of_study: &str, semester: &str, section: &str) -> String {
    format!(
        "{}|{}|{}",
        normalize_branch(field_of_study),
        normalize_semester(semester),
        normalize_section(section)
    )
}

pub fn class_subject_key(
    field_of_study: &str,
    semester: &str,
    section: &str,
    subject: &str,
) -> String {
    format!(
        "{}|{}|{}|{}",
        normalize_branch(field_of_study),
        normalize_semester(semester),
        normalize_section(section),
        subject.trim()
    )
}

pub fn get_token(headers: &HeaderMap) -> String {
    headers
        .get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn auth_rate_limit(state: &AppState, key: String) -> bool {
    let now = Utc::now().timestamp();
    let mut map = match state.auth_attempts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.retain(|_, v| v.first_ts > now - state.auth_window_secs);
    let entry = map.entry(key).or_insert(AttemptState {
        count: 0,
        first_ts: now,
    });
    if now - entry.first_ts > state.auth_window_secs {
        *entry = AttemptState {
            count: 1,
            first_ts: now,
        };
        return true;
    }
    if entry.count >= state.max_auth_attempts {
        return false;
    }
    entry.count += 1;
    true
}

pub async fn session_user(state: &AppState, headers: &HeaderMap) -> Option<User> {
    let token = get_token(headers);
    if token.is_empty() {
        return None;
    }

    // In Scylla 0.14, use execute_unpaged for prepared statements without paging
    let res = state
        .db
        .execute_unpaged(&state.session_user_stmt, (token_hash(&token),))
        .await
        .ok()?;
    let rows = res.rows.unwrap_or_default();
    let row = rows.into_iter().next()?;
    let (user_id, expires_at) = row.into_typed::<(String, String)>().ok()?;
    if expires_at > now_iso() {
        return get_user_by_id(state, &user_id).await;
    }
    None
}

pub async fn get_user_by_id(state: &AppState, user_id: &str) -> Option<User> {
    let row =
        sqlx::query("SELECT id, email, username, password, created_at FROM users WHERE id=$1")
            .bind(user_id)
            .fetch_optional(&state.pg_pool)
            .await
            .ok()??;
    Some(User {
        id: row.try_get("id").ok()?,
        email: row.try_get("email").ok()?,
        username: row.try_get("username").ok()?,
        password: row.try_get("password").ok()?,
        created_at: row.try_get("created_at").ok()?,
    })
}

pub async fn get_profile(state: &AppState, user_id: &str) -> Option<Profile> {
    let row = sqlx::query(
        "SELECT id, email, username, role, field_of_study, semester, section, rfid_uid, about_me, degrees, resume_url, payout_details FROM profiles WHERE id=$1",
    )
    .bind(user_id)
    .fetch_optional(&state.pg_pool)
    .await
    .ok()??;
    Some(Profile {
        id: row.try_get("id").ok()?,
        email: row.try_get("email").ok()?,
        username: row.try_get("username").ok()?,
        role: row.try_get("role").ok()?,
        field_of_study: row.try_get("field_of_study").ok()?,
        semester: row.try_get("semester").ok()?,
        section: row.try_get("section").ok()?,
        rfid_uid: row.try_get("rfid_uid").ok()?,
        about_me: row.try_get("about_me").ok()?,
        degrees: row.try_get("degrees").ok()?,
        resume_url: row.try_get("resume_url").ok()?,
        payout_details: row.try_get("payout_details").ok()?,
    })
}

pub async fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(User, Profile), (StatusCode, Json<Value>)> {
    let Some(u) = session_user(state, headers).await else {
        return Err(err(StatusCode::UNAUTHORIZED, "Unauthorized"));
    };
    let Some(p) = get_profile(state, &u.id).await else {
        return Err(err(StatusCode::UNAUTHORIZED, "Unauthorized"));
    };
    Ok((u, p))
}

pub async fn require_teacher(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(User, Profile), (StatusCode, Json<Value>)> {
    let (u, p) = require_auth(state, headers).await?;
    if p.role != "teacher" && p.role != "admin" {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Access denied: Teachers/Admins only",
        ));
    }
    Ok((u, p))
}

pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(password.as_bytes());
    format!("{}${}", hex::encode(salt), hex::encode(hasher.finalize()))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    if let Some((salt, hash)) = stored.split_once('$') {
        if let Ok(salt_bytes) = hex::decode(salt) {
            let mut hasher = Sha256::new();
            hasher.update(salt_bytes);
            hasher.update(password.as_bytes());
            return hex::encode(hasher.finalize()) == hash;
        }
    }
    password == stored
}

pub fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub async fn check_user_exists(state: &AppState, email: &str, username: &str) -> Result<bool, ()> {
    if let Ok(row) = sqlx::query("SELECT id FROM users WHERE email=$1 LIMIT 1")
        .bind(email)
        .fetch_optional(&state.pg_pool)
        .await
    {
        if row.is_some() {
            return Ok(true);
        }
    }
    if let Ok(row) = sqlx::query("SELECT id FROM users WHERE username=$1 LIMIT 1")
        .bind(username)
        .fetch_optional(&state.pg_pool)
        .await
    {
        if row.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

pub async fn get_student_class_context(
    state: &AppState,
    student_id: &str,
) -> Option<(String, String, String)> {
    let profile = get_profile(state, student_id).await?;
    let role = profile.role;
    let field_of_study = profile.field_of_study;
    let semester = profile.semester;
    let section = profile.section;
    if role != "student" {
        return None;
    }
    let field = field_of_study?;
    let sem = semester?;
    let sec = section?;
    normalize_class_triplet(&field, &sem, &sec)
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
