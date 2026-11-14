-- 0360 Letting the applicant check for themselves.
--
-- The counter clerk's day is interrupted every few minutes by somebody asking
-- where their application has got to, and the honest answer usually requires
-- walking to another room. A page the applicant can open on a phone removes most
-- of those interruptions, and it is the one screen in this system that has to
-- work for a person with no account.
--
-- That is also what makes it the most dangerous screen in the system, so it is
-- built the other way round from every other one: instead of deciding what to
-- hide, it decides what to show, and shows nothing else.
--
-- What it returns: the stage, the room the paper is in, the date it was
-- registered, the date it last moved, and whether it is finished.
--
-- What it never returns, at any input: the subject, the sender, any staff name,
-- any note, any attachment, any other letter. Those columns are not selected, so
-- there is no combination of arguments that produces them.
--
-- Two secrets, not one. The barcode alone is not enough, because barcodes are
-- sequential: 2026000001, 2026000002, and anyone who works out the pattern can
-- walk the whole register. So registration also issues a six-digit PIN, printed
-- on the applicant's receipt and nowhere else. Barcode plus PIN is a million
-- guesses per letter, and every guess is logged.
--
-- The PIN lives in its own table rather than on document, so that the read-only
-- role the assistant connects as cannot see it. The assistant answers questions
-- for the mayor; it has no business holding the key to the public page.

CREATE TABLE document_track (
  document_id  bigint PRIMARY KEY REFERENCES document(id),
  pin          text NOT NULL CHECK (pin ~ '^\d{6}$'),
  issued_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE document_track IS
  'The PIN printed on the applicant receipt. Separate from document so the read-only role cannot read it. Paired with the barcode by public_track().';

-- Every letter that already exists gets one, so an old receipt reprinted today
-- works the same as a new one.
INSERT INTO document_track (document_id, pin)
SELECT id, lpad((floor(random() * 1000000))::int::text, 6, '0') FROM document
ON CONFLICT (document_id) DO NOTHING;

ALTER TABLE document_track ENABLE ROW LEVEL SECURITY;

-- Only the people who print receipts, and only for letters they can already see.
CREATE POLICY track_select ON document_track FOR SELECT
  USING (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
         AND document_visible(document_id));

CREATE POLICY track_insert ON document_track FOR INSERT
  WITH CHECK (app_role() IN ('mayor', 'deputy_mayor', 'registry_clerk')
              AND document_visible(document_id));

GRANT SELECT, INSERT ON document_track TO docsys_app;
REVOKE ALL ON document_track FROM docsys_readonly;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION issue_track_pin(p_document_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v text;
BEGIN
  v := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO document_track (document_id, pin) VALUES (p_document_id, v)
  ON CONFLICT (document_id) DO NOTHING;
  SELECT pin INTO v FROM document_track WHERE document_id = p_document_id;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION issue_track_pin(bigint) IS
  'The PIN for a letter, issuing one if it has none. Idempotent: reprinting a receipt does not invalidate the one the applicant is holding.';

REVOKE ALL ON FUNCTION issue_track_pin(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_track_pin(bigint) TO docsys_app;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public_track(p_barcode text, p_pin text)
RETURNS TABLE (
  -- 'matched', not 'found': FOUND is a PL/pgSQL variable of its own, and an OUT
  -- parameter by that name shadows it, so IF NOT FOUND silently tests the wrong
  -- thing and the function returns NULL for every lookup.
  matched        boolean,
  stage          text,      -- 'registered' | 'in_flow' | 'ready' | 'closed' | 'cancelled'
  room_name      text,      -- where the paper is now, NULL when it is not with a room
  registered_on  date,
  last_moved_on  date,
  closed_on      date,
  step_position  int,       -- 'ڕیزبەندی 2 لە 3', or NULL
  step_total     int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE d record;
BEGIN
  matched := false;

  -- Shape first, so a typo never reaches the table at all.
  IF NOT barcode_valid(p_barcode) OR p_pin !~ '^\d{6}$' THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- The join to document_track is the check. A wrong PIN is not a different
  -- answer, it is no answer, so a wrong PIN and a barcode that does not exist
  -- are indistinguishable from outside.
  SELECT doc.status, doc.incoming_date, doc.updated_at, doc.outgoing_date,
         r.name AS room_name, s.group_position, s.group_size
    INTO d
    FROM document doc
    JOIN document_track t ON t.document_id = doc.id AND t.pin = p_pin
    LEFT JOIN room r ON r.id = doc.current_room_id
    LEFT JOIN routing_step s ON s.id = doc.current_step_id
   WHERE doc.barcode = p_barcode;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  matched       := true;
  stage         := d.status::text;
  registered_on := d.incoming_date;
  last_moved_on := d.updated_at::date;
  closed_on     := d.outgoing_date;
  step_position := d.group_position;
  step_total    := d.group_size;

  -- The room is named only while the paper is genuinely with a room. Once a
  -- letter is closed or cancelled, where it sat last is nobody's business.
  room_name := CASE WHEN d.status IN ('registered', 'in_flow', 'ready_to_close')
                    THEN d.room_name ELSE NULL END;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public_track(text, text) IS
  'The whole of the public tracking page. Returns a stage, a room name and three dates, and cannot return a subject, a sender, a staff name or a note at any input.';

REVOKE ALL ON FUNCTION public_track(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_track(text, text) TO docsys_app;

-- ---------------------------------------------------------------------------

-- The public page is reachable without an account, so it is the one door with no
-- lock on it. This counts recent failed look-ups from one address, the same way
-- login_throttle counts failed sign-ins, and for the same reason: without it,
-- guessing PINs costs an attacker nothing.
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
    WHEN fails >= 30 THEN 900
    WHEN fails >= 15 THEN 120
    WHEN fails >= 8  THEN 30
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

COMMENT ON FUNCTION track_throttle(inet) IS
  'Counts recent failed public look-ups from one address and says whether to refuse. The public page has no password, so this is the only thing making PIN guessing expensive.';

REVOKE ALL ON FUNCTION track_throttle(inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION track_throttle(inet) TO docsys_app;
