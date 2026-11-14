// "This looks familiar" — the warning before a second number is issued.
//
//   node test/duplicate.test.mjs        (server must be running on BASE)
//
// A number in this building is consumed for ever, even when the letter is
// cancelled a minute later. So the pause happens before it is handed out, and
// this file is mostly about the two ways that can go wrong.
//
// It can fail to warn, which is what it exists to stop.
//
// It can warn and then get in the way, which is worse, because a check that
// blocks ordinary work gets switched off within a week and then it is not there
// on the day it mattered. So the tests below spend as much effort on "and it
// still registers" as on "and it warns".
//
// The whole check also has to work with javascript switched off, on the office
// machine nobody has updated, which is why it is tested through the form and not
// through the live endpoint. The live endpoint is tested too, as an addition.

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, location: r.headers.get('location'), body }; }
  async post(path, fields) { const f = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (!f.has('_csrf')) f.append('_csrf', this.csrf); const r = await fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f }); this.store(r); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; }
  async signIn(u) { await this.get('/login'); return this.post('/login', { username: u, password: PASSWORD }); }
}

const registry = new Session(); await registry.signIn('shilan');
const { body: formBody } = await registry.get('/registry/new');
const typeId = /name="doc_type_option_id"[\s\S]*?<option value="(\d+)"/.exec(formBody)?.[1] ?? '';

// Everything in this file has to survive being run a hundred times against the
// same database, which is harder than it looks: the whole point of the feature
// is that it notices letters that resemble each other, and two runs of a test
// that registers "a building permit request from Hemin" resemble each other
// exactly. So the plot number comes out of a five-digit space and the mark is
// long enough that two runs share nothing.
const mark = Math.random().toString(36).slice(2, 10);
const plot = `${10000 + Math.floor(Math.random() * 80000)}/3`;
const sender = `هێمن عەبدوڵا ${mark}`;
const subject = `داواکاری مۆڵەتی بینا ${mark}`;

const base = extra => ({
  subject, doc_type_option_id: typeId, sender_kind: 'citizen',
  sender_name: sender, priority: 'normal', plot_no: plot, ...extra,
});

const idFrom = r => /\/documents\/(\d+)/.exec(r.location ?? '')?.[1] ?? null;
const warned = r => r.status === 200 && /ئەمە لەوە دەچێت پێشتر تۆمارکرابێت/.test(r.body);

