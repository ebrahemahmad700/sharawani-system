-- 0370 The public throttle was set for the wrong kind of address.
--
-- 0360 refused after eight failed look-ups from one address in fifteen minutes.
-- That number was chosen thinking of an attacker with one address, and it is the
-- wrong picture. The people using this page are on mobile networks, where a
-- whole town shares a handful of carrier-grade NAT addresses, and in an internet
-- cafe or the municipality's own waiting room they share exactly one. Eight
-- mistyped PINs across all of those is an ordinary morning, and the first person
-- to mistype the ninth would have been locked out by the eight before them.
--
-- The same mistake was made and corrected once already for sign-ins, in 0270,
-- for the same reason: a limit tight enough to stop one attacker on a shared
-- address locks out everyone behind it.
--
-- The real protection was never this number. It is the PIN: a million
-- combinations per letter, and the barcode has to be right as well. The throttle
-- exists to stop bulk enumeration, and it still does. Eighty tries per fifteen
-- minutes is about seven and a half thousand a day, against a million per
-- letter, so an attacker who guessed continuously for a year would still expect
-- to have found nothing.
--
-- The waits are longer to compensate for the higher thresholds, so the ceiling
-- on sustained guessing is lower than it was before, not higher.

CREATE OR REPLACE FUNCTION track_throttle(p_ip inet)
RETURNS TABLE (allowed boolean, wait_seconds int, recent int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fails int;
  last_at timestamptz;
  wait int := 0;
BEGIN
  SELECT count(*), max(occurred_at) INTO fails, last_at
    FROM activity_log
   WHERE action = 'track.miss'
     AND occurred_at > now() - interval '15 minutes'
     AND p_ip IS NOT NULL
     AND ip_address = p_ip;

  wait := CASE
    WHEN fails >= 80 THEN 1800    -- 30 minutes: this is no longer somebody with a receipt
    WHEN fails >= 40 THEN 300
    WHEN fails >= 20 THEN 60
    ELSE 0 END;

  recent := fails;
  allowed := wait = 0 OR last_at IS NULL OR now() > last_at + make_interval(secs => wait);

  IF NOT allowed THEN
    wait_seconds := greatest(1, ceil(extract(epoch FROM (last_at + make_interval(secs => wait)) - now()))::int);
  ELSE
    wait_seconds := 0;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION track_throttle(inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION track_throttle(inet) TO docsys_app;
