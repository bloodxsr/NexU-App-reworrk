use scylla::macros::FromRow;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub body: String,
    pub file_url: Option<String>,
    pub author_id: String,
    pub author_name: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateResourceReq {
    pub title: String,
    pub file_url: String,
    #[serde(rename = "type")]
    pub rtype: String,
    pub deadline: Option<String>,
    pub field_of_study: String,
    pub semester: String,
    pub section: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Resource {
    pub field_of_study: String,
    pub semester: String,
    pub section: String,
    pub created_at: String,
    pub id: String,
    pub title: String,
    pub file_url: Option<String>,
    #[serde(rename = "type")]
    pub resource_type: Option<String>,
    pub teacher_id: Option<String>,
    pub deadline: Option<String>,
    pub subject: Option<String>,
}

#[derive(Clone)]
pub struct AttemptState {
    pub count: u32,
    pub first_ts: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub username: String,
    pub password: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Profile {
    pub id: String,
    pub email: String,
    pub username: Option<String>,
    pub role: String,
    pub field_of_study: Option<String>,
    pub semester: Option<String>,
    pub section: Option<String>,
    pub rfid_uid: Option<String>,
    pub about_me: Option<String>,
    pub degrees: Option<String>,
    pub resume_url: Option<String>,
    pub payout_details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct ClassSchedule {
    pub class_key: String,
    pub day: String,
    pub slot: String,
    pub id: String,
    pub title: String,
    pub location: String,
    pub subject: Option<String>,
    pub teacher_id: Option<String>,
    pub teacher_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct ClassAssignment {
    pub class_key: String,
    pub created_at: String,
    pub id: String,
    pub title: String,
    pub description: String,
    pub due_date: String,
    pub subject: Option<String>,
    pub teacher_id: Option<String>,
    pub teacher_name: Option<String>,
}

