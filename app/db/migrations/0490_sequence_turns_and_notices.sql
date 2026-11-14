-- 0490 A room in a sequence sees the letter on its turn; rooms are told when a
--      letter they hold is cancelled or closed.
--
-- Found by the letters test of 13 September.
--
-- 1. Waiting its turn.
--    The form that sends a letter in sequence says each room sees it only when
--    its turn comes («هەر ژوورێک تەنها کاتێک دەیبینێت کە نۆرەی خۆی بێت»). It did
--    not: a step waiting at position three already made the letter visible to
--    that room, which could find it by search and open it, and a room head there
--    could even send it on before the rooms ahead of it had seen it. The step
--    rows themselves are still planned and shown on the trail to the rooms that
--    can see the letter; a waiting step just no longer grants sight of it.
--
-- 2. Being told.
--    A letter vanished from a room's inbox without a word when the front desk
--    cancelled or closed it, while a recall, which does the same to the room,
--    notified it. Two notification kinds are added.

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
                    AND s.status <> 'waiting'
                    AND (s.to_room_id = ANY (p_rooms) OR s.from_room_id = ANY (p_rooms)));
$$;

CREATE OR REPLACE FUNCTION doc_routed_through(p_document_id bigint, p_rooms bigint[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM routing_step s WHERE s.document_id = p_document_id
                    AND s.status <> 'waiting'
                    AND (s.to_room_id = ANY (p_rooms) OR s.from_room_id = ANY (p_rooms)));
$$;

-- A step touching my room is visible without a lookup, unless it is only
-- planned; otherwise it is visible when the letter is.
ALTER POLICY step_select ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((status <> 'waiting'
               AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                    OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])))
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));

ALTER POLICY step_update ON routing_step
  USING ((SELECT app_role()) <> 'sysadmin'
         AND ((status <> 'waiting'
               AND (to_room_id = ANY ((SELECT app_visible_rooms())::bigint[])
                    OR from_room_id = ANY ((SELECT app_visible_rooms())::bigint[])))
              OR doc_visible_for(document_id, (SELECT app_role()), (SELECT app_user_id()), (SELECT app_visible_rooms())::bigint[])));

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'step.arrived', 'step.returned', 'step.recalled', 'step.completed', 'step.due_soon', 'step.overdue',
  'paper.received', 'note.added', 'manifest.incoming', 'manifest.received',
  'leave.requested', 'leave.decided', 'delegation.started',
  'document.cancelled',  -- a letter your room held was cancelled
  'document.closed'      -- a letter your room held was closed with an outgoing number
));

-- 3. What a room still holds, for IT deciding whether it may be switched off.
--    The check counted routing steps as IT, and IT is not allowed to see a single
--    step, so the count was always nought and a room with letters waiting in it
--    could be switched off, stranding them (records test, 13 September). This
--    answers with numbers only, never a letter.
CREATE OR REPLACE FUNCTION room_workload(p_room_id bigint)
RETURNS TABLE (open_steps int, unsent int, staff int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (SELECT count(*)::int FROM routing_step WHERE to_room_id = p_room_id AND status IN ('active', 'waiting')),
         (SELECT count(*)::int FROM document WHERE origin_room_id = p_room_id AND status = 'registered'),
         (SELECT count(*)::int FROM app_user WHERE room_id = p_room_id AND is_active)
   WHERE app_role() IN ('sysadmin', 'mayor', 'deputy_mayor');
$$;
GRANT EXECUTE ON FUNCTION room_workload(bigint) TO docsys_app;

-- 4. A filled form prints the template as it was when it was filled.
--    Templates could not be edited, because an edit would have changed every
--    form already printed from them. Each fill now keeps its own copy.
ALTER TABLE template_fill ADD COLUMN IF NOT EXISTS body_html text NULL;
ALTER TABLE template_fill ADD COLUMN IF NOT EXISTS field_schema jsonb NULL;
COMMENT ON COLUMN template_fill.body_html IS 'The template body at the moment of filling. NULL for fills made before migration 0490, which print the current template.';
