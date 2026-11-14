-- 0540 Is this letter really from the municipality? (پشتڕاستکردنەوەی کتاب)
--
-- A letter on municipal letterhead is taken at its word by a bank, a court, the
-- land registry. Letterhead is a photocopier away, and a forged «ڕەزامەندی
-- شارەوانی» is the kind of paper that moves a plot or a loan.
--
-- So every letter that leaves with an outgoing number carries a code and a QR
-- code. Whoever receives it opens the code on a phone and sees what the
-- municipality's register says: the outgoing number, its date, who it was sent
-- to, and whether it has since been cancelled. If the paper in their hand says
-- anything different, the paper is wrong.
--
-- It never shows the letter's content. Not the subject, not the reply, not the
-- incoming letter it answers. The recipient's name is shown because it is
-- printed on the paper being checked; anyone holding the code already holds
-- the name.
--
-- The code is ten characters from a 32-letter alphabet with no 0/O or 1/I: fifty
-- bits, generated in the application with a cryptographic generator and passed
-- in. Guessing is logged and slowed exactly like the tracking page.

CREATE TABLE document_verify (
  document_id  bigint PRIMARY KEY REFERENCES document(id),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  issued_by    bigint NULL REFERENCES app_user(id)
);

COMMENT ON TABLE document_verify IS
  'The code printed with the QR on an outgoing letter. Paired with the register by public_verify(); never exposes content.';

ALTER TABLE document_verify ENABLE ROW LEVEL SECURITY;

-- The people who print replies, for letters they can see.
CREATE POLICY verify_select ON document_verify FOR SELECT
  USING ((SELECT app_role()) IN ('mayor', 'deputy_mayor', 'registry_clerk', 'directorate_head', 'room_head')
         AND document_visible(document_id));

GRANT SELECT ON document_verify TO docsys_app;
REVOKE ALL ON document_verify FROM docsys_readonly;

/*
 * The code for a letter, issuing one if it has none.
 *
 * Only for a letter that has an outgoing number: a draft is not official and must
 * not carry something that says it is. Idempotent, so reprinting keeps the code
 * already on the paper that went out. Returns NULL when the caller may not see
 * the letter or it has no outgoing number.
 */
CREATE OR REPLACE FUNCTION issue_verify_code(p_document_id bigint, p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v text;
BEGIN
  IF app_role() NOT IN ('mayor', 'deputy_mayor', 'registry_clerk', 'directorate_head', 'room_head')
     OR NOT document_visible(p_document_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM document WHERE id = p_document_id AND outgoing_no IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO document_verify (document_id, code, issued_by)
  VALUES (p_document_id, p_code, app_user_id())
  ON CONFLICT (document_id) DO NOTHING;
  SELECT code INTO v FROM document_verify WHERE document_id = p_document_id;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION issue_verify_code(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_verify_code(bigint, text) TO docsys_app;

/*
 * What the register says about a code. The only columns it can ever return are
 * these, whatever is passed in.
 */
CREATE OR REPLACE FUNCTION public_verify(p_code text)
RETURNS TABLE (
  matched       boolean,
  outgoing_no   text,
  outgoing_date date,
  recipient     text,
  cancelled     boolean,
  issued_on     date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE d record;
BEGIN
  matched := false;
  IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{10}$' THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT doc.outgoing_no, doc.outgoing_date, doc.outgoing_recipient, doc.status, v.issued_at
    INTO d
    FROM document_verify v
    JOIN document doc ON doc.id = v.document_id
   WHERE v.code = p_code;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  matched       := true;
  outgoing_no   := d.outgoing_no;
  outgoing_date := d.outgoing_date;
  recipient     := d.outgoing_recipient;
  cancelled     := d.status = 'cancelled';
  issued_on     := d.issued_at::date;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_verify(text) TO docsys_app;

/* Slowing down guessing, by address: the tracking page's rule, over this page's misses. */
CREATE OR REPLACE FUNCTION verify_throttle(p_ip inet)
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
   WHERE action = 'verify.miss'
     AND occurred_at > now() - interval '15 minutes'
     AND p_ip IS NOT NULL
     AND ip_address = p_ip;

  wait := CASE
    WHEN fails >= 80 THEN 1800
    WHEN fails >= 40 THEN 300
    WHEN fails >= 20 THEN 60
    ELSE 0 END;

  recent := fails;
  allowed := wait = 0 OR last_at IS NULL OR now() > last_at + make_interval(secs => wait);
  wait_seconds := CASE WHEN allowed THEN 0
    ELSE greatest(1, ceil(extract(epoch FROM (last_at + make_interval(secs => wait)) - now()))::int) END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION verify_throttle(inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_throttle(inet) TO docsys_app;
