// Kurdish Sorani text handling.
//
// This is a faithful mirror of the SQL functions in db/migrations/ (ku_normalize,
// fold_digits, plot_key). The database is the authority: it owns the indexed
// *_search columns and every stored comparison. This copy exists so the browser
// and the server can normalise a query before it is sent, and so the corpus in
// test/ku_corpus.tsv can be run without a database.
//
// If you change a rule here, change it in the SQL in the same commit. The test
// in test/ku.test.mjs checks this file; test/ku_normalize_eq.sql checks the SQL.
//
// Rule source: BUILD-PLAN.md section 6.2, which follows PLAN.md section 6.1.

// ---------------------------------------------------------------------------
// Digits. Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9)
// both fold to ASCII. Storage is always ASCII; Arabic-Indic is a display choice.
// ---------------------------------------------------------------------------

const DIGITS_FROM = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'
                  + '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';

export function foldDigits(s) {
  if (s == null) return s;
  let out = '';
  for (const ch of s) {
    const i = DIGITS_FROM.indexOf(ch);
    out += i === -1 ? ch : String(i % 10);
  }
  return out;
}

/**
 * One kind of digit in an identifier a person typed: a plot, a shelf, a folder.
 *
 * A Kurdish keyboard's number row gives ٢٤٠ and the keypad gives 240, so a clerk
 * using both in one field stores "2٤0/4". Which kind wins depends on the letters
 * around the digits. A value that is only digits and punctuation, or carries
 * Latin letters (a plot number, "C-12"), takes Western digits: the same as
 * letter numbers and barcodes. A value that carries Kurdish letters ("ب٣", a
 * shelf in the archive room) takes Arabic-Indic, because "ب3" is the same
 * mixture the other way round.
 */
const ARABIC_LETTER = /[ء-يٮ-ۓەۮۯۺ-ۿ]/;
export function unifyDigits(s) {
  if (s == null) return s;
  const folded = foldDigits(String(s));
  return ARABIC_LETTER.test(folded) ? toArabicIndic(folded) : folded;
}

// Render ASCII digits as Arabic-Indic, for display only. Never for storage.
const ARABIC_INDIC = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
export function toArabicIndic(s) {
  return String(s).replace(/[0-9]/g, d => ARABIC_INDIC[+d]);
}

// ---------------------------------------------------------------------------
// The one-to-one letter folds. Step 4 of ku_normalize.
//
// Deliberately NOT folded: ئ U+0626. It is a real Sorani letter, not a carrier
// to be stripped. Folding it would break Kurdish spellings to fix Arabic ones.
// The cost is corpus rows 4 and 24, which are known and accepted misses.
// ---------------------------------------------------------------------------

const FOLD_FROM = '\u064A\u0649\u0643\u0629\u06BE\u0623\u0625\u0622\u0671\u0624\u0695\u06B5\u06C6\u06CE';
const FOLD_TO   = '\u06CC\u06CC\u06A9\u06D5\u0647\u0627\u0627\u0627\u0627\u0648\u0631\u0644\u0648\u06CC';

// Invisible characters and marks: ZWNJ, ZWJ, BOM, Arabic letter mark, tatweel,
// the harakat range, superscript alef.
const INVISIBLE = /[\u200C\u200D\uFEFF\u061C\u0640\u064B-\u0652\u0670]/g;

