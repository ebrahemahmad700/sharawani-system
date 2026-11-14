-- 0290 A scannable number for every letter.
--
-- The letter already has a number, ه/2026/25, and that number is the one people
-- say out loud. It is not the one a scanner can read. Kurdish letters, a slash
-- and Arabic-Indic digits are not something a fifteen-dollar handheld reader
-- will ever emit, and the readers themselves are the point: they type what they
-- see and press Enter, nothing more.
--
-- So the barcode is a second name for the same letter, made only of ASCII digits
-- so it survives any reader, any keyboard and any phone camera:
--
--   2026 000025 3
--   year seq    check digit
--
-- Derived, not stored independently, because two names for one thing that can
-- drift apart is a bug waiting to happen. It is a generated column: the database
-- computes it and nothing can write it. (incoming_year, incoming_seq) is already
-- unique, so the barcode is unique for free, and because a document number is
-- never reused a barcode is never reused either.
--
-- The check digit is Luhn, the same arithmetic on the back of a bank card. It
-- exists because the failure it catches is silent: a reader that drops a digit,
-- or a clerk who types 2026000025 as 2026000052, otherwise finds the wrong
-- letter and nobody notices. With the check digit, a mistyped barcode is simply
-- not a barcode, and the screen says so.

CREATE OR REPLACE FUNCTION luhn_check_digit(p_digits text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  total int := 0;
  d     int;
  i     int;
  dbl   boolean := true;   -- rightmost digit of the payload doubles
BEGIN
  IF p_digits !~ '^\d+$' THEN
    RAISE EXCEPTION 'luhn_check_digit expects digits only, got %', p_digits;
  END IF;

  FOR i IN REVERSE length(p_digits)..1 LOOP
    d := substr(p_digits, i, 1)::int;
    IF dbl THEN
      d := d * 2;
      IF d > 9 THEN d := d - 9; END IF;
    END IF;
    total := total + d;
    dbl := NOT dbl;
  END LOOP;

  RETURN (10 - (total % 10)) % 10;
END;
$$;

COMMENT ON FUNCTION luhn_check_digit(text) IS
  'The Luhn check digit for a string of digits. Used to make a mistyped barcode fail to resolve rather than resolve to the wrong letter.';

-- Whether a whole barcode, check digit included, is self-consistent. The lookup
-- screen calls this before it goes anywhere near the letters.
CREATE OR REPLACE FUNCTION barcode_valid(p_barcode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_barcode ~ '^\d{11}$'
     AND luhn_check_digit(left(p_barcode, 10)) = right(p_barcode, 1)::int;
$$;

COMMENT ON FUNCTION barcode_valid(text) IS
  'True when a barcode is eleven digits and its Luhn check digit agrees. Says nothing about whether a letter with that barcode exists.';

ALTER TABLE document
  ADD COLUMN barcode text
  GENERATED ALWAYS AS (
    incoming_year::text
    || lpad(incoming_seq::text, 6, '0')
    || luhn_check_digit(incoming_year::text || lpad(incoming_seq::text, 6, '0'))::text
  ) STORED;

COMMENT ON COLUMN document.barcode IS
  'Eleven ASCII digits: year, sequence, Luhn check. The machine-readable form of incoming_no, derived from it and never written by hand.';

-- Unique for free through (incoming_year, incoming_seq), but declared anyway so
-- the lookup is an index probe rather than a scan, and so that anything which
-- ever changes the formula is refused rather than quietly producing collisions.
CREATE UNIQUE INDEX ix_doc_barcode ON document (barcode);
