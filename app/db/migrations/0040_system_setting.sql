-- system_setting, moved out of BUILD-PLAN.md section 2.9.
--
-- ORDERING NOTE: the plan defines this table alongside templates and the log,
-- but format_doc_number() in section 2.4 reads it, and the RLS helpers in 2.10
-- read it too. It depends only on app_user, so it is created right after the
-- people tables and well before anything that queries it.

CREATE TABLE system_setting (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]{3,48}$'),
  value       jsonb NOT NULL,
  updated_by  bigint NULL REFERENCES app_user(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE system_setting IS 'Keys in use: system_locked, lock_message, lock_by, lock_at, incoming_no_format, outgoing_no_format, session_idle_minutes, session_max_hours, working_week, tray_archive_days, assistant_backend, registry_room_code, executive_room_code.';