// "Word-final" for the heh rule: end of string, whitespace, ASCII punctuation,
// or Arabic punctuation.
const FINAL_HEH = /\u0647(?=$|[\s!-\/:-@\[-`{-~\u060C\u061B\u061F])/g;

export function kuNormalize(p) {
  if (p == null) return null;
  let s = String(p);

  // Step 1. The old keyboard convention: ARABIC HEH + ZWNJ was typed to get ە.
  // This must run before step 2 strips the ZWNJ, or step 5 could no longer tell
  // that the heh was word-final. "نامه‌کان" would wrongly become "نامهکان".
  s = s.split('\u0647\u200C').join('\u06D5');

  // Step 2. Remove invisible characters and vowel marks.
  s = s.replace(INVISIBLE, '');

  // Step 3. Digits to ASCII.
  s = foldDigits(s);

  // Step 4. One-to-one letter folds.
  let folded = '';
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch);
    folded += i === -1 ? ch : FOLD_TO[i];
  }
  s = folded;

  // Step 5. Word-final ه becomes ە.
  s = s.replace(FINAL_HEH, '\u06D5');

  // Step 6. Latin to lower case, for file names, DWG labels and usernames.
  s = s.toLowerCase();

  // Step 7. Arabic punctuation to ASCII, so "یاسا، گرێبەست" and "یاسا, گرێبەست" agree.
  s = s.split('\u060C').join(',').split('\u061B').join(';').split('\u061F').join('?');

  // Step 8. Whitespace: non-breaking space to normal, collapse runs, trim.
  s = s.split('\u00A0').join(' ').replace(/\s+/g, ' ').trim();

  return s;
}

// ---------------------------------------------------------------------------
// Plot keys. 247/5, 247-5, ٢٤٧/٥ and "247 / 5" must all collide.
// Every run of non-alphanumerics becomes one slash; edges are trimmed.
// ---------------------------------------------------------------------------

export function plotKey(p) {
  if (p == null) return null;
  const key = foldDigits(String(p))
    .toUpperCase()
    .replace(/[^0-9A-Z\u0621-\u06FF]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return key === '' ? null : key;
}

// ---------------------------------------------------------------------------
// Document numbers.
//
// Referenced by corpus rows 41 to 46 but never defined in BUILD-PLAN.md, so it
// is written here. Stored form is <prefix>/<year>/<serial> with ASCII digits.
// A clerk may type any of: the whole number, year and serial, or the serial
// alone, in either digit system, with or without the ZWNJ the display adds.
//
// kind === null means the caller should search both and show incoming first
// (corpus row 46).
// ---------------------------------------------------------------------------

export function parseNumber(input, { incomingPrefix = '\u0647', outgoingPrefix = '\u062F' } = {}) {
  if (input == null) return null;
  // Normalise digits and drop the invisibles the display form carries, but do
  // NOT run kuNormalize: it would fold the ه prefix to ە at a word boundary.
  const s = foldDigits(String(input)).replace(INVISIBLE, '').trim();
  if (s === '') return null;

  const parts = s.split('/').map(x => x.trim()).filter(x => x !== '');
  // ە (the Kurdish vowel letter) and ھ (the knotted heh) are what a Kurdish
  // keyboard often gives for ه. A number typed ە/2026/715 found nothing (letters
  // test, 13 September).
  const kindOf = pfx => {
    const p = pfx === '\u06D5' || pfx === '\u06BE' ? incomingPrefix : pfx;
    return p === incomingPrefix ? 'incoming' : p === outgoingPrefix ? 'outgoing' : undefined;
  };

  if (parts.length === 3) {
    const kind = kindOf(parts[0]);
    if (kind === undefined) return null;                 // unknown prefix
    if (!/^\d{4}$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return null;
    return { kind, year: +parts[1], serial: +parts[2] };
  }

  if (parts.length === 2) {
    // Either "<year>/<serial>" or "<prefix>/<serial>".
    if (/^\d{4}$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      return { kind: null, year: +parts[0], serial: +parts[1] };
    }
    const kind = kindOf(parts[0]);
    if (kind !== undefined && /^\d+$/.test(parts[1])) {
      return { kind, year: null, serial: +parts[1] };
    }
    return null;
  }

  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    return { kind: null, year: null, serial: +parts[0] };
  }
  return null;
}

// Format a number for storage. Display adds the Arabic-Indic digits separately.
export function formatNumber({ kind, year, serial }, { incomingPrefix = '\u0647', outgoingPrefix = '\u062F' } = {}) {
  const prefix = kind === 'incoming' ? incomingPrefix : outgoingPrefix;
  return `${prefix}/${year}/${serial}`;
}
