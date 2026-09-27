# Architecture Overview

NexU is built to handle the high-concurrency needs of a college campus while keeping data strictly organized and secure.

## Core Logic

### 1. The Maintenance Engine
We implemented a background worker (running on a dedicated Tokio task) that acts as the "Brain" of the student lifecycle.
*   **Frequency**: Runs every 24 hours.
*   **Logic**: It calculates the current academic progress based on the student's enrollment date and the current month.
*   **Term Splits**: 
    *   August to December (Term 1)
    *   January to June (Term 2)
*   **Consistency**: When a change is detected (like a semester upgrade), the engine performs a "Dual-Update" to both PostgreSQL (for relational integrity) and ScyllaDB (for search performance).

### 2. Authorization Gating
We use a multi-layered security model:
*   **The Whitelist Layer**: New users are checked against an `authorized_students` or `authorized_teachers` table during signup. These tables are only accessible for writing by Admins.
*   **The Teacher Access Layer**: Teacher permissions are granular. Instead of blanket "Teacher" access, the system checks specific `teacher_subject_access` rules before allowing resource uploads or attendance marking.

## Storage Strategy

*   **PostgreSQL**: Serves as our "Source of Truth" for complex relational data (Who is authorized? Who is a home teacher for which class?).
*   **ScyllaDB**: Handles our "Activity Data" and "Search Views." We duplicate student profile info here so that searching 10,000+ students remains lightning fast without hitting the main relational DB.
*   **MinIO**: Stores the heavy lifting—PDFs, resumes, and images.

## Frontend Structure
The frontend is a single-page app (SPA) that communicates with the backend via a secure JSON API.
*   **Session Management**: Uses secure tokens stored in `localStorage` with TTL (Time To Live) expiration logic.
*   **Real-time UI**: Uses TanStack Query to ensure that when an admin updates a teacher's access, the change is reflected immediately without a page reload.

## Deployment
Everything is orchestrated through Docker. We use a 3-node ScyllaDB cluster to ensure that even if one database node goes down, the college portal stays online.
