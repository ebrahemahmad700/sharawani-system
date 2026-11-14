-- 0530 Something in the log looks wrong (ئاگادارییە ئەمنییەکان).
--
-- The activity log records everything and nobody reads it until after the fact.
-- These are the few patterns worth telling the mayor about while they happen:
--
--   bulk_open            one person opens fifty letters or more in an hour
--   night_login          somebody signs in between ten at night and six in the morning
--   it_letter            the IT account tries to open a letter or an attachment
--   refusals             ten refused letters or more in half an hour: somebody trying numbers
--   other_room_download  a room downloads an attachment of a letter no longer in that room
--
-- WHY A TRIGGER. The rules watch the log table itself, not the routes that write
-- to it. A letter view written by a direct INSERT, a route added next year, a job:
-- every row passes the same rules, and there is no code path that forgets to call
-- them. That is the same promise the log itself makes.
--
-- WHY IT CANNOT BREAK ANYTHING. The rules run inside the transaction of whatever
-- was logged, which includes signing in. The whole body is wrapped so any error
-- becomes a warning in the server log and the sign-in or the view goes on. A
-- security bell that locks the building out would be worse than none.
--
-- WHAT AN ALERT HOLDS. Ids and counts, the same as a notification: never a
-- subject or a name. One row per rule, person and hour (or day), counting hits,
-- so a runaway pattern is one line that says 312, not 312 lines. The mayor and
-- the deputy are told once per row.
--
-- WHO SEES THEM. The mayor and the deputy. Not IT: one of the rules is about IT.

CREATE TABLE security_alert (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('bulk_open', 'night_login', 'it_letter', 'refusals', 'other_room_download')),
  user_id     bigint NOT NULL REFERENCES app_user(id),     -- whose action it was
  window_key  text NOT NULL CHECK (window_key ~ '^\d{4}-\d{2}-\d{2}(T\d{2})?$'),
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  hits        int NOT NULL DEFAULT 1 CHECK (hits >= 1),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  log_id      bigint NULL,                                  -- the log row that raised it
  seen_by     bigint NULL REFERENCES app_user(id),
  seen_at     timestamptz NULL,
  CONSTRAINT security_alert_once UNIQUE (kind, user_id, window_key),
  CONSTRAINT security_alert_seen_pair CHECK ((seen_by IS NULL) = (seen_at IS NULL)),
  CONSTRAINT security_alert_detail_is_metadata CHECK (
    NOT (detail ?| ARRAY['subject', 'body', 'text', 'content',
                         'sender_name', 'recipient_name', 'note', 'reply_note', 'opinion']))
);

COMMENT ON TABLE security_alert IS
  'Patterns in the activity log worth telling the mayor about. Raised only by watch_activity(); ids and counts only; readable by the mayor and deputy.';

CREATE INDEX ix_security_alert_recent ON security_alert (last_at DESC);
CREATE INDEX ix_security_alert_unseen ON security_alert (id DESC) WHERE seen_at IS NULL;

ALTER TABLE security_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY security_alert_select ON security_alert FOR SELECT
  USING ((SELECT app_role()) IN ('mayor', 'deputy_mayor'));
CREATE POLICY security_alert_update ON security_alert FOR UPDATE
  USING ((SELECT app_role()) IN ('mayor', 'deputy_mayor'))
  WITH CHECK ((SELECT app_role()) IN ('mayor', 'deputy_mayor') AND seen_by = (SELECT app_user_id()));

GRANT SELECT ON security_alert TO docsys_app, docsys_jobs;
GRANT UPDATE (seen_by, seen_at) ON security_alert TO docsys_app;

