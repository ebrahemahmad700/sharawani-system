-- 2.10 Helper functions
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

-- Identity of the acting user for this transaction. The application sets it with
--   SET LOCAL app.user_id = '<id>'
-- immediately after BEGIN, on every transaction, for both docsys_app and docsys_readonly (§5.2).
CREATE OR REPLACE FUNCTION app_user_id() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::bigint;
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS user_role LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM app_user WHERE id = app_user_id() AND is_active;
$$;

CREATE OR REPLACE FUNCTION app_room_id() RETURNS bigint LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT room_id FROM app_user WHERE id = app_user_id() AND is_active;
$$;

CREATE OR REPLACE FUNCTION registry_room_id() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM room WHERE kind = 'registry' AND is_active;
$$;

CREATE OR REPLACE FUNCTION executive_room_id() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM room WHERE kind = 'executive' AND is_active;
$$;

-- The rooms whose queues the acting user may see. This is the whole of "the mayor sees all rooms, a room head sees his own".
CREATE OR REPLACE FUNCTION app_visible_rooms() RETURNS bigint[] LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE app_role()
    WHEN 'mayor'            THEN (SELECT array_agg(id) FROM room)
    WHEN 'deputy_mayor'     THEN (SELECT array_agg(id) FROM room)
    WHEN 'directorate_head' THEN (SELECT array_agg(r.id) FROM room r
                                   WHERE r.directorate_id = (SELECT directorate_id FROM room WHERE id = app_room_id())
                                      OR r.id = app_room_id())
    WHEN 'sysadmin'         THEN '{}'::bigint[]
    ELSE ARRAY[app_room_id()]
  END
  -- plus any room the user is currently covering as delegate
  || coalesce((SELECT array_agg(room_id) FROM room_delegation
                WHERE delegate_user_id = app_user_id() AND ended_early_at IS NULL
                  AND current_date BETWEEN starts_on AND ends_on), '{}');
$$;

-- Whether the acting user may see a given document at all (metadata and content).
CREATE OR REPLACE FUNCTION document_visible(p_document_id bigint) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
      OR EXISTS (SELECT 1 FROM document d WHERE d.id = p_document_id
                    AND (d.current_room_id = ANY (app_visible_rooms()) OR d.incoming_registered_by = app_user_id()))
      OR EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = p_document_id
                    AND (s.to_room_id = ANY (app_visible_rooms()) OR s.from_room_id = ANY (app_visible_rooms())));
$$;

-- Who should receive a step activated in this room today: the delegate if a delegation is live, else the head.
CREATE OR REPLACE FUNCTION resolve_room_assignee(p_room_id bigint, p_on date DEFAULT current_date,
                                                 OUT user_id bigint, OUT delegation_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(d.delegate_user_id, r.head_user_id), d.id
    FROM room r
    LEFT JOIN LATERAL (
      SELECT id, delegate_user_id FROM room_delegation
       WHERE room_id = r.id AND ended_early_at IS NULL AND p_on BETWEEN starts_on AND ends_on
       ORDER BY created_at DESC LIMIT 1
    ) d ON true
   WHERE r.id = p_room_id;
$$;

CREATE OR REPLACE FUNCTION system_is_locked() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT (value)::boolean FROM system_setting WHERE key = 'system_locked'), false);
$$;
