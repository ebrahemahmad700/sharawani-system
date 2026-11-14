-- 0270 Loosen the per-address sign-in limit.
--
-- 0210 refused an address after twenty failed sign-ins in fifteen minutes. The
-- test suite tripped it on itself: enough test files now sign in badly on purpose
-- that the mayor was refused a normal sign-in from the same container. If a test
-- run reaches that number in a few minutes, thirty people behind one office
-- router will reach it on an ordinary Monday, and the whole building would be
-- locked out by one person mistyping a password.
--
-- The per-account limit is the real defence against guessing and it is unchanged:
-- five failures on one username and that username slows down. The address limit
-- is a coarse backstop for something clearly abnormal, so it now sits where only
-- something clearly abnormal reaches it.
--
-- A distributed attacker uses many addresses and this never sees them. That is
-- what the per-account limit is for, and why it is the tight one.

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

  -- Per address: a backstop for something clearly abnormal, not for a busy office.
  a_wait := CASE
    WHEN a_fails >= 300 THEN 600
    WHEN a_fails >= 100 THEN 60
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
