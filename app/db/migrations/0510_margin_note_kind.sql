-- 0510 Make room for a kind of attachment: the handwritten instruction (هامش).
--
-- Alone in its own migration for the same reason as 0310: PostgreSQL adds a
-- value to an enum inside a transaction but does not let that transaction use
-- it. Migration 0550 is the one that uses it.

ALTER TYPE attachment_kind ADD VALUE IF NOT EXISTS 'margin_note';
