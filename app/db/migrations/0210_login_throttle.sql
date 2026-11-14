-- 0210 Slow down repeated failed sign-ins.
--
-- Until now nothing stopped an attacker trying passwords as fast as the network
-- allowed. On a laptop that was academic. On a public URL it is not.
--
-- The failures are already recorded: login() writes an auth.login_failed row with
-- the attempted username and the caller's address on every miss. So this counts
-- what is already there rather than adding a table to fall out of step with it.
--
-- SECURITY DEFINER because the login path runs with no signed-in user, and
-- row-level security on activity_log would show it nothing. The function reads
-- only counts and timestamps; it returns no letter, no name and no log content.
--
-- Two separate limits, and the difference matters:
--
--   By username, to protect one account. Thresholds are low, and the lock is
--   short, because the point is to make guessing slow rather than to lock a real
--   person out of their own account for an afternoon.
--
--   By address, with much higher thresholds, because a municipality behind one
--   office router shares an address between everyone in the building. A limit
--   tight enough to stop one attacker there would lock out all thirty staff.

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
     AND lower(detail ->> 'username') = lower(p_username);

  SELECT count(*) INTO a_fails
    FROM activity_log
   WHERE action = 'auth.login_failed'
     AND occurred_at > window_start
     AND p_ip IS NOT NULL
     AND ip_address = p_ip;

  -- Per account: guessing gets slow quickly, but never for long.
  u_wait := CASE
    WHEN u_fails >= 20 THEN 900     -- 15 minutes
    WHEN u_fails >= 10 THEN 120     -- 2 minutes
    WHEN u_fails >= 5  THEN 30
    ELSE 0 END;

  -- Per address: deliberately loose, so one shared office router cannot lock the
  -- whole building out by one person mistyping their password repeatedly.
  a_wait := CASE
    WHEN a_fails >= 50 THEN 600
    WHEN a_fails >= 20 THEN 60
    ELSE 0 END;

  wait_seconds := greatest(u_wait, a_wait);
  by_username := u_fails;
  by_address := a_fails;

  -- The wait runs from the most recent failure, not from the first. Keep failing
  -- and the wait keeps restarting.
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
  'Counts recent failed sign-ins for an account and an address and says whether to refuse. Reads the activity log as the owner because the login path has no signed-in user.';

REVOKE ALL ON FUNCTION login_throttle(text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_throttle(text, inet) TO docsys_app;
