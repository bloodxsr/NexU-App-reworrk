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

pub async fn auth_signup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if !auth_rate_limit(&state, format!("signup:{}", get_token(&headers))) {
        return err(StatusCode::TOO_MANY_REQUESTS, "Too many auth attempts");
    }
    let email = body
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let role = body
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("student");

    if username.is_empty() || email.is_empty() || password.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Required fields missing");
    }
    if password.len() < 8 {
        return err(
            StatusCode::BAD_REQUEST,
            "Password must be at least 8 characters",
        );
    }

    if check_user_exists(&state, &email, &username)
        .await
        .unwrap_or(false)
    {
        return err(StatusCode::CONFLICT, "User already registered");
    }

    let user_id = new_id();
    let created = now_iso();
    let role_norm = if role == "admin" {
        "admin"
    } else if role == "teacher" {
        "teacher"
    } else {
        "student"
    };

    let mut field_opt: Option<String> = None;
    let mut sem_opt: Option<String> = None;
    let mut sec_opt: Option<String> = None;

    // Whitelist check
    if role_norm != "admin" {
        if role_norm == "student" {
            let auth_res = match sqlx::query("SELECT field_of_study, semester, section FROM authorized_students WHERE email = $1")
                .bind(&email)
                .fetch_optional(&state.pg_pool)
                .await {
                    Ok(v) => v,
                    Err(e) => return internal_err(e),
                };

            if let Some(row) = auth_res {
                let f: String = row
                    .try_get("field_of_study")
                    .unwrap_or_else(|_| "".to_string());
                let s: String = row.try_get("semester").unwrap_or_else(|_| "".to_string());
                let sec: String = row.try_get("section").unwrap_or_else(|_| "".to_string());

                if !valid_branches().contains(f.as_str())
                    || !valid_semesters().contains(s.as_str())
                    || !valid_sections().contains(sec.as_str())
                {
                    return err(
                        StatusCode::BAD_REQUEST,
                        "Whitelist data for this student is invalid. Contact Admin.",
                    );
                }

                field_opt = Some(f);
                sem_opt = Some(s);
                sec_opt = Some(sec);
            } else {
                return err(StatusCode::FORBIDDEN, "Your email is not in the authorized student list. Please contact administration.");
            }
        } else if role_norm == "teacher" {
            let auth_res =
                match sqlx::query("SELECT email FROM authorized_teachers WHERE email = $1")
                    .bind(&email)
                    .fetch_optional(&state.pg_pool)
                    .await
                {
                    Ok(v) => v,
                    Err(e) => return internal_err(e),
                };
            if auth_res.is_none() {
                return err(StatusCode::FORBIDDEN, "Your email is not in the authorized teacher list. Please contact administration.");
            }
        }
    }

    let pwd_hash = hash_password(password);
    if let Err(e) = sqlx::query(
        "INSERT INTO users (id, email, username, password, created_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&username)
    .bind(&pwd_hash)
    .bind(&created)
    .execute(&state.pg_pool)
    .await
    {
        let msg = e.to_string();
        if msg.to_lowercase().contains("unique") {
            return err(StatusCode::CONFLICT, "User already registered");
        }
        return internal_err(e);
    }
    if let Err(e) = sqlx::query(
        "INSERT INTO profiles (id, email, username, role, field_of_study, semester, section, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&username)
    .bind(role_norm)
    .bind(&field_opt)
    .bind(&sem_opt)
    .bind(&sec_opt)
    .bind(&created)
    .bind(&created)
    .execute(&state.pg_pool)
    .await
    {
        return internal_err(e);
    }

    // Keep Scylla writes for compatibility while PostgreSQL is source-of-truth for relational reads.
    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO users (id, email, username, password, created_at) VALUES (?, ?, ?, ?, ?)",
            (&user_id, &email, &username, &pwd_hash, &created),
        )
        .await;
    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO users_by_email (email, id) VALUES (?, ?)",
            (&email, &user_id),
        )
        .await;
    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO users_by_username (username, id) VALUES (?, ?)",
            (&username, &user_id),
        )
        .await;
    let _ = state.db.query_unpaged("INSERT INTO profiles (id, email, username, role, field_of_study, semester, section, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (&user_id, &email, &username, &role_norm, &field_opt, &sem_opt, &sec_opt, &created, &created)).await;
    let _ = state.db.query_unpaged("INSERT INTO profiles_by_role (role, email, id, username, field_of_study, semester, section, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (&role_norm, &email, &user_id, &username, &field_opt, &sem_opt, &sec_opt, &created, &created)).await;

    let created_profile = Profile {
        id: user_id.clone(),
        email: email.clone(),
        username: Some(username.clone()),
        role: role_norm.to_string(),
        field_of_study: field_opt.clone(),
        semester: sem_opt.clone(),
        section: sec_opt.clone(),
        rfid_uid: None,
        about_me: None,
        degrees: None,
        resume_url: None,
        payout_details: None,
    };
    if let Err(err_msg) = index_student_document(&state, &created_profile).await {
        eprintln!(
            "warning: failed to index signup profile {}: {}",
            user_id, err_msg
        );
    }

    let mut token_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let expires = (Utc::now() + Duration::hours(state.session_ttl_hours)).to_rfc3339();
    let thash = token_hash(&token);
    let session_id = new_id();

    let _ = state.db.query_unpaged("INSERT INTO sessions (token_hash, id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", (&thash, &session_id, &user_id, &created, &expires, &created)).await;
    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO sessions_by_user (user_id, expires_at, token_hash) VALUES (?, ?, ?)",
            (&user_id, &expires, &thash),
        )
        .await;

    ok(
        json!({"user": {"id": user_id, "email": email, "username": username, "created_at": created}, "session": {"token": token, "expires_at": expires}}),
    )
}

