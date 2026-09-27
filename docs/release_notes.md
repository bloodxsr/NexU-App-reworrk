# Release Notes: Security & Lifecycle Update

This update introduces major security hardening and automated management features to the NexU Campus OS.

## Security Hardening
*   **Mandatory Enrollment Whitelist**: Implemented a CSV-based verification system. No student or teacher can sign up unless their email is pre-authorized by an administrator.
*   **Teacher Resource Gating**: Teachers are now strictly limited to uploading resources for subjects they are assigned to. This prevents unauthorized modification of class materials.
*   **Admin Dashboard Expansion**: Added dedicated tools for managing authorized lists and linking RFID hardware to faculty.

## Automation & Lifecycle
*   **Background Maintenance Worker**: A new system task runs every 24 hours to manage the student body.
*   **Auto-Semester Progression**: Students are automatically moved to the next semester based on the academic calendar (August/January shifts).
*   **Automatic Graduation**: Accounts are transitioned to `graduated` status after completing 8 semesters (4 years), preventing unauthorized access by former students.
*   **Multi-DB Synchronization**: All automated changes are synced across Postgres and ScyllaDB to maintain data integrity.

## Internal Improvements
*   **Optimized Environment Handling**: All system constants (Session TTL, Auth Window, Max Body Size) are now configurable via `.env`.
*   **Migration Resilience**: Improved the database migration scripts to handle new tables more reliably across distributed environments.
*   **API Performance**: Switched high-frequency whitelist checks to optimized runtime queries for faster response times.

---
*Date: April 2026*
