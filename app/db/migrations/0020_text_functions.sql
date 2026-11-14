-- 6.2 Kurdish text functions
-- Extracted verbatim from BUILD-PLAN.md section 6.2.
--
-- ORDERING NOTE: the plan places these in section 6, but the section 2 schema
-- uses ku_normalize() in generated columns, so they must exist before any table
-- is created. That is why this runs at 0002, before the tables at 0003.
-- The JS mirror of these rules is src/lib/ku.mjs; change both together.

-- Arabic-Indic and Extended Arabic-Indic digits to ASCII. Used alone for numbers and inside ku_normalize.
CREATE OR REPLACE FUNCTION fold_digits(p text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(p, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
$$;

-- The normaliser. Steps are ordered; the order is part of the specification.
CREATE OR REPLACE FUNCTION ku_normalize(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE s text := p;
BEGIN
  -- Step 1. Old convention: ARABIC LETTER HEH + ZWNJ was typed to get ە. Fold it before the ZWNJ is stripped,
  --         otherwise "نامه‌کان" would become "نامهکان" and step 5 could not tell the ه was final.
  s := replace(s, E'ه\u200C', E'ە');

  -- Step 2. Remove invisible characters and marks:
  --         U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM, U+061C Arabic letter mark, U+0640 tatweel,
  --         U+064B..U+0652 harakat, U+0670 superscript alef.
  s := regexp_replace(s, E'[\u200C\u200D\uFEFF\u061C\u0640\u064B-\u0652\u0670]', '', 'g');

  -- Step 3. Digits.
  s := fold_digits(s);

  -- Step 4. One-to-one letter folds (PLAN.md §6.1 plus three additions marked +):
  --         ي U+064A → ی U+06CC      ى U+0649 → ی U+06CC (+ alef maksura, Arabic keyboards)
  --         ك U+0643 → ک U+06A9      ة U+0629 → ە U+06D5
  --         ھ U+06BE → ه U+0647 (+ heh doachashmee, some Kurdish keyboards; step 5 then handles a final one)
  --         أ U+0623, إ U+0625, آ U+0622, ٱ U+0671 → ا U+0627
  --         ؤ U+0624 → و U+0648
  --         ڕ U+0695 → ر U+0631      ڵ U+06B5 → ل U+0644
  --         ۆ U+06C6 → و U+0648      ێ U+06CE → ی U+06CC
  --         ئ U+0626 is NOT folded (+ decision, see §6.4 corpus rows 24 and 4, and §15 D-13).
  s := translate(s,
        E'يىكةھأإآٱؤڕڵۆێ',
        E'ییکەهااااورلوی');

  -- Step 5. Word-final ه → ە. "Final" = followed by end of string, whitespace, or punctuation (ASCII or Arabic).
  s := regexp_replace(s, E'ه(?=$|[\\s[:punct:]،؛؟])', E'ە', 'g');

  -- Step 6. Latin to lower case (file names, DWG/PDF labels, usernames).
  s := lower(s);

  -- Step 7. Arabic punctuation to ASCII so "یاسا، گرێبەست" and "یاسا, گرێبەست" agree.
  s := translate(s, E'،؛؟', ',;?');

  -- Step 8. Whitespace: trim, collapse runs (including NBSP U+00A0) to one space.
  s := regexp_replace(btrim(regexp_replace(s, E'\u00A0', ' ', 'g')), '\s+', ' ', 'g');
  RETURN s;
END $$;

-- Plot numbers get their own key so 247/5, 247-5, ٢٤٧/٥ and "247 / 5" collide (PLAN.md §6.2).
-- Every run of non-alphanumerics becomes one '/', leading/trailing separators are dropped, Latin is upper-cased.
CREATE OR REPLACE FUNCTION plot_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(
           regexp_replace(
             regexp_replace(upper(fold_digits(coalesce(p, ''))), '[^0-9A-Z\u0621-\u06FF]+', '/', 'g'),
             '^/+|/+$', '', 'g'),
           '');
$$;
