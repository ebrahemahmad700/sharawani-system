-- 0310 Make room for a third kind of issued number.
--
-- Alone in its own migration because PostgreSQL will add a value to an enum
-- inside a transaction but will not let the same transaction use it. The next
-- migration is the one that uses it, and being a separate file it is a separate
-- transaction.

ALTER TYPE counter_kind ADD VALUE IF NOT EXISTS 'manifest';
