-- 0400 Notifications: telling somebody the letter has reached them.
--
-- Until now the system told you nothing. A letter landed in your room and sat
-- there until you happened to open the inbox, which in practice means until the
-- person who sent it walked over and said so. That walk is the thing this table
-- removes.
--
-- Two rules shape everything below.
--
-- 1. A notification says WHAT HAPPENED, never WHAT THE LETTER SAID. The row
--    carries ids: which document, which room, who did it. The subject line is
--    not copied here. When the screen wants to show it, it joins to document and
--    row-level security decides whether the subject appears, so a person who
--    loses access to a letter stops seeing its subject in their old
--    notifications, which would not be true of a copied string. The CHECK
--    constraint on detail enforces this at the database level rather than
--    trusting every future call site; it mirrors FORBIDDEN_DETAIL_KEYS in
--    lib/log.mjs.
--
-- 2. A notification is private to the person it is for. The SELECT policy is
--    user_id = app_user_id() and there is no exception in it: not the mayor, not
--    IT. The list of what has been drawn to your attention is not a thing other
--    people get to read.
--
-- Rows are inserted only through notify_user() and notify_room() below, which
-- are SECURITY DEFINER. The application role is granted SELECT and UPDATE of one
-- column and nothing else, so a bug in a route cannot forge a notification for
-- somebody else or quietly rewrite one that was already delivered.

-- Text with a CHECK rather than an enum, on purpose. Adding a value to an enum
-- cannot happen in the same transaction that uses it, which is why migration
-- 0310 exists as a file of its own. A CHECK has no such rule.
CREATE TABLE notification (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES app_user(id),
  kind         text NOT NULL CHECK (kind IN (
                 'step.arrived',       -- a letter has reached your room
                 'step.returned',      -- a letter you sent has come back
                 'step.recalled',      -- a letter was taken back from your room
                 'step.completed',     -- a letter you sent has been finished
                 'step.due_soon',      -- its deadline is tomorrow
                 'step.overdue',       -- its deadline has passed
                 'paper.received',     -- the paper folder reached the room
                 'note.added',         -- somebody wrote a remark on the letter
                 'manifest.incoming',  -- a courier is bringing you a batch
                 'manifest.received',  -- the batch you sent has been signed for
                 'leave.requested',    -- a leave request is waiting for you
                 'leave.decided',      -- your leave request was answered
                 'delegation.started'  -- you are now covering another room
               )),
  document_id  bigint NULL REFERENCES document(id),
  room_id      bigint NULL REFERENCES room(id),
  actor_id     bigint NULL REFERENCES app_user(id),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz NULL,

  -- The same list lib/log.mjs refuses, enforced here so it holds for every call
  -- site that will ever exist, including ones written after everybody has
  -- forgotten why.
  CONSTRAINT notification_detail_is_metadata CHECK (
    NOT (detail ?| ARRAY['subject', 'body', 'text', 'content',
                         'sender_name', 'recipient_name', 'note', 'reply_note', 'opinion'])
  )
);

COMMENT ON TABLE notification IS
  'What has been drawn to one person''s attention. Ids only, never letter text; private to the recipient, with no exception for the mayor or for IT.';

-- The unread badge is read on nearly every page load, so it gets its own partial
-- index and touches nothing else.
CREATE INDEX ix_notification_unread ON notification (user_id, id DESC) WHERE read_at IS NULL;
CREATE INDEX ix_notification_list   ON notification (user_id, created_at DESC);

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_select ON notification FOR SELECT
  USING (user_id = app_user_id());

-- Marking your own as read. Column-level grants below mean read_at is the only
-- thing this can change; the kind and the document it points at are fixed at
-- insert time and stay that way.
CREATE POLICY notification_update ON notification FOR UPDATE
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

GRANT SELECT ON notification TO docsys_app;
GRANT UPDATE (read_at) ON notification TO docsys_app;
-- The assistant is not granted this. It answers questions about letters, and a
-- person's notification list is not a letter.
GRANT SELECT ON notification TO docsys_jobs;