// How many letters carry this test's plot number.
//
// Counted off the plot file rather than off a search, because the search is
// deliberately fuzzy and answers a question like "roughly this subject", which
// for counting is the wrong question: the first version of this test searched
// the subject and was told sixty letters matched.
async function lettersOnThePlot() {
  const { body } = await registry.get(`/plots?p=${encodeURIComponent(plot)}`);
  return new Set([...body.matchAll(/\/documents\/(\d+)"/g)].map(m => m[1])).size;
}

console.log('--- the first letter goes straight in ---');

// confirm_similar on the FIRST one, deliberately. Whether an earlier run of
// this test left something that resembles it is not what this file is about,
// and the "nothing to warn about" case is checked properly further down with
// text that shares nothing with anything.
await registry.get('/registry/new');
const one = await registry.post('/registry/new', base({ confirm_similar: '1' }));
const firstId = idFrom(one);
check('the first letter is registered', Boolean(firstId), `document ${firstId}`);

const before = await lettersOnThePlot();
check('and it is the only letter on this plot', before === 1, `${before}`);

console.log('\n--- the citizen comes back with the same request ---');

await registry.get('/registry/new');
const two = await registry.post('/registry/new', base({}));
check('the second attempt is stopped and the warning shown', warned(two), `status ${two.status}`);
check('nothing was written: no redirect to a new letter', !two.location, two.location ?? '');
check('and it says why: the same plot', /هەمان پارچە/.test(two.body));
check('and a similar subject', /بابەتی لەوە چوو/.test(two.body));
check('and the same sender', /هەمان نێردەر/.test(two.body));
check('the earlier letter is named, so the clerk can open it', two.body.includes(`/documents/${firstId}`));

// The point of the whole exercise.
const during = await lettersOnThePlot();
check('no second number was issued while the clerk was being asked',
  during === before, `${during} letter(s) on the plot, was ${before}`);

console.log('\n--- the clerk looks, and says they are different ---');

await registry.get('/registry/new');
const three = await registry.post('/registry/new', base({ confirm_similar: '1' }));
const thirdId = idFrom(three);
check('pressing register a second time goes through', Boolean(thirdId), `document ${thirdId}`);
check('and it is a different letter from the first', thirdId !== firstId);

console.log('\n--- or says it follows on from the earlier one ---');

await registry.get('/registry/new');
const four = await registry.post('/registry/new', base({ related_document_id: firstId }));
const fourthId = idFrom(four);
check('linking it registers it too, with its own number', Boolean(fourthId), `document ${fourthId}`);

const linked = await registry.get(`/documents/${fourthId}`);
check('and the letter says which one it follows on from',
  linked.body.includes(`/documents/${firstId}"`) && /بەدواداچوونی/.test(linked.body));

console.log('\n--- what it does not warn about ---');

// Text that shares nothing with any letter in the building, including the ones
// earlier runs of this test left behind. Not Kurdish, on purpose: what is being
// tested here is the matching rule, and a Kurdish sentence that shares no words
// with anything is hard to write and easy to get wrong.
const nothingLikeIt = () =>
  `${Math.random().toString(36).slice(2, 12)} ${Math.random().toString(36).slice(2, 12)}`;

await registry.get('/registry/new');
const unrelated = await registry.post('/registry/new', {
  subject: nothingLikeIt(), doc_type_option_id: typeId, sender_kind: 'government',
  sender_name: nothingLikeIt(), priority: 'normal',
});
check('a letter with nothing in common is registered without a word',
  Boolean(idFrom(unrelated)), unrelated.status === 200 ? 'it was warned about' : '');

// The other half of not getting in the way: a one-word subject must not match
// every letter in the building by resemblance.
await registry.get('/registry/new');
const terse = await registry.post('/registry/new', {
  subject: 'وەڵام', doc_type_option_id: typeId, sender_kind: 'internal',
  sender_name: nothingLikeIt(), priority: 'normal',
});
check('a subject too short to be distinctive is not matched on',
  Boolean(idFrom(terse)), terse.status === 200 ? 'it was warned about' : '');

// A cancelled number stays consumed for the auditor. It is not a letter anybody
// should be told to look at instead.
const mayor = new Session(); await mayor.signIn('aram');
await mayor.get(`/documents/${thirdId}`);
const cancelled = await mayor.post(`/documents/${thirdId}/cancel`, { reason: 'تاقیکردنەوە' });
check('the third letter can be cancelled', cancelled.status === 303, cancelled.location ?? '');

await registry.get('/registry/new');
const afterCancel = await registry.post('/registry/new', base({}));
check('a cancelled letter is never offered as the duplicate',
  !afterCancel.body.includes(`/documents/${thirdId}"`));
check('though the live one still is', afterCancel.body.includes(`/documents/${firstId}`));

console.log('\n--- the live check, for browsers that can run it ---');

const live = await registry.get(
  `/registry/similar?subject=${encodeURIComponent(subject)}&sender=${encodeURIComponent(sender)}&plot=${encodeURIComponent(plot)}`);
check('it answers with the same panel the form shows', live.status === 200 && /ئەمە لەوە دەچێت/.test(live.body));
check('and it is a fragment, not a whole page', !/<html/i.test(live.body));
// A fragment that offered buttons would post them into whatever form it landed
// in; the live one is for reading.
check('the live fragment offers no buttons', !/<button/.test(live.body));

const quiet = await registry.get('/registry/similar?subject=ئەمە%20هیچ%20شتێک%20نییە&sender=&plot=');
check('and says nothing when there is nothing to say', quiet.status === 200 && quiet.body.trim() === '');

console.log('\n--- it cannot be used to look at letters you may not see ---');

// The check runs as whoever is asking, so a clerk in an unrelated room gets the
// warning only for letters they could already have found by searching.
const outsider = new Session(); await outsider.signIn('rebwar');
const peek = await outsider.get(
  `/registry/similar?subject=${encodeURIComponent(subject)}&sender=${encodeURIComponent(sender)}&plot=${encodeURIComponent(plot)}`);
check('somebody who cannot see the letter is told about nothing',
  peek.status === 200 && !peek.body.includes(`/documents/${firstId}`), `status ${peek.status}`);

console.log(failures ? `\n${failures} FAILED` : '\nthe same request twice is caught before it gets a second number');
process.exit(failures ? 1 : 0);
