// Server-rendered HTML with no template engine.
//
// Tagged template literals that escape by default. Anything interpolated into
// html`...` is escaped unless it is already marked safe, so a citizen's name
// containing < or " cannot become markup. There is no way to interpolate raw
// text by accident; you have to call raw() and mean it.
//
// Display rules that this file owns, from BUILD-PLAN.md section 6.6:
//   - digits shown to staff are Arabic-Indic, always
//   - dates are Gregorian, YYYY/MM/DD, with Arabic-Indic digits
//   - Latin runs (file names, usernames) are wrapped in dir="ltr" so they do not
//     scramble inside a right-to-left line

import { foldDigits, toArabicIndic, unifyDigits } from './ku.mjs';

const SAFE = Symbol('safe-html');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** Mark a string as already-safe HTML. Use only on markup you built yourself. */
export const raw = s => ({ [SAFE]: true, toString: () => String(s ?? '') });

const isSafe = v => v && typeof v === 'object' && v[SAFE];

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (isSafe(v)) return v.toString();
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

/** html`<p>${untrusted}</p>` — everything interpolated is escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return raw(out);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Any number shown to staff. Arabic-Indic, never ASCII. */
export const num = n => (n === null || n === undefined ? '' : toArabicIndic(n));

/** A Latin run inside a right-to-left line: file names, usernames, DWG labels. */
export const ltr = s => html`<span dir="ltr">${s}</span>`;

/**
 * An identifier somebody typed: a plot number, a block, a shelf or folder code.
 *
 * Shown in one kind of digit, whatever mixture it was typed in. A Kurdish
 * keyboard's number row gives ٢٤٠ and the keypad gives 240, so a clerk who uses
 * both in one field stores "2٤0/4", and the screen used to show exactly that.
 * Which kind is decided by the letters around the digits; see unifyDigits() in
 * ku.mjs. Quantities and dates keep their Arabic-Indic digits; see num().
 */
/**
 * A letter number (or any left-to-right code) inside plain text, where a span
 * cannot go: a page title, a notice, a textarea, a dropdown option. The Unicode
 * isolate marks keep "ه/2026/542" in one piece, with ه on the same side as
 * everywhere else, instead of the page's right-to-left flow moving it to the other
 * end (browser audit, 13 September).
 */
export const ltrText = s => (s == null || s === '' ? s : `\u2066${s}\u2069`);

export const ident = s => ltr(s == null ? s : unifyDigits(String(s)));

// Every date and time is shown in Rania's time zone, whatever the server's is.
// The containers and the hosting run in UTC, and every time on every screen was
// three hours behind; between midnight and three in the morning the date was
// yesterday's (design test, 13 September). Set APP_TIME_ZONE to change it.
export const TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Baghdad';
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const partsOf = x => Object.fromEntries(CLOCK.formatToParts(x).map(p => [p.type, p.value]));

/** Gregorian YYYY/MM/DD in Arabic-Indic digits, in Rania's time zone. */
export function date(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = partsOf(x);
  return toArabicIndic(`${p.year}/${p.month}/${p.day}`);
}

/** HH:MM in Arabic-Indic digits, in Rania's time zone. */
export function time(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = partsOf(x);
  return toArabicIndic(`${p.hour}:${p.minute}`);
}

// ---------------------------------------------------------------------------
// Date fields
//
// A browser's own date box writes the day in the order of the machine's
// language, so the same field read «mm/dd/yyyy» on one desk and «dd/mm/yyyy» on
// another, while every screen shows ٢٠٢٦/٠٩/١٣ (design test, 13 September).
// These fields are plain text in the system's own order, ساڵ/مانگ/ڕۆژ, with a
// calendar added by public/app.js. Without script they are still a text box that
// takes a typed date.
// ---------------------------------------------------------------------------

const pad2 = n => String(n).padStart(2, '0');

