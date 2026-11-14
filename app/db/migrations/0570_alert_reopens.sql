-- 0570 An alert the mayor has seen comes back when it happens again.
--
-- An alert is one row per rule, person and hour (or day), counting hits. Once the
-- mayor marked it seen, further hits in the same hour or day went onto the seen
-- row, silently: IT asking for a second letter that afternoon, or the fifty
-- letters becoming three hundred, said nothing (feature test, 13 September).
--
-- Now a hit on a seen row opens it again and tells the mayor and the deputy once
-- more. A hit on a row still unseen only counts, as before, so a runaway pattern
-- is still one bell and not three hundred.

CREATE OR REPLACE FUNCTION watch_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_role     user_role;
  v_room     bigint;
  v_local    timestamp;
  v_hour     int;
  v_from     int;
  v_to       int;
  v_n        int;
  v_kind     text;
  v_window   text;
  v_detail   jsonb := '{}'::jsonb;
  v_alert    bigint;
  v_was_seen boolean;
  v_tell     boolean := false;
  v_target   bigint;
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

    SELECT id, seen_at IS NOT NULL INTO v_alert, v_was_seen
      FROM security_alert
     WHERE kind = v_kind AND user_id = NEW.user_id AND window_key = v_window
     FOR UPDATE;

    IF v_alert IS NULL THEN
      INSERT INTO security_alert (kind, user_id, window_key, first_at, last_at, detail, log_id)
      VALUES (v_kind, NEW.user_id, v_window, NEW.occurred_at, NEW.occurred_at, v_detail, NEW.id)
      ON CONFLICT (kind, user_id, window_key) DO UPDATE
         SET hits = security_alert.hits + 1, last_at = EXCLUDED.last_at
      RETURNING id INTO v_alert;
      v_tell := true;
    ELSE
      UPDATE security_alert
         SET hits    = hits + 1,
             last_at = NEW.occurred_at,
             detail  = CASE WHEN kind IN ('bulk_open', 'refusals') THEN v_detail ELSE detail END,
             seen_by = NULL,
             seen_at = NULL
       WHERE id = v_alert;
      -- Seen, and it happened again: that is news. Unseen: it is already on the list.
      v_tell := v_was_seen;
    END IF;

    IF v_tell THEN
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
