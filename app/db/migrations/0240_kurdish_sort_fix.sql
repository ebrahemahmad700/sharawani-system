-- 0240 Fix the Kurdish sort key.
--
-- 0230 mapped the thirty-three letters onto A-Z then a-g, assuming byte order.
-- The database is created with ICU locale 'und-u-ks-level1', and level 1 ignores
-- case: 'C' and 'c' compare equal, so ب (mapped to C) and ن (mapped to a) were
-- ordered by the collation's own idea of a-before-c rather than by the key. The
-- result put ن and ه ahead of ب, which is exactly the bug 0230 set out to fix.
--
-- Measured before this fix:
--   ب -> C   ن -> a   ه -> b        and the list came out ن, ه, ب.
--
-- The fix uses digits for the first ten letters and lowercase for the rest.
-- Digits sort before letters and letters sort a, b, c in every collation there
-- is, case-insensitive ones included, so the key no longer depends on the
-- database's locale settings at all.
--
-- Arabic-keyboard forms are folded onto their Kurdish equivalents here, because
-- a name typed with ي instead of ی belongs in the same place in the list, not at
-- the end. This is the one thing sorting and searching agree on.

DROP INDEX IF EXISTS room_name_ku_sort_idx;
DROP INDEX IF EXISTS app_user_name_ku_sort_idx;
DROP INDEX IF EXISTS archive_owner_ku_sort_idx;

CREATE OR REPLACE FUNCTION ku_sort_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT translate(
    regexp_replace(lower(coalesce(p, '')), '[‌‍﻿؜ـً-ْٰ]', '', 'g'),
    --  the alphabet:  ئ ا ب پ ت ج چ ح خ د | ر ڕ ز ژ س ش ع غ ف ڤ ق ک گ ل ڵ م ن ه ە و ۆ ی ێ
    --  then the Arabic-keyboard forms:     ھ ي ك ة أ إ آ
    'ئابپتجچحخد' || 'رڕزژسشعغفڤقکگلڵمنهەوۆیێ' || 'ھيكةأإآ',
    '0123456789' || 'abcdefghijklmnopqrstuvw' || 'rvls111'
  );
$$;

COMMENT ON FUNCTION ku_sort_key(text) IS
  'Sort key for Kurdish Sorani. Digits for the first ten letters, lowercase for the rest, so the order holds under any collation including the case-insensitive one this database uses. Keeps ڕ, ڵ, ۆ and ێ distinct from ر, ل, و and ی, unlike ku_normalize, because they are separate letters of the alphabet.';

CREATE INDEX room_name_ku_sort_idx      ON room         (ku_sort_key(name));
CREATE INDEX app_user_name_ku_sort_idx  ON app_user     (ku_sort_key(full_name));
CREATE INDEX archive_owner_ku_sort_idx  ON archive_file (ku_sort_key(owner_names));
