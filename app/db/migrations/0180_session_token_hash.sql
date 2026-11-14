-- ADDITION beyond BUILD-PLAN.md. Not in the original plan.
--
-- The plan stores no session token. The session's uuid primary key is itself the
-- value placed in the cookie, and the lookup is by that id.
--
-- That works, and the uuid has enough randomness. The problem is what it means
-- if the table is ever read: a database backup, a restored copy on a technician's
-- laptop, a query run by someone who should not have run it. Every unexpired
-- session in that copy is a working credential. Anyone holding it can paste a
-- uuid into a cookie and be signed in as the mayor.
--
-- For a system whose owner has said the contents must not leave the building,
-- that is worth closing. The cookie now carries a random token that is never
-- stored; only its SHA-256 is kept. A stolen copy of this table yields hashes,
-- which cannot be turned back into cookies.
--
-- The uuid id stays exactly as it was. activity_log.session_id still references
-- it, so the audit trail is unchanged.

-- Any session that exists at migration time was issued under the old scheme and
-- cannot be verified under the new one. End them rather than leave rows that can
-- never match. In practice this is empty at first deployment.
UPDATE user_session
   SET revoked_at = now(), revoked_reason = 'session scheme changed to hashed tokens'
 WHERE revoked_at IS NULL;

ALTER TABLE user_session ADD COLUMN token_hash text;

-- Partial unique index rather than a constraint: revoked rows keep their hash
-- for the audit trail, and only live sessions need to be unique.
CREATE UNIQUE INDEX ix_session_token ON user_session (token_hash) WHERE revoked_at IS NULL;

COMMENT ON COLUMN user_session.token_hash IS
  'SHA-256 of the random token in the cookie. The token itself is never stored, so this table cannot be used to impersonate anyone. Null only on sessions issued before this migration, all of which were revoked by it.';

-- The application creates sessions and revokes them. It never updates anything
-- else about them except last_seen_at.
GRANT SELECT, INSERT, UPDATE (last_seen_at, revoked_at, revoked_reason) ON user_session TO docsys_app;
