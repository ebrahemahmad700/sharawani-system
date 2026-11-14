-- 0480 The permission check, once per query instead of once per row.
--
-- Found by the browser audit of 13 September: the sent list, search and the
-- register took 2.3 to 5 seconds for every ordinary room, and 0.2 seconds for the
-- front desk and the mayor, with only 553 letters in the database. The time grew
-- with the number of letters in the building, not in the room, so a year of real
-- letters would have made those screens unusable.
--
-- WHY
--
-- Every policy called app_role(), app_user_id() and app_visible_rooms() for
-- every row it looked at, and document_visible() called app_visible_rooms()
-- three more times inside itself. Each of those is a SECURITY DEFINER function
-- with its own search_path, so none is inlined, and each looks the person up in
-- app_user again. About four milliseconds a letter, for the same answer every
-- time.
--
-- WHAT CHANGES
--
-- Written as (SELECT app_role()), a stable function becomes an InitPlan: worked
-- out once when the statement starts and reused for every row. The answer cannot
-- differ between rows, because the person cannot change in the middle of a
-- statement, so this is the same rule evaluated fewer times. The sent list for
-- the land room went from 2,231 ms to 18 ms.
--
-- The document check itself moves into doc_visible_for(), which is handed the
-- role, the person and the rooms instead of asking for them. document_visible()
-- stays, with exactly the meaning 0450 gave it, for the functions that call it.
--
-- WHAT DOES NOT CHANGE
--
-- Who can see what. Every policy below is the policy that was in force, rewritten
-- mechanically from pg_policies, with the four on document and routing_step
-- written out by hand in the same terms. test/guarantees.test.mjs and
-- test/routing.test.mjs hold the rules themselves.

CREATE OR REPLACE FUNCTION doc_visible_for(p_document_id bigint, p_role user_role, p_user_id bigint, p_rooms bigint[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_role IN ('mayor', 'deputy_mayor', 'registry_clerk')
      OR EXISTS (SELECT 1 FROM document d WHERE d.id = p_document_id
                    AND (d.current_room_id = ANY (p_rooms)
                         OR d.incoming_registered_by = p_user_id
                         OR d.origin_room_id = ANY (p_rooms)))
      OR EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = p_document_id
                    AND (s.to_room_id = ANY (p_rooms) OR s.from_room_id = ANY (p_rooms)));
$$;

-- Only the routing half, for the document table's own policies, which already
-- have the row's columns in hand and need not look the letter up again.
CREATE OR REPLACE FUNCTION doc_routed_through(p_document_id bigint, p_rooms bigint[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = p_document_id
                    AND (s.to_room_id = ANY (p_rooms) OR s.from_room_id = ANY (p_rooms)));
$$;

CREATE OR REPLACE FUNCTION document_visible(p_document_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT doc_visible_for(p_document_id, app_role(), app_user_id(), app_visible_rooms());
$$;

GRANT EXECUTE ON FUNCTION doc_visible_for(bigint, user_role, bigint, bigint[]) TO docsys_app, docsys_jobs, docsys_readonly;
GRANT EXECUTE ON FUNCTION doc_routed_through(bigint, bigint[]) TO docsys_app, docsys_jobs, docsys_readonly;

-- The letter itself. The columns are read from the row, and only the routing
-- history needs a lookup. The inline columns are also what lets INSERT ...
-- RETURNING pass for a room's own new letter (see 0450).
ALTER POLICY doc_select ON document
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'registry_clerk')
              OR current_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR origin_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR incoming_registered_by = (SELECT app_user_id())
              OR doc_routed_through(id, (SELECT app_visible_rooms())::bigint[])));

ALTER POLICY doc_update ON document
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'registry_clerk')
              OR current_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR origin_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR incoming_registered_by = (SELECT app_user_id())
              OR doc_routed_through(id, (SELECT app_visible_rooms())::bigint[])));

-- A hand-off. One that touches my room needs no lookup; any other is visible
-- when the letter is.
ALTER POLICY step_select ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));

ALTER POLICY step_update ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));

-- Everything else, as it was, with the helpers evaluated once.

ALTER POLICY log_select ON activity_log
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'sysadmin'::user_role])) OR (((SELECT app_role()) = ANY (ARRAY['directorate_head'::user_role, 'room_head'::user_role])) AND (room_id = ANY ((SELECT app_visible_rooms())::bigint[]))) OR (user_id = (SELECT app_user_id()))));
ALTER POLICY archive_insert ON archive_file
  WITH CHECK (((SELECT app_role()) = ANY (ARRAY['archive_clerk'::user_role, 'mayor'::user_role, 'deputy_mayor'::user_role])));
ALTER POLICY archive_select ON archive_file
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'directorate_head'::user_role, 'room_head'::user_role, 'room_clerk'::user_role, 'archive_clerk'::user_role])));
ALTER POLICY archive_update ON archive_file
  USING (((SELECT app_role()) = ANY (ARRAY['archive_clerk'::user_role, 'mayor'::user_role, 'deputy_mayor'::user_role])));
ALTER POLICY conv_own ON assistant_conversation
  USING (((user_id = (SELECT app_user_id())) OR ((SELECT app_role()) = 'mayor'::user_role)));
ALTER POLICY msg_own ON assistant_message
  USING ((EXISTS ( SELECT 1
   FROM assistant_conversation c
  WHERE ((c.id = assistant_message.conversation_id) AND ((c.user_id = (SELECT app_user_id())) OR ((SELECT app_role()) = 'mayor'::user_role))))));
ALTER POLICY att_insert ON attachment
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY att_select ON attachment
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY company_insert ON company
  WITH CHECK (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'room_head'::user_role, 'room_clerk'::user_role])));
