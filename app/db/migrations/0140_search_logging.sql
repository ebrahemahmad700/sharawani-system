-- ADDITION beyond BUILD-PLAN.md. Not in the original plan.
--
-- Why: the log records opening a document but not searching for one. Someone can
-- type a citizen's name into the plot search, read the result list, learn who owns
-- what, and leave no trace at all unless they then open a record. For a leak
-- investigation the search terms are worth more than the opens, because they show
-- intent. This closes that hole.
--
-- No new table. activity_log already accepts any 'area.verb' action and carries a
-- jsonb detail, so searches are ordinary log rows. What is added here is the
-- documentation of the shape, and two indexes to make investigation queries fast.
--
-- New action codes:
--   search.documents   the main document search
--   search.archive     the drawing archive search, rooms 8 and 9
--   search.rooms       the room picker in the send dialog
--   search.people      the staff picker
--
-- detail shape, the same for all four:
--   {"q": "<the normalised query>", "raw": "<exactly what was typed>",
--    "hits": <integer>, "filters": {...}, "ms": <integer>}
--
-- The raw text is kept as well as the normalised one because the difference
-- between them is itself evidence about which keyboard a person was using.
--
-- What is deliberately NOT stored: the ids of the rows returned. Storing them
-- would copy record contents into the log, and the log is readable by IT, who
-- must not be able to read letters. The count alone still shows a broad sweep.

COMMENT ON COLUMN activity_log.detail IS
  'Ids, numbers, statuses and search terms only. Never subject text, never names from letters, never row contents. This is what lets IT read the log without reading the letters.';

-- Investigation query: everything one person searched for, newest first.
CREATE INDEX ix_log_search_user ON activity_log (user_id, occurred_at DESC)
  WHERE action LIKE 'search.%';

-- Investigation query: who searched for this term.
-- jsonb_path_ops keeps the index small and answers containment, which is what a
-- detail @> lookup on the q key needs.
CREATE INDEX ix_log_search_detail ON activity_log USING gin (detail jsonb_path_ops)
  WHERE action LIKE 'search.%';
