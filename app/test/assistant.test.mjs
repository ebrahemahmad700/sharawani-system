// The assistant, over HTTP, as the people who are allowed to use it.
//
//   node test/assistant.test.mjs        (server must be running on BASE)
//
// Written in Node rather than shell on purpose: a Kurdish question passed through
// a Windows shell variable arrives as mojibake, the model then sees nonsense and
// answers with a greeting, and it looks like the model is stupid when the fault
// was three layers earlier.

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

/** The answer text out of the rendered page. */
const answerOf = body => /background:var\(--ok-bg\)[^>]*>\s*([^<]+)/.exec(body)?.[1]?.trim() ?? null;

const mayor = new Session();  await mayor.signIn('aram');
const deputy = new Session(); await deputy.signIn('nabaz');

console.log('--- who may use it at all ---');
for (const [who, username, allowed] of [
  ['the mayor', 'aram', true],
  ['the deputy mayor', 'nabaz', true],
  ['a room head', 'hemin', false],
  ['the registry clerk', 'shilan', false],
  ['administration', 'bafrin', false],
  ['IT', 'itadmin', false],
]) {
  const s = new Session();
  await s.signIn(username);
  const r = await s.get('/assistant');
  const ok = allowed ? r.status === 200 : r.status === 403;
  check(`${who} ${allowed ? 'can' : 'cannot'} open the assistant`, ok, `status ${r.status}`);
}

const ask = async (s, q) => { await s.get('/assistant'); return s.post('/assistant/ask', { q }); };

console.log('\n--- the rules layer: free, offline, instant ---');
const RULES_QUESTIONS = [
  ['who is on leave',    'کێ لە مۆڵەتە',            t => /مۆڵەت/.test(t)],
  ['which rooms are late', 'کام ژوور دواکەوتووە',   t => /دواکەوتوو|لە کاتدان/.test(t)],
  ['how many today',     'ئەمڕۆ چەند کتاب هاتووە',  t => /ئەمڕۆ/.test(t) && /کتاب/.test(t)],
];
for (const [label, q, ok] of RULES_QUESTIONS) {
  const started = Date.now();
  const r = await ask(mayor, q);
  const text = answerOf(r.body);
  const ms = Date.now() - started;
  check(`${label}: answered`, Boolean(text) && ok(text ?? ''), text?.slice(0, 90));
  // The rules layer must not be reaching the network. A round trip to Groq is
  // never this fast; if this starts failing, a rule stopped matching and the
  // model is quietly picking up the slack at a cost.
  check(`${label}: answered without a model (${ms} ms)`, ms < 2500, `${ms} ms`);
}

console.log('\n--- the model layer: everything the rules do not catch ---');
const MODEL_QUESTIONS = [
  ['room performance',  'ژووری یاسا چۆن کار دەکات و چەند ڕۆژ دەخایەنێت'],
  ['a trail question',  'کتابی ٢٥ بە کام ژوورەکاندا تێپەڕیوە'],
];
let modelAnswered = 0;
for (const [label, q] of MODEL_QUESTIONS) {
  const r = await ask(mayor, q);
  const text = answerOf(r.body);
  const isFallback = /تێنەگەیشتم/.test(text ?? '');
  if (text && !isFallback) modelAnswered++;
  console.log(`  ${label}: ${text?.slice(0, 140) ?? '(none)'}`);
  check(`${label}: produced some answer`, Boolean(text), isFallback ? 'fell back' : 'answered');
  if (text && !isFallback) {
    check(`${label}: is Kurdish, not English`, /[؀-ۿ]/.test(text) && !/[a-zA-Z]{5,}/.test(text));
    check(`${label}: says کتاب, not پەیام or پەڕگە`, !/پەیام|پەڕگە/.test(text), text.slice(0, 60));
  }
}
if (modelAnswered === 0) {
  console.log('  note: no model answers. Either assistant_backend is not "model" or GROQ_API_KEY is unset.');
  console.log('  That is a valid configuration; the rules layer above still works.');
}

console.log('\n--- it must not invent ---');
const nonsense = await ask(mayor, 'باشترین چێشتخانەی ڕانیە کامەیە');
const nonsenseText = answerOf(nonsense.body) ?? '';
check('an unrelated question is refused rather than answered', /تێنەگەیشتم|ناتوانم|نییە|سیستەم/.test(nonsenseText), nonsenseText.slice(0, 90));

const missing = await ask(mayor, 'کتابی 999999 لای کێیە');
const missingText = answerOf(missing.body) ?? '';
check('a number that does not exist is reported as not found', /نەدۆزرا|نییە|هیچ/.test(missingText), missingText.slice(0, 90));

console.log('\n--- everything is logged ---');
const log = await mayor.get('/log?action=assistant');
for (const action of ['assistant.question', 'assistant.tool_call', 'assistant.answer']) {
  check(`${action} appears in the log`, log.body.includes(action));
}

console.log(failures ? `\n${failures} FAILED` : '\nthe assistant works');
process.exit(failures ? 1 : 0);