ALTER POLICY company_select ON company
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'directorate_head'::user_role, 'room_head'::user_role, 'room_clerk'::user_role, 'registry_clerk'::user_role, 'archive_clerk'::user_role])));
ALTER POLICY company_update ON company
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'room_head'::user_role, 'room_clerk'::user_role])));
ALTER POLICY company_document_delete ON company_document
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY company_document_insert ON company_document
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY company_document_select ON company_document
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY company_file_insert ON company_file
  WITH CHECK (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'room_head'::user_role, 'room_clerk'::user_role])));
ALTER POLICY company_file_select ON company_file
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'directorate_head'::user_role, 'room_head'::user_role, 'room_clerk'::user_role, 'registry_clerk'::user_role, 'archive_clerk'::user_role])));
ALTER POLICY company_file_update ON company_file
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'room_head'::user_role, 'room_clerk'::user_role])));
ALTER POLICY dispatch_item_delete ON dispatch_item
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY dispatch_item_insert ON dispatch_item
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY dispatch_item_select ON dispatch_item
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY manifest_insert ON dispatch_manifest
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND (from_room_id = ANY ((SELECT app_visible_rooms())::bigint[]))));
ALTER POLICY manifest_select ON dispatch_manifest
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role])) OR (from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])) OR (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[]))));
ALTER POLICY manifest_update ON dispatch_manifest
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND ((from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])) OR (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])))));
ALTER POLICY doc_type_option_insert ON doc_type_option
  WITH CHECK (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'sysadmin'::user_role])));
ALTER POLICY doc_type_option_select ON doc_type_option
  USING (((SELECT app_user_id()) IS NOT NULL));
ALTER POLICY doc_type_option_update ON doc_type_option
  USING (((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role, 'sysadmin'::user_role])));
ALTER POLICY doc_insert ON document
  WITH CHECK ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role])) OR (((SELECT app_role()) = ANY (ARRAY['directorate_head'::user_role, 'room_head'::user_role, 'room_clerk'::user_role, 'archive_clerk'::user_role, 'hr'::user_role])) AND (incoming_registered_by = (SELECT app_user_id())) AND (origin_room_id IS NOT NULL) AND (origin_room_id = (SELECT app_room_id())))));
ALTER POLICY daf_delete ON document_archive_file
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY daf_insert ON document_archive_file
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY daf_select ON document_archive_file
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY note_insert ON document_note
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]) AND (author_id = (SELECT app_user_id()))));
ALTER POLICY note_select ON document_note
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY track_insert ON document_track
  WITH CHECK ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role])) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY track_select ON document_track
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'registry_clerk'::user_role])) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY send_all ON external_send
  USING ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY file_blob_read ON file_blob
  USING ((blob_pointer_visible(stored_path) OR ((uploaded_by IS NOT NULL) AND (uploaded_by = (SELECT app_user_id())) AND (created_at > (now() - '00:05:00'::interval)) AND (NOT blob_pointer_visible_to_anyone(stored_path)))));
ALTER POLICY leave_insert ON leave_record
  WITH CHECK (((user_id = (SELECT app_user_id())) OR ((SELECT app_role()) = ANY (ARRAY['hr'::user_role, 'mayor'::user_role, 'deputy_mayor'::user_role]))));
ALTER POLICY leave_select ON leave_record
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'hr'::user_role])) OR (user_id = (SELECT app_user_id())) OR (( SELECT u.room_id
   FROM app_user u
  WHERE (u.id = leave_record.user_id)) = ANY ((SELECT app_visible_rooms())::bigint[]))));
ALTER POLICY leave_update ON leave_record
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'deputy_mayor'::user_role, 'directorate_head'::user_role, 'hr'::user_role])) OR (user_id = (SELECT app_user_id()))));
ALTER POLICY notification_select ON notification
  USING ((user_id = (SELECT app_user_id())));
ALTER POLICY notification_update ON notification
  USING ((user_id = (SELECT app_user_id())))
  WITH CHECK ((user_id = (SELECT app_user_id())));
ALTER POLICY push_own ON push_subscription
  USING ((user_id = (SELECT app_user_id())));
ALTER POLICY push_own_delete ON push_subscription
  USING ((user_id = (SELECT app_user_id())));
ALTER POLICY step_insert ON routing_step
  WITH CHECK ((((SELECT app_role()) <> 'sysadmin'::user_role) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));
ALTER POLICY tray_insert ON scan_tray_item
  WITH CHECK ((((SELECT app_role()) = ANY (ARRAY['registry_clerk'::user_role, 'room_clerk'::user_role, 'room_head'::user_role, 'archive_clerk'::user_role, 'mayor'::user_role, 'deputy_mayor'::user_role, 'directorate_head'::user_role])) AND (uploaded_by = (SELECT app_user_id())) AND (NOT (room_id IS DISTINCT FROM (SELECT app_room_id())))));
ALTER POLICY tray_select ON scan_tray_item
  USING ((tray_room_visible(room_id, uploaded_by) OR (claimed_by = (SELECT app_user_id()))));
ALTER POLICY scanner_insert ON scanner
  WITH CHECK (((SELECT app_role()) = ANY (ARRAY['sysadmin'::user_role, 'mayor'::user_role, 'deputy_mayor'::user_role])));
ALTER POLICY scanner_select ON scanner
  USING (((SELECT app_user_id()) IS NOT NULL));
ALTER POLICY scanner_update ON scanner
  USING (((SELECT app_user_id()) IS NOT NULL));
ALTER POLICY fill_all ON template_fill
  USING ((((SELECT app_role()) = ANY (ARRAY['mayor'::user_role, 'hr'::user_role])) OR (filled_by = (SELECT app_user_id())) OR ((document_id IS NOT NULL) AND doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[]))));