INSERT INTO system_setting (key, value) VALUES
  ('alert_bulk_opens',  '50'::jsonb),
  ('alert_night_from',  '22'::jsonb),
  ('alert_night_to',    '6'::jsonb),
  ('alert_refusals',    '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION watch_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_role    user_role;
  v_room    bigint;
  v_local   timestamp;
  v_hour    int;
  v_from    int;
  v_to      int;
  v_n       int;
  v_kind    text;
  v_window  text;
  v_detail  jsonb := '{}'::jsonb;
  v_alert   bigint;
  v_new     boolean;
  v_target  bigint;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NULL; END IF;

  BEGIN
    SELECT role, room_id INTO v_role, v_room FROM app_user WHERE id = NEW.user_id;
    v_local := NEW.occurred_at AT TIME ZONE 'Asia/Baghdad';

    IF NEW.action = 'auth.login' THEN
      v_hour := extract(hour FROM v_local)::int;
      v_from := setting_int('alert_night_from', 22);
      v_to   := setting_int('alert_night_to', 6);
      IF (v_from > v_to AND (v_hour >= v_from OR v_hour < v_to))
         OR (v_from < v_to AND v_hour >= v_from AND v_hour < v_to) THEN
        v_kind := 'night_login';
        v_window := to_char(v_local, 'YYYY-MM-DD');
        v_detail := jsonb_build_object('hour', v_hour, 'minute', extract(minute FROM v_local)::int);
      END IF;

    ELSIF NEW.action = 'access.refused' THEN
      IF v_role = 'sysadmin' AND NEW.detail ->> 'what' IN ('document', 'attachment') THEN
        v_kind := 'it_letter';
        v_window := to_char(v_local, 'YYYY-MM-DD');
        v_detail := jsonb_build_object('what', NEW.detail ->> 'what', 'target_id', NEW.detail -> 'target_id');
      ELSE
        SELECT count(*) INTO v_n FROM activity_log
         WHERE user_id = NEW.user_id AND action = 'access.refused'
           AND occurred_at > NEW.occurred_at - interval '30 minutes';
        IF v_n >= setting_int('alert_refusals', 10) THEN
          v_kind := 'refusals';
          v_window := to_char(v_local, 'YYYY-MM-DD"T"HH24');
          v_detail := jsonb_build_object('count', v_n);
        END IF;
      END IF;

    ELSIF NEW.action IN ('document.viewed', 'attachment.viewed', 'attachment.downloaded') THEN
      SELECT count(DISTINCT document_id) INTO v_n FROM activity_log
       WHERE user_id = NEW.user_id
         AND action IN ('document.viewed', 'attachment.viewed', 'attachment.downloaded')
         AND document_id IS NOT NULL
         AND occurred_at > NEW.occurred_at - interval '1 hour';
      IF v_n >= setting_int('alert_bulk_opens', 50) THEN
        v_kind := 'bulk_open';
        v_window := to_char(v_local, 'YYYY-MM-DD"T"HH24');
        v_detail := jsonb_build_object('count', v_n);
      ELSIF NEW.action = 'attachment.downloaded'
            AND v_role IN ('room_head', 'room_clerk', 'archive_clerk', 'hr')
            AND NEW.document_id IS NOT NULL
            AND NOT EXISTS (
                  SELECT 1 FROM document d
                   WHERE d.id = NEW.document_id
                     AND (d.current_room_id = v_room
                          OR d.current_room_id IN (
                               SELECT room_id FROM room_delegation
                                WHERE delegate_user_id = NEW.user_id AND ended_early_at IS NULL
                                  AND current_date BETWEEN starts_on AND ends_on))) THEN
        v_kind := 'other_room_download';
        v_window := to_char(v_local, 'YYYY-MM-DD');
        v_detail := jsonb_build_object(
          'document_id', NEW.document_id,
          'room_id', (SELECT current_room_id FROM document WHERE id = NEW.document_id));
      END IF;
    END IF;

    IF v_kind IS NULL THEN RETURN NULL; END IF;

    INSERT INTO security_alert (kind, user_id, window_key, first_at, last_at, detail, log_id)
    VALUES (v_kind, NEW.user_id, v_window, NEW.occurred_at, NEW.occurred_at, v_detail, NEW.id)
    ON CONFLICT (kind, user_id, window_key) DO UPDATE
       SET hits    = security_alert.hits + 1,
           last_at = EXCLUDED.last_at,
           detail  = CASE WHEN security_alert.kind IN ('bulk_open', 'refusals')
                          THEN EXCLUDED.detail ELSE security_alert.detail END
    RETURNING id, (xmax = 0) INTO v_alert, v_new;

    -- Told once per alert row, not once per hit.
    IF v_new THEN
      FOR v_target IN
        SELECT id FROM app_user WHERE is_active AND role IN ('mayor', 'deputy_mayor')
      LOOP
        PERFORM notify_user(v_target, 'security.alert', NULL, NULL, NEW.user_id,
                            jsonb_build_object('alert_id', v_alert, 'alert', v_kind));
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'watch_activity skipped log row %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER trg_watch_activity
  AFTER INSERT ON activity_log
  FOR EACH ROW
  WHEN (NEW.action IN ('auth.login', 'access.refused', 'document.viewed', 'attachment.viewed', 'attachment.downloaded'))
  EXECUTE FUNCTION watch_activity();