-- --------------------------------------------------------------------------
-- Where the browser should be told, when the browser is not open
-- --------------------------------------------------------------------------
--
-- One row per installed browser. The endpoint is a URL at Google, Mozilla or
-- Apple that will hand a push to that browser.
--
-- There is deliberately no encryption key column. This system sends pushes with
-- no payload at all: the push is a doorbell, and the browser then asks this
-- server what it was about over its own authenticated connection. That means
-- nothing about a Rania letter ever passes through a push service, which is the
-- only arrangement compatible with the rule that municipal correspondence does
-- not leave the building. See lib/push.mjs.

CREATE TABLE push_subscription (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES app_user(id),
  endpoint     text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  user_agent   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_ok_at   timestamptz NULL,
  failures     integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE push_subscription IS
  'Browsers to ring when something arrives. No payload is ever sent to these, so no encryption keys are stored.';

CREATE INDEX ix_push_user ON push_subscription (user_id);

ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;

-- You may see and remove your own. Reaching other people's endpoints happens
-- only as the return value of notify_user(), below.
CREATE POLICY push_own ON push_subscription FOR SELECT USING (user_id = app_user_id());
CREATE POLICY push_own_delete ON push_subscription FOR DELETE USING (user_id = app_user_id());

GRANT SELECT, DELETE ON push_subscription TO docsys_app;

-- --------------------------------------------------------------------------
-- Raising one
-- --------------------------------------------------------------------------

/*
 * Notify one person, and say where to ring.
 *
 * Returns a row per browser that person has registered, so the caller can send
 * the doorbell. Returning the endpoints from the act of creating a notification,
 * rather than offering a function that looks them up by user, means there is no
 * way to enumerate other people's endpoints at all.
 *
 * Silently does nothing when there is nobody to tell: the actor notifying
 * themselves, an inactive account, or IT being told about a letter. That last
 * one matters. Row-level security already stops IT reading correspondence, and a
 * notification saying a letter moved would be a small leak through the side.
 */
CREATE OR REPLACE FUNCTION notify_user(
  p_user_id     bigint,
  p_kind        text,
  p_document_id bigint DEFAULT NULL,
  p_room_id     bigint DEFAULT NULL,
  p_actor_id    bigint DEFAULT NULL,
  p_detail      jsonb  DEFAULT '{}'::jsonb
) RETURNS TABLE (notification_id bigint, endpoint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_role  user_role;
  v_new   bigint;
BEGIN
  IF p_user_id IS NULL OR p_user_id = p_actor_id THEN RETURN; END IF;

  SELECT role INTO v_role FROM app_user WHERE id = p_user_id AND is_active;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_role = 'sysadmin' AND p_document_id IS NOT NULL THEN RETURN; END IF;

  INSERT INTO notification (user_id, kind, document_id, room_id, actor_id, detail)
  VALUES (p_user_id, p_kind, p_document_id, p_room_id, p_actor_id, coalesce(p_detail, '{}'::jsonb))
  RETURNING id INTO v_new;

  RETURN QUERY
    SELECT v_new, s.endpoint FROM push_subscription s WHERE s.user_id = p_user_id;
END;
$fn$;

/*
 * Notify a room: whoever is sitting in it, its head, and anyone currently
 * covering it as a delegate.
 *
 * A letter arrives at a room, not at a person. Telling only the assignee means
 * the clerk who actually opens the post never hears about it, and telling only
 * the head means nothing moves while the head is at a meeting. So: everyone with
 * a hand in that room, minus whoever caused it.
 */
CREATE OR REPLACE FUNCTION notify_room(
  p_room_id     bigint,
  p_kind        text,
  p_document_id bigint DEFAULT NULL,
  p_actor_id    bigint DEFAULT NULL,
  p_detail      jsonb  DEFAULT '{}'::jsonb
) RETURNS TABLE (notification_id bigint, endpoint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_target bigint;
BEGIN
  IF p_room_id IS NULL THEN RETURN; END IF;

  FOR v_target IN
    SELECT u.id FROM app_user u WHERE u.is_active AND u.room_id = p_room_id
    UNION
    SELECT r.head_user_id FROM room r WHERE r.id = p_room_id AND r.head_user_id IS NOT NULL
    UNION
    SELECT d.delegate_user_id FROM room_delegation d
     WHERE d.room_id = p_room_id AND d.ended_early_at IS NULL
       AND current_date BETWEEN d.starts_on AND d.ends_on
  LOOP
    RETURN QUERY
      SELECT n.notification_id, n.endpoint
        FROM notify_user(v_target, p_kind, p_document_id, p_room_id, p_actor_id, p_detail) n;
  END LOOP;
END;
$fn$;

/* Register this browser for doorbells. Own rows only, by construction. */
CREATE OR REPLACE FUNCTION push_register(p_endpoint text, p_user_agent text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id bigint; v_user bigint := app_user_id();
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  INSERT INTO push_subscription (user_id, endpoint, user_agent)
  VALUES (v_user, p_endpoint, left(p_user_agent, 500))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = v_user, user_agent = left(p_user_agent, 500), failures = 0
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

/*
 * Record how the last doorbell went.
 *
 * Separate from the table grants because the row belongs to the person being
 * rung, not to the person whose action caused the ringing, and the application
 * role is not allowed to write other people's rows. A count of failures is what
 * lets an endpoint that has quietly stopped working be spotted rather than
 * retried forever.
 */
CREATE OR REPLACE FUNCTION push_touch(p_endpoint text, p_ok boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE push_subscription
     SET last_ok_at = CASE WHEN p_ok THEN now() ELSE last_ok_at END,
         failures   = CASE WHEN p_ok THEN 0 ELSE failures + 1 END
   WHERE endpoint = p_endpoint;
$fn$;

/*
 * Forget an endpoint the push service has rejected.
 *
 * Takes no user: a browser that has been reinstalled returns 410 Gone to
 * whoever tries to ring it, and the row must go whether or not the person who
 * happened to trigger the push owns it. Deleting a push endpoint discloses
 * nothing and reveals nothing.
 */
CREATE OR REPLACE FUNCTION push_forget(p_endpoint text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM push_subscription WHERE endpoint = p_endpoint;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION notify_user(bigint, text, bigint, bigint, bigint, jsonb) TO docsys_app, docsys_jobs;
GRANT EXECUTE ON FUNCTION notify_room(bigint, text, bigint, bigint, jsonb)          TO docsys_app, docsys_jobs;
GRANT EXECUTE ON FUNCTION push_register(text, text)                                 TO docsys_app;
GRANT EXECUTE ON FUNCTION push_touch(text, boolean)                                 TO docsys_app, docsys_jobs;
GRANT EXECUTE ON FUNCTION push_forget(text)                                         TO docsys_app, docsys_jobs;

-- --------------------------------------------------------------------------
-- Waking the open browser
-- --------------------------------------------------------------------------
--
-- The web server holds an event-stream connection per signed-in browser and
-- needs to know the moment a row lands here. LISTEN/NOTIFY tells it without a
-- timer. Where LISTEN is not available, which is a pooled connection at a
-- managed provider or serverless hosting where nothing is held open,
-- lib/realtime.mjs falls back to asking every few seconds and this trigger
-- simply goes unheard.
--
-- The payload is the recipient's id and nothing else. pg_notify payloads travel
-- to every listening connection, so anything more than an id would be a copy of
-- the letter's metadata sent to every web process in the building.

CREATE OR REPLACE FUNCTION notification_announce() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('docsys_notify', NEW.user_id::text);
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER notification_announce_trg
  AFTER INSERT ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_announce();
