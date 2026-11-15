// Spreadsheet export.
//
// CSV rather than .xlsx, because it needs no library, opens in Excel, LibreOffice
// and Google Sheets alike, and a clerk can read it in Notepad if all else fails.
// Two details make it open correctly in Excel on an office machine:
//
//   - A UTF-8 byte-order mark first. Without it Excel reads the file in the
//     machine's Arabic code page and every Kurdish letter comes out as noise.
//   - CRLF line endings and every field quoted, which is what Excel writes itself.
//
// One detail makes it safe: a cell that starts with = + - @ (or a tab or carriage
// return) is a formula to Excel, and a letter's subject is typed by whoever
// handed it in at the counter. Such a cell gets a leading apostrophe, which Excel
// shows as plain text. This is the standard defence against CSV injection.
//
// Dates go out as YYYY-MM-DD and numbers in Western digits, so Excel sorts and
// filters them as dates and numbers rather than as text.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v) {
  if (v === null || v === undefined) return '""';
  let s;
  if (v instanceof Date) s = isoDate(v);
  else s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A Date or date-like value as YYYY-MM-DD in the building's time zone. */
export function isoDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  // en-CA formats as YYYY-MM-DD; the zone is fixed so a server in another zone
  // still writes the date the clerk saw on the screen.
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
}

/** A Date as YYYY-MM-DD HH:MM in the building's time zone. */
export function isoDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const t = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${isoDate(d)} ${t}`;
}

/**
 * Build the file. `columns` is a list of [heading, row => value].
 */
export function toCsv(columns, rows) {
  const lines = [columns.map(([h]) => cell(h)).join(',')];
  for (const r of rows) lines.push(columns.map(([, f]) => cell(f(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Send it as a download. The name is ASCII so every browser keeps it. */
export function sendCsv(res, filename, body) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}

/**
 * The date range of an export, from ?from=&to=, defaulting to the current month.
 * Bad input falls back to the default rather than failing: this is a download
 * button, not a form with a place to show an error.
 */
export function exportRange(query) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(new Date(s).getTime());
  const today = isoDate(new Date());
  const from = ok(query.from) ? String(query.from) : today.slice(0, 8) + '01';
  const to = ok(query.to) ? String(query.to) : today;
  return from <= to ? { from, to } : { from: to, to: from };
}
