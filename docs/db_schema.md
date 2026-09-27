# Database Schema

NexU uses a dual-database setup to get the best of both worlds: Postgres for strict rules and ScyllaDB for raw speed.

## PostgreSQL (The Source of Truth)

This is where we store our most sensitive "rules."

### `profiles`
The main user table. 
*   **Fields**: `id`, `email`, `role`, `field_of_study`, `semester`, `section`, `rfid_uid`.
*   **Maintenance**: Updated every 24 hours by the background worker for semester progression.

### `authorized_students` & `authorized_teachers`
The whitelist tables.
*   **Students**: `email` (PK), `field_of_study`, `semester`, `section`.
*   **Teachers**: `email` (PK).
*   **Function**: Used during signup to verify if a user belongs to the college.

### `teacher_subject_access`
Specific permissions for faculty.
*   **PK**: `(teacher_id, field_of_study, semester, section, subject)`.
*   **Function**: Controls who can upload notes or mark attendance for a specific class.

---

## ScyllaDB (High-Speed Access)

Used for data that grows fast or needs to be searched instantly.

### `attendance`
Stores daily records.
*   **Partition Key**: `student_id`.
*   **Clustering Key**: `date`.
*   **Purpose**: Optimized for generating student attendance reports.

### `profiles_by_role`
A materialized view for searching users.
*   **Partition Key**: `role`.
*   **Clustering Key**: `email`.
*   **Purpose**: Allows the Admin Dashboard to list students or teachers without a heavy Postgres join.

### `notifications`
System alerts and news.
*   **Partition Key**: `partition` (defaults to 'global').
*   **Clustering Key**: `created_at` (DESC).

---

## Object Storage (MinIO)

*   **Bucket**: `nexu-resources`
*   **Structure**: Files are stored using unique UUIDs to prevent collisions. Resumes and PDF notes are handled here.
