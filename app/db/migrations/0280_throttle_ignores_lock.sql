-- 0280 The sign-in throttle must ignore refusals caused by the maintenance lock.
--
-- When the mayor locks the system, everyone else who tries to sign in is refused,
-- and login() records that as auth.login_failed with reason 'system_locked'. The
-- throttle counted those, so:
--
--   the mayor locks the system for maintenance
--   five members of staff try to sign in and are told the system is locked
--   the mayor unlocks it
--   those five are now throttled, and told to wait, for something they did not do
--
-- It surfaced in the test that locks the system and checks that others can sign in
-- again afterwards: they could not, and the answer was 429.
--
-- A lock refusal is not a wrong password. It carries no information about whether
-- the password was right, so counting it protects nothing and punishes the people
-- who were waiting patiently for the system to come back.

CREATE OR REPLACE FUNCTION login_throttle(p_username text, p_ip inet)
RETURNS TABLE (allowed boolean, wait_seconds int, by_username int, by_address int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  window_start timestamptz := now() - interval '15 minutes';
  u_fails int;
  a_fails int;
  u_wait  int := 0;
  a_wait  int := 0;
  last_at timestamptz;
BEGIN
  SELECT count(*), max(occurred_at) INTO u_fails, last_at
    FROM activity_log
   WHERE action = 'auth.login_failed'
     AND occurred_at > window_start
     AND coalesce(detail ->> 'reason', '') <> 'system_locked'
     AND lower(detail ->> 'username') = lower(p_username);

  SELECT count(*) INTO a_fails
    FROM activity_log
   WHERE action = 'auth.login_failed'
     AND occurred_at > window_start
     AND coalesce(detail ->> 'reason', '') <> 'system_locked'
     AND p_ip IS NOT NULL
     AND ip_address = p_ip;

  -- Per account: guessing gets slow quickly, but never for long.
  u_wait := CASE
    WHEN u_fails >= 20 THEN 900     -- 15 minutes
    WHEN u_fails >= 10 THEN 120     -- 2 minutes
    WHEN u_fails >= 5  THEN 30
    ELSE 0 END;

  -- Per address: a backstop for something clearly abnormal, not for a busy office.
  a_wait := CASE
    WHEN a_fails >= 300 THEN 600
    WHEN a_fails >= 100 THEN 60
    ELSE 0 END;

  wait_seconds := greatest(u_wait, a_wait);
  by_username := u_fails;
  by_address := a_fails;

  allowed := wait_seconds = 0
             OR last_at IS NULL
             OR now() > last_at + make_interval(secs => wait_seconds);

  IF NOT allowed THEN
    wait_seconds := greatest(1, ceil(extract(epoch FROM (last_at + make_interval(secs => wait_seconds)) - now()))::int);
  ELSE
    wait_seconds := 0;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION login_throttle(text, inet) IS
  'Counts recent failed sign-ins for an account and an address and says whether to refuse. Ignores refusals caused by the maintenance lock, which are not password guesses. Reads the activity log as the owner because the login path has no signed-in user.';
