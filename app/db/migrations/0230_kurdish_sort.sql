-- 0230 Kurdish alphabetical order.
--
-- Lists have always sorted in the database's root collation, which puts Kurdish
-- letters in Unicode code point order. That is not the Kurdish alphabet. In code
-- point order ک (06A9) comes after ڤ (06A4), ڕ (0695) lands nowhere near ر, and
-- ە (06D5) sorts after ۆ (06C6). A clerk looking down a list of names for
-- "ڕێبوار" does not find it where they expect it, and there is nothing on screen
-- to explain why.
--
-- The international locale data has no Kurdish Sorani collation to borrow, which
-- is why this is written by hand rather than configured.
--
-- The method: map each letter to one ASCII character chosen so that ordinary
-- byte order equals Kurdish alphabet order. One translate() call, no loop, and
-- the result can be indexed. A-Z then a-g covers the thirty-three letters.
--
-- Note what is NOT done here: this does not fold ڕ into ر or ڵ into ل the way
-- ku_normalize does. Folding is right for searching, where a person types the
-- plain letter and should still find the word. It is wrong for sorting, where
-- ڕ and ر are different letters with different places in the alphabet.

CREATE OR REPLACE FUNCTION ku_sort_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT translate(
    -- Zero-width joiners, tatweel and the harakat are invisible and must not
    -- affect where a word sorts.
    regexp_replace(lower(coalesce(p, '')), '[‌‍﻿؜ـً-ْٰ]', '', 'g'),
    --  ئ ا ب پ ت ج چ ح خ د ر ڕ ز ژ س ش ع غ ف ڤ ق ک گ ل ڵ م ن ه ە و ۆ ی ێ
    'ئابپتجچحخدرڕزژسشعغفڤقکگلڵمنهەوۆیێ',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg'
  );
$$;

COMMENT ON FUNCTION ku_sort_key(text) IS
  'Sort key for Kurdish Sorani. Maps each letter to one ASCII character so byte order equals alphabet order. Unlike ku_normalize it keeps ڕ, ڵ, ۆ and ێ distinct, because they are separate letters of the alphabet even though a searcher may type the plain form.';

-- Indexes on the lists people actually scan down.
CREATE INDEX room_name_ku_sort_idx      ON room      (ku_sort_key(name));
CREATE INDEX app_user_name_ku_sort_idx  ON app_user  (ku_sort_key(full_name));
CREATE INDEX archive_owner_ku_sort_idx  ON archive_file (ku_sort_key(owner_names));

GRANT EXECUTE ON FUNCTION ku_sort_key(text) TO docsys_app, docsys_readonly, docsys_jobs;
