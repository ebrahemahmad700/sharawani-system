-- 0520 The escalation ladder (پلەکانی بەرزکردنەوە).
--
-- A letter past its deadline was mentioned once, to its room, on the morning the
-- deadline went, and then never again. A letter a week late looked exactly like
-- a letter a day late, and the mayor found out by asking.
--
-- Now lateness climbs:
--
--   rung 1  a day late      the person holding it is reminded
--   rung 2  three days late the head of the room is told
--   rung 3  five days late  the mayor and the deputy are told, and the letter is
--                           listed on the dashboard with the holder's name
--
-- The three numbers are settings (system_setting) that the mayor can change, and
-- a transaction type can set its own head and mayor numbers: a building permit
-- and a complaint about a streetlight should not climb at the same speed. The
-- deadline itself was already per type (doc_type_option.default_due_days).
--
-- Each rung is announced once per step, ever, by the same NOT EXISTS against
-- notifications the deadlines job already uses.

ALTER TABLE doc_type_option
  ADD COLUMN escalate_head_days  int NULL CHECK (escalate_head_days BETWEEN 1 AND 60),
  ADD COLUMN escalate_mayor_days int NULL CHECK (escalate_mayor_days BETWEEN 2 AND 90),
  ADD CONSTRAINT doc_type_ladder_order CHECK (
    escalate_head_days IS NULL OR escalate_mayor_days IS NULL OR escalate_head_days < escalate_mayor_days);

COMMENT ON COLUMN doc_type_option.escalate_head_days IS
  'Days past the deadline before the head of the room is told. NULL: the escalate_head_days setting.';
COMMENT ON COLUMN doc_type_option.escalate_mayor_days IS
  'Days past the deadline before the mayor is told. NULL: the escalate_mayor_days setting.';

INSERT INTO system_setting (key, value) VALUES
  ('escalate_reminder_days', '1'::jsonb),
  ('escalate_head_days',     '3'::jsonb),
  ('escalate_mayor_days',    '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

/*
 * A whole number from system_setting, or the default.
 *
 * Anything that is not a plain number reads as the default rather than raising:
 * this is called from a trigger on the activity log, and a mistyped setting must
 * never be the reason somebody cannot sign in.
 */
CREATE OR REPLACE FUNCTION setting_int(p_key text, p_default int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT (value #>> '{}')::int FROM system_setting
      WHERE key = p_key AND (value #>> '{}') ~ '^\d{1,4}$'),
    p_default);
$$;
GRANT EXECUTE ON FUNCTION setting_int(text, int) TO docsys_app, docsys_jobs, docsys_readonly;

/*
 * Every active step past its deadline, with how far up the ladder it is.
 *
 * security_invoker, so row-level security answers as whoever asks: the mayor's
 * dashboard sees every room, a room head their own, IT nothing. The jobs role
 * bypasses row-level security and sees all of it, which is what it needs.
 *
 * The mayor's number is kept above the head's, whatever a type or a setting
 * says, so a letter never reaches the mayor before its own room head has heard.
 */
CREATE VIEW late_step WITH (security_invoker = true) AS
SELECT s.id AS step_id, s.document_id, s.to_room_id, s.assigned_to, s.sent_at, s.due_at,
       extract(epoch FROM (now() - s.due_at)) / 86400 AS days_late,
       l.reminder_days, l.head_days, l.mayor_days,
       CASE WHEN now() - s.due_at >= make_interval(days => l.mayor_days)    THEN 3
            WHEN now() - s.due_at >= make_interval(days => l.head_days)     THEN 2
            WHEN now() - s.due_at >= make_interval(days => l.reminder_days) THEN 1
            ELSE 0 END AS rung
  FROM routing_step s
  JOIN document d ON d.id = s.document_id
  LEFT JOIN doc_type_option o ON o.id = d.doc_type_option_id
  CROSS JOIN LATERAL (
    SELECT setting_int('escalate_reminder_days', 1) AS reminder_days,
           coalesce(o.escalate_head_days, setting_int('escalate_head_days', 3)) AS head_days,
           greatest(coalesce(o.escalate_mayor_days, setting_int('escalate_mayor_days', 5)),
                    coalesce(o.escalate_head_days, setting_int('escalate_head_days', 3)) + 1) AS mayor_days
  ) l
 WHERE s.status = 'active'
   AND s.due_at < now()
   AND d.status NOT IN ('closed', 'cancelled');

COMMENT ON VIEW late_step IS
  'Active steps past their deadline and their rung on the escalation ladder: 1 holder reminded, 2 room head told, 3 mayor told.';

GRANT SELECT ON late_step TO docsys_app, docsys_jobs, docsys_readonly;

-- The new things a bell can say.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'step.arrived', 'step.returned', 'step.recalled', 'step.completed', 'step.due_soon', 'step.overdue',
  'paper.received', 'note.added', 'manifest.incoming', 'manifest.received',
  'leave.requested', 'leave.decided', 'delegation.started',
  'document.cancelled', 'document.closed',
  'step.late_reminder',   -- rung 1: a letter you hold is late
  'step.escalated_head',  -- rung 2: a letter in the room you head is late
  'step.escalated_mayor', -- rung 3: a letter is late enough for the mayor
  'report.weekly',        -- the weekly room report is ready (0530 has no table; the page reads live)
  'security.alert',       -- something in the activity log looks wrong (0530)
  'margin.written'        -- a handwritten instruction was written on a letter your room holds (0550)
));
