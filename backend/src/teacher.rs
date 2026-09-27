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

pub async fn fetch_teacher_subject_access(
    state: &AppState,
    teacher_id: &str,
) -> Result<Vec<(String, String, String, String)>, String> {
    let rows = sqlx::query(
        "SELECT field_of_study, semester, section, subject FROM teacher_subject_access WHERE teacher_id=$1",
    )
    .bind(teacher_id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut rows_data = Vec::new();
    for row in rows {
        let field_of_study: String = match row.try_get("field_of_study") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let semester: String = match row.try_get("semester") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let section: String = match row.try_get("section") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let subject: String = match row.try_get("subject") {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some((fos, sem, sec)) = normalize_class_triplet(&field_of_study, &semester, &section)
        {
            let canonical = canonical_subject(&subject).unwrap_or(subject);
            rows_data.push((fos, sem, sec, canonical));
        }
    }
    Ok(rows_data)
}

pub async fn fetch_teacher_home_classes(
    state: &AppState,
    teacher_id: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let rows = sqlx::query(
        "SELECT field_of_study, semester, section FROM class_home_teacher WHERE teacher_id=$1",
    )
    .bind(teacher_id)
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut rows_data = Vec::new();
    for row in rows {
        let field_of_study: String = match row.try_get("field_of_study") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let semester: String = match row.try_get("semester") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let section: String = match row.try_get("section") {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some((fos, sem, sec)) = normalize_class_triplet(&field_of_study, &semester, &section)
        {
            rows_data.push((fos, sem, sec));
        }
    }
    Ok(rows_data)
}

pub fn build_teacher_access_summary(
    subject_access: &[(String, String, String, String)],
    home_classes: &[(String, String, String)],
) -> (
    HashSet<String>,
    HashSet<String>,
    HashSet<String>,
    Vec<Value>,
) {
    let mut class_keys = HashSet::new();
    let mut class_subject_keys = HashSet::new();
    let mut home_class_keys = HashSet::new();
    let mut class_map: BTreeMap<String, (String, String, String, HashSet<String>, bool)> =
        BTreeMap::new();

    for (field_of_study, semester, section, subject) in subject_access {
        let key = class_key(field_of_study, semester, section);
        class_keys.insert(key.clone());
        class_subject_keys.insert(class_subject_key(
            field_of_study,
            semester,
            section,
            subject,
        ));

        let entry = class_map.entry(key).or_insert_with(|| {
            (
                field_of_study.clone(),
                semester.clone(),
                section.clone(),
                HashSet::new(),
                false,
            )
        });
        entry.3.insert(subject.clone());
    }

    for (field_of_study, semester, section) in home_classes {
        let key = class_key(field_of_study, semester, section);
        class_keys.insert(key.clone());
        home_class_keys.insert(key.clone());

        let entry = class_map.entry(key).or_insert_with(|| {
            (
                field_of_study.clone(),
                semester.clone(),
                section.clone(),
                HashSet::new(),
                true,
            )
        });
        entry.4 = true;
    }

    let mut allowed_classes = Vec::new();
    for (_k, (field_of_study, semester, section, subjects, is_home_teacher)) in class_map {
        let mut sorted_subjects: Vec<String> = subjects.into_iter().collect();
        sorted_subjects.sort();
        allowed_classes.push(json!({
            "field_of_study": field_of_study,
            "semester": semester,
            "section": section,
            "subjects": sorted_subjects,
            "is_home_teacher": is_home_teacher,
        }));
    }

    (
        class_keys,
        class_subject_keys,
        home_class_keys,
        allowed_classes,
    )
}

pub async fn build_teacher_access_payload(
    state: &AppState,
    teacher_id: &str,
) -> Result<Value, String> {
    let mut subject_access = fetch_teacher_subject_access(state, teacher_id).await?;
    let mut home_classes = fetch_teacher_home_classes(state, teacher_id).await?;
    subject_access.sort();
    home_classes.sort();

    let (_class_keys, _class_subject_keys, _home_class_keys, allowed_classes) =
        build_teacher_access_summary(&subject_access, &home_classes);

    let subject_access_json: Vec<Value> = subject_access
        .into_iter()
        .map(|(field_of_study, semester, section, subject)| {
            json!({
                "field_of_study": field_of_study,
                "semester": semester,
                "section": section,
                "subject": subject,
            })
        })
        .collect();

    let home_classes_json: Vec<Value> = home_classes
        .into_iter()
        .map(|(field_of_study, semester, section)| {
            json!({
                "field_of_study": field_of_study,
                "semester": semester,
                "section": section,
            })
        })
        .collect();

    Ok(json!({
        "teacher_id": teacher_id,
        "subject_access": subject_access_json,
        "home_classes": home_classes_json,
        "allowed_classes": allowed_classes,
    }))
}

pub async fn teacher_my_access(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(u) = session_user(&state, &headers).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let Some(reqp) = get_profile(&state, &u.id).await else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if reqp.role != "teacher" {
        return err(
            StatusCode::FORBIDDEN,
            "Only teachers can access this endpoint",
        );
    }

    match build_teacher_access_payload(&state, &u.id).await {
        Ok(data) => ok(json!({"data": data})),
        Err(e) => internal_err(e),
    }
}
