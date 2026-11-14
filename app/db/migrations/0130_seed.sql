-- 2.12 Seed rows
-- Extracted verbatim from BUILD-PLAN.md. Edit here, not there.

INSERT INTO system_setting (key, value) VALUES
  ('system_locked',        'false'),
  ('lock_message',         '""'),
  ('incoming_no_format',   '{"prefix": "ه"}'),        -- OPEN Q4: confirm against the paper register
  ('outgoing_no_format',   '{"prefix": "د"}'),        -- OPEN Q4
  ('session_idle_minutes', '30'),
  ('session_max_hours',    '12'),
  ('working_week',         '["sun","mon","tue","wed","thu"]'),   -- OPEN Q7: confirm
  ('tray_archive_days',    '7'),
  ('assistant_backend',    '"rules"'),                -- until the bake-off (§7, week 24) picks one
  ('registry_room_code',   '"REGISTRY"'),
  ('executive_room_code',  '"MAYOR"');

-- Rooms come from Q1. Until Q1 is answered, the fixture in §9.2 seeds the eight rooms named on the approved screens.