pub async fn auth_signin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if !auth_rate_limit(&state, format!("signin:{}", get_token(&headers))) {
        return err(StatusCode::TOO_MANY_REQUESTS, "Too many auth attempts.");
    }
    let ident = body
        .get("identifier")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
    if ident.is_empty() || password.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Required fields missing");
    }

    let user_row = match sqlx::query(
        "SELECT id, email, username, password, created_at FROM users WHERE email=$1 OR username=$1 LIMIT 1",
    )
    .bind(&ident)
    .fetch_optional(&state.pg_pool)
    .await
    {
        Ok(v) => v,
        Err(e) => return internal_err(e),
    };
    let Some(row) = user_row else {
        return err(StatusCode::UNAUTHORIZED, "Invalid login credentials");
    };
    let id: String = match row.try_get("id") {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "Invalid login credentials"),
    };
    let email: String = match row.try_get("email") {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "Invalid login credentials"),
    };
    let username: String = match row.try_get("username") {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "Invalid login credentials"),
    };
    let u_pwd: String = match row.try_get("password") {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "Invalid login credentials"),
    };
    let created_at: String = match row.try_get("created_at") {
        Ok(v) => v,
        Err(_) => return err(StatusCode::UNAUTHORIZED, "Invalid login credentials"),
    };

    if !verify_password(password, &u_pwd) {
        return err(StatusCode::UNAUTHORIZED, "Invalid login credentials");
    }

    let mut token_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);
    let expires = (Utc::now() + Duration::hours(state.session_ttl_hours)).to_rfc3339();
    let thash = token_hash(&token);
    let session_id = new_id();
    let created = now_iso();

    let _ = state.db.query_unpaged("INSERT INTO sessions (token_hash, id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)", (&thash, &session_id, &id, &created, &expires, &created)).await;
    let _ = state
        .db
        .query_unpaged(
            "INSERT INTO sessions_by_user (user_id, expires_at, token_hash) VALUES (?, ?, ?)",
            (&id, &expires, &thash),
        )
        .await;

    ok(
        json!({"user": {"id": id, "email": email, "username": username, "created_at": created_at}, "session": {"token": token, "expires_at": expires}}),
    )
}

pub async fn auth_session(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(u) = session_user(&state, &headers).await {
        ok(
            json!({"session": {"user": {"id":u.id,"email":u.email,"username":u.username,"created_at":u.created_at}}}),
        )
    } else {
        ok(json!({"session": Value::Null}))
    }
}

pub async fn auth_signout(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let token = get_token(&headers);
    if !token.is_empty() {
        let _ = state
            .db
            .query_unpaged(
                "DELETE FROM sessions WHERE token_hash=?",
                (token_hash(&token),),
            )
            .await;
    }
    ok(json!({"ok": true}))
}
