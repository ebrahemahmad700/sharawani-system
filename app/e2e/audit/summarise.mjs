// Turns what the audit wrote into one readable list.
//
//   node audit/summarise.mjs            after `npx playwright test -c audit.config.mjs`
//
// Reads audit-output/crawl-*.json (the crawl), findings.jsonl (the journeys) and
// access.json (who can open what), and prints them grouped, most serious first.
// Nothing here decides whether something is a bug: a person reads the list and
// the screenshots next to it.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const OUT = join(process.cwd(), 'audit-output');
const add = (map, key, value) => (map[key] ??= new Set()).add(value);
const show = (title, map, limit = 40) => {
  const entries = Object.entries(map);
  if (!entries.length) return;
  console.log(`\n## ${title} (${entries.length})`);
  for (const [k, v] of entries.slice(0, limit)) console.log(`  - ${k}  ::  ${[...v].slice(0, 4).join(' ; ')}`);
};

// --- the journeys -----------------------------------------------------------
const RANK = { blocker: 0, security: 1, bug: 2, missing: 3, design: 4, minor: 5, question: 6, info: 7 };
if (existsSync(join(OUT, 'findings.jsonl'))) {
  const seen = new Set();
  const findings = readFileSync(join(OUT, 'findings.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(f => { const k = `${f.severity}|${f.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  console.log(`# Journeys: ${findings.length} findings`);
  for (const f of findings) {
    const detail = f.detail == null ? '' : ` — ${typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail)}`.slice(0, 220);
    console.log(`  [${f.severity}] ${f.message}${detail}${f.screenshot ? `  (journeys/${f.screenshot})` : ''}`);
  }
}

// --- the crawl --------------------------------------------------------------
const crawls = readdirSync(OUT).filter(f => /^crawl-.*\.json$/.test(f));
if (crawls.length) {
  let pages = 0;
  const statuses = {}, refused = {}, errors = [], consoleMsgs = {}, slow = {}, overflow = {}, offscreen = {}, mixed = {},
        rawWords = {}, unlabelled = {}, smallTargets = {}, arabicLetters = {}, csp = {}, requiredNoMark = {};
  for (const file of crawls) {
    const log = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
    for (const p of log.pages) {
      pages++;
      statuses[p.status] = (statuses[p.status] || 0) + 1;
      if (p.status >= 400 || p.err) add(refused, `${p.status ?? p.err} ${p.path}`, `${log.user} from ${p.from}`);
      if (p.ms > 2500) add(slow, p.pattern, `${log.user} ${p.ms}ms`);
      for (const vp of ['desktop', 'phone']) {
        const d = p[vp]; if (!d) continue;
        if (d.serverErrorPage) errors.push(`${log.user} ${p.path}`);
        if (d.pageOverflowX) add(overflow, `${p.pattern} [${vp}]`, `${d.scrollWidth}px on a ${d.clientWidth}px screen`);
        if (d.offscreenCount) add(offscreen, `${p.pattern} [${vp}]`, d.offscreen[0]?.el);
        d.mixedDigits.forEach(m => add(mixed, m, p.pattern));
        d.badWords.forEach(m => add(rawWords, m, p.pattern));
        d.unlabelled.forEach(m => add(unlabelled, p.pattern, m.replace(/^.*> /, '')));
        (d.smallTargets ?? []).forEach(m => add(smallTargets, p.pattern, m.replace(/^.*> /, '')));
        d.requiredWithoutMark.forEach(m => add(requiredNoMark, p.pattern, m));
        if (d.arabicYehKaf) add(arabicLetters, p.pattern, log.user);
        d.csp.forEach(m => add(csp, m, p.pattern));
      }
    }
    log.console.forEach(c => add(consoleMsgs, c.text.slice(0, 160), c.at.replace(/\d+/g, ':id')));
    log.pageErrors.forEach(e => errors.push(`${log.user} ${e.at}: ${e.text}`));
  }
  console.log(`\n# Crawl: ${crawls.length} people, ${pages} pages, statuses ${JSON.stringify(statuses)}`);
  if (errors.length) { console.log(`\n## Error pages and script errors (${errors.length})`); errors.slice(0, 30).forEach(e => console.log(`  - ${e}`)); }
  show('Links that lead to a refusal', refused);
  show('Console messages', consoleMsgs);
  show('Content security policy violations', csp);
  show('Slow pages (over 2.5 s)', slow);
  show('Pages wider than the screen', overflow);
  show('Elements pushed off the side', offscreen);
  show('Mixed digits inside one token', mixed);
  show('Raw values shown to people (null, true, undefined…)', rawWords);
  show('Arabic ي/ك instead of Kurdish ی/ک', arabicLetters);
  show('Fields with no label', unlabelled);
  show('Required fields not marked as required', requiredNoMark);
  show('Small things to tap on a phone', smallTargets);
}

// --- who can open what --------------------------------------------------------
if (existsSync(join(OUT, 'access.json'))) {
  const t = JSON.parse(readFileSync(join(OUT, 'access.json'), 'utf8'));
  const users = Object.keys(t), paths = Object.keys(t[users[0]].pages);
  const cell = p => p.status === 200 ? (p.inNav ? 'M' : 'H') : p.status === 303 ? '→' : p.status === 403 ? '.' : String(p.status);
  console.log('\n# Who can open what   M = opens, in the menu · H = opens, not in the menu · . = refused · → = sent elsewhere');
  console.log('  ' + ''.padEnd(18) + users.map(u => u.slice(0, 6).padEnd(7)).join(''));
  for (const p of paths) console.log('  ' + p.padEnd(18) + users.map(u => cell(t[u].pages[p]).padEnd(7)).join(''));
}
