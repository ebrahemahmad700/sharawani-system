// Guessing what a letter says, from a photograph of it.
//
// A clerk at the counter photographs an incoming letter, and this tries to fill
// in the registration form from what the reader made of the image. It gets the
// easy half right often enough to save real typing, and it gets the hard half
// wrong, so everything it produces is a suggestion in an editable field and
// nothing is ever saved without somebody looking at it.
//
// The design rule here is the opposite of the rest of the system. Everywhere
// else, a thing that might be wrong is refused. Here a thing that might be wrong
// is offered, because the alternative is typing twelve fields from scratch and
// the clerk is looking at the paper while they do it. What must never happen is
// a guess that is presented as a fact, which is why the route shows what it
// found and what it did not, field by field.
//
// What it looks for, in order of how reliable it is:
//
//   the reference number   marked "ژمارە" or "العدد" on nearly every official
//                          letter in the region, followed by digits
//   the date               marked, or recognisable as a date on its own
//   the subject            marked "بابەت" or "م/", the Iraqi convention
//   the plot               marked "پارچە", or a bare 247/5 shape
//   the neighbourhood      marked "گەڕەک"
//   the sender             the letterhead, which is a genuine guess
//
// Nothing here is Kurdish-only. Letters arrive from the governorate in Arabic
// and from companies in both, so every marker has its Arabic twin.

import { foldDigits, kuNormalize, plotKey } from './ku.mjs';

/**
 * Everything after a marker, up to the end of the line.
 *
 * Longest marker first, always. گەڕەک and گەڕەکی are both in the list, and
 * trying the shorter one first leaves the ی stranded at the front of the value:
 * the neighbourhood came out as "ی سەرچنار".
 */
function after(text, markers) {
  for (const marker of [...markers].sort((a, b) => b.length - a.length)) {
    // The marker, then optionally a colon or a slash, then the rest of the line.
    const re = new RegExp(`${marker}\\s*[:：/\\\\]?\\s*(.+)`, 'u');
    for (const line of text.split('\n')) {
      const m = re.exec(line);
      if (m && m[1].trim().length >= 2) return m[1].trim();
    }
  }
  return null;
}

/** The first run of digits in a string, in Latin form. */
function digitsIn(s) {
  if (!s) return null;
  const folded = foldDigits(s);
  const m = /(\d[\d/\\-]{0,19})/.exec(folded);
  return m ? m[1].replace(/[\\-]/g, '/') : null;
}

/**
 * A date, as YYYY-MM-DD, from anything that looks like one.
 *
 * Both orders are accepted because both are used: the region writes 2026/9/11
 * and also 11/9/2026, and which one a given office uses is not knowable from the
 * page. Whichever component is four digits is the year; failing that, a value
 * over 31 in the first position is a year. If it is genuinely ambiguous the
 * whole thing is left alone rather than guessed, because a wrong date on a
 * letter is worse than no date.
 */
function dateFrom(s) {
  if (!s) return null;
  const folded = foldDigits(s);
  const m = /(\d{1,4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,4})/.exec(folded);
  if (!m) return null;

  let [, a, b, c] = m.map(Number);
  let year, month, day;
  if (String(m[1]).length === 4) { year = a; month = b; day = c; }
  else if (String(m[3]).length === 4) { year = c; month = b; day = a; }
  else return null;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const p = n => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

// The markers, Kurdish first and then the Arabic a governorate letter uses.
const MARK = {
  reference:     ['ژمارە', 'ژماره', 'ژ', 'العدد', 'رقم'],
  date:          ['بەروار', 'بهروار', 'ڕێکەوت', 'التاريخ', 'التأريخ'],
  subject:       ['بابەت', 'بابهت', 'پێناو', 'الموضوع', 'م'],
  plot:          ['پارچە', 'پارچه', 'قطعة', 'القطعة'],
  neighbourhood: ['گەڕەک', 'گهڕهک', 'گەڕەکی', 'محلة', 'الحي'],
};

/**
 * What can be made out of the text read off a photograph.
 *
 * Every field comes back as { value, from } or null, where `from` is the line it
 * was taken out of. The screen shows that line beside the field, so the clerk
 * can see what the machine was looking at rather than having to trust it.
 */
export function extractLetterFields(text) {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (!clean) return { found: {}, lines: [] };

  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const found = {};
  const put = (key, value, from) => {
    if (value && !found[key]) found[key] = { value: String(value).slice(0, 300), from };
  };

  // Reference and date, which are marked on almost every official letter.
  const refLine = after(clean, MARK.reference);
  put('reference', digitsIn(refLine), refLine);

  const dateLine = after(clean, MARK.date);
  put('date', dateFrom(dateLine), dateLine);
  if (!found.date) {
    // Unmarked: the first thing on the page that reads as a date at all.
    for (const line of lines) {
      const d = dateFrom(line);
      if (d) { put('date', d, line); break; }
    }
  }

  // The subject. "م/" is the Iraqi convention and is by far the commonest, but
  // a bare "م" would match half the words on the page, so it is only accepted
  // when it stands alone before the separator.
  const subjectLine = after(clean, ['بابەت', 'بابهت', 'الموضوع'])
    ?? (/(?:^|\n)\s*م\s*\/\s*(.+)/u.exec(clean)?.[1]?.trim() ?? null);
  put('subject', subjectLine, subjectLine);

  // The plot. Marked, or the bare 247/5 shape, which is distinctive enough in a
  // municipal letter to be worth taking on its own.
  const plotLine = after(clean, MARK.plot);
  let plot = plotLine ? digitsIn(plotLine) : null;
  if (!plot) {
    for (const line of lines) {
      const m = /(?:^|\s)(\d{1,5}\s*\/\s*\d{1,4})(?:\s|$)/.exec(foldDigits(line));
      if (m) { plot = m[1].replace(/\s+/g, ''); put('plot_no', plot, line); break; }
    }
  } else {
    put('plot_no', plot, plotLine);
  }
  // Run it through the same canonicaliser the database stores, so what goes in
  // the box is the form everything else in the system searches by.
  if (found.plot_no) found.plot_no.value = plotKey(found.plot_no.value) ?? found.plot_no.value;

  const hoodLine = after(clean, MARK.neighbourhood);
  if (hoodLine) put('neighbourhood', hoodLine.split(/[.,،]/)[0].trim(), hoodLine);

  // The sender. This is a guess and is labelled as one on the screen.
  //
  // The letterhead is the top of the page: an organisation's name, usually two
  // to six words, no digits in it. Anything with digits is a reference line and
  // anything very long is a sentence, so both are skipped.
  for (const line of lines.slice(0, 4)) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) continue;
    if (/\d/.test(foldDigits(line))) continue;
    if (kuNormalize(line).length < 6) continue;
    put('sender_name', line, line);
    break;
  }

  return { found, lines };
}

/** The form values, ready to be dropped into the registration screen. */
export function asFormValues(found) {
  const v = {};
  if (found.subject)       v.subject = found.subject.value;
  if (found.sender_name)   v.sender_name = found.sender_name.value;
  if (found.plot_no)       v.plot_no = found.plot_no.value;
  if (found.neighbourhood) v.neighbourhood = found.neighbourhood.value;
  // The reference on the incoming letter belongs in the contact field, not in
  // the document number: the document number is this municipality's own and is
  // issued by the counter, never copied off somebody else's paper.
  if (found.reference)     v.sender_contact = `ژمارەی نێردەر: ${found.reference.value}`;
  return v;
}

export { dateFrom, digitsIn };
