-- 2.11 Row-level security and grants
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

ALTER TABLE document               ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_step           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment             ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_send          ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_fill          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_record           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_message      ENABLE ROW LEVEL SECURITY;

-- Documents: sysadmin sees nothing (PLAN.md §3.2 "Read letter contents ✗"). Everyone else: the scope function.
CREATE POLICY doc_select ON document FOR SELECT USING (app_role() <> 'sysadmin' AND document_visible(id));
CREATE POLICY doc_insert ON document FOR INSERT WITH CHECK (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk'));
CREATE POLICY doc_update ON document FOR UPDATE USING (app_role() <> 'sysadmin' AND document_visible(id));
-- No DELETE policy exists: deletes are impossible for docsys_app regardless of grants.

CREATE POLICY step_select ON routing_step FOR SELECT USING (app_role() <> 'sysadmin' AND document_visible(document_id));
CREATE POLICY step_insert ON routing_step FOR INSERT WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id));
CREATE POLICY step_update ON routing_step FOR UPDATE USING (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY att_select ON attachment FOR SELECT USING (app_role() <> 'sysadmin' AND document_visible(document_id));
CREATE POLICY att_insert ON attachment FOR INSERT WITH CHECK (app_role() <> 'sysadmin' AND document_visible(document_id));

CREATE POLICY send_all ON external_send USING (app_role() <> 'sysadmin' AND document_visible(document_id));
CREATE POLICY fill_all ON template_fill  USING (app_role() IN ('mayor', 'hr') OR filled_by = app_user_id()
                                                OR (document_id IS NOT NULL AND document_visible(document_id)));

-- Leave: HR, mayor, deputy see all; a directorate head sees their directorate; everyone sees their own.
CREATE POLICY leave_select ON leave_record FOR SELECT USING (
  app_role() IN ('mayor', 'deputy_mayor', 'hr')
  OR user_id = app_user_id()
  OR (SELECT room_id FROM app_user u WHERE u.id = leave_record.user_id) = ANY (app_visible_rooms()));
CREATE POLICY leave_insert ON leave_record FOR INSERT WITH CHECK (user_id = app_user_id() OR app_role() IN ('hr', 'mayor', 'deputy_mayor'));
CREATE POLICY leave_update ON leave_record FOR UPDATE USING (app_role() IN ('mayor', 'deputy_mayor', 'directorate_head', 'hr') OR user_id = app_user_id());

-- Log: PLAN.md §3.2 "Read activity log": M, DM, IT everything; DH own directorate; RH own room. Others: their own rows only.
CREATE POLICY log_select ON activity_log FOR SELECT USING (
  app_role() IN ('mayor', 'deputy_mayor', 'sysadmin')
  OR (app_role() IN ('directorate_head', 'room_head') AND room_id = ANY (app_visible_rooms()))
  OR user_id = app_user_id());
CREATE POLICY log_insert ON activity_log FOR INSERT WITH CHECK (true);

CREATE POLICY conv_own ON assistant_conversation USING (user_id = app_user_id() OR app_role() = 'mayor');
CREATE POLICY msg_own  ON assistant_message USING (
  EXISTS (SELECT 1 FROM assistant_conversation c WHERE c.id = conversation_id AND (c.user_id = app_user_id() OR app_role() = 'mayor')));

-- Grants. Note what is missing: no DELETE anywhere for docsys_app except session and tray housekeeping; no UPDATE on the log.
GRANT USAGE ON SCHEMA public TO docsys_app, docsys_readonly;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO docsys_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO docsys_app;
REVOKE UPDATE, DELETE, TRUNCATE ON activity_log FROM docsys_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM docsys_app;
GRANT DELETE ON user_session TO docsys_app;                     -- expired-session purge (§13.4)
GRANT USAGE ON SCHEMA public TO docsys_jobs;
GRANT SELECT, INSERT, UPDATE ON scan_tray_item, routing_step, room_delegation, activity_log, system_setting, external_send TO docsys_jobs;
GRANT SELECT ON room, app_user, document, leave_record, number_counter, attachment, archive_file TO docsys_jobs;
GRANT SELECT, DELETE ON user_session TO docsys_jobs;            -- the hourly purge of long-expired sessions (§13.4)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO docsys_jobs;
REVOKE UPDATE, DELETE, TRUNCATE ON activity_log FROM docsys_jobs;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO docsys_readonly;
REVOKE SELECT ON app_user FROM docsys_readonly;                 -- the assistant never sees password hashes
GRANT SELECT (id, username, full_name, role, room_id, is_active) ON app_user TO docsys_readonly;
GRANT INSERT ON activity_log, assistant_conversation, assistant_message TO docsys_readonly;   -- guard rail 6: every Q&A is logged
GRANT UPDATE (last_message_at) ON assistant_conversation TO docsys_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE docsys_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO docsys_app;
ALTER DEFAULT PRIVILEGES FOR ROLE docsys_owner IN SCHEMA public GRANT SELECT ON TABLES TO docsys_readonly;
