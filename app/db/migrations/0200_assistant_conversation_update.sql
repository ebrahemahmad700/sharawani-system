-- 0200 The assistant may update its own conversation row.
--
-- 0120 granted docsys_readonly INSERT and SELECT on assistant_conversation, but
-- the assistant has always written last_message_at at the end of every answer
-- and now also records which backend produced it. Both are UPDATEs, and the
-- grant for them was never there, so every question ended in
-- "permission denied for table assistant_conversation".
--
-- Two columns, not the whole table. The read-only role must not be able to
-- reassign a conversation to another user or rewrite when it started.

GRANT UPDATE (last_message_at, backend) ON assistant_conversation TO docsys_readonly;

COMMENT ON COLUMN assistant_conversation.backend IS
  'rules or model. Set by the assistant when it answers; the read-only role may update this column and last_message_at, nothing else.';