/**
 * A date typed into a form, as YYYY-MM-DD for the database.
 *
 * Takes ساڵ/مانگ/ڕۆژ in either kind of digit with / - or . between, eight digits
 * with nothing between (a phone's number pad has no slash), and a day written
 * the paper way round, ١٣/٩/٢٠٢٦: the part with four digits is the year.
 * Returns '' for an empty field and null for anything that is not a real day,
 * ٢٠٢٦/٠٢/٣٠ included, so a route can say so instead of the database refusing it.
 */
export function readDay(s) {
  const v = foldDigits(String(s ?? '')).trim();
  if (!v) return '';
  const m = /^(\d{1,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,4})$/.exec(v)
         ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  let y, mo, d;
  if (m[1].length === 4) [y, mo, d] = [m[1], m[2], m[3]];
  else if (m[3].length === 4) [y, mo, d] = [m[3], m[2], m[1]];
  else return null;
  [y, mo, d] = [y, mo, d].map(Number);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * A day as a date field shows it: ٢٠٢٦/٠٩/١٣. Takes a date from the database,
 * YYYY-MM-DD, or what somebody typed; text that is not a date comes back as it
 * was, so a refused form shows the mistake to correct instead of an empty box.
 */
export function dayValue(d) {
  if (d === null || d === undefined || d === '') return '';
  if (d instanceof Date) {
    // A date column arrives as midnight on the server's clock: read it on that clock.
    return Number.isNaN(d.getTime()) ? '' : toArabicIndic(`${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`);
  }
  const iso = readDay(d);
  return iso ? toArabicIndic(iso.replaceAll('-', '/')) : iso === '' ? '' : String(d);
}

/** The message for a date that could not be read, shown by the page and the server alike. */
export const DAY_FORMAT = 'بەروار بەم شێوەیە بنووسە: ساڵ/مانگ/ڕۆژ، بۆ نموونە ٢٠٢٦/٠٩/١٣.';

/**
 * A date field. `after` names another date field this one cannot be earlier
 * than (leave's «تا» after «لە»); the calendar also opens on that field's month.
 */
export function dateInput({ id, name = id, value = '', required = false, after = null }) {
  return html`<input ${attrs({
    id, name, type: 'text', class: 'date-input', 'data-date': true, 'data-after': after,
    inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', maxlength: 20,
    placeholder: DAY_PLACEHOLDER, title: DAY_FORMAT, value: dayValue(value), required,
  })}>`;
}

// The field is left-to-right, where ٢٠٢٦/٠٩/١٣ has the year on the left. Plain
// «ساڵ/مانگ/ڕۆژ» is one right-to-left run there and put ساڵ on the right, over
// the day's digits (date field test). The left-to-right marks between the words
// keep each in its own place, year on the left, and the reading order as it is.
const DAY_PLACEHOLDER = 'ساڵ\u200E/\u200Eمانگ\u200E/\u200Eڕۆژ';

/**
 * "Five minutes ago", or "just now" when it was less than a minute: «ئێستا
 * لەمەوبەر» ("now ago") was showing on the inbox (design test, 13 September).
 */
export const ago = d => { const e = elapsed(d); return !e ? '' : e === 'ئێستا' ? 'ئێستا' : `${e} لەمەوبەر`; };

/**
 * How long something has been open, in Kurdish. The trail shows this next to
 * every step, so it has to read naturally rather than as a raw duration.
 */
export function elapsed(from, to = new Date()) {
  if (!from) return '';
  const ms = (to instanceof Date ? to : new Date(to)) - (from instanceof Date ? from : new Date(from));
  if (ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return 'ئێستا';
  if (mins < 60) return `${toArabicIndic(mins)} خولەک`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${toArabicIndic(hours)} کاتژمێر`;
  const days = Math.floor(hours / 24);
  return `${toArabicIndic(days)} ڕۆژ`;
}

/** The two-letter initials shown in the round avatars on the screens. */
export function initials(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

/** Build an attribute list, skipping null and false. */
export function attrs(o) {
  return raw(Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? escapeHtml(k) : `${escapeHtml(k)}="${escapeHtml(v)}"`))
    .join(' '));
}

/** Query string builder that keeps existing params and overrides some. */
export function withQuery(current, changes) {
  const p = new URLSearchParams(current ?? {});
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
