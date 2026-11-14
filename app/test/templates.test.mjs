// Form templates, over HTTP.
//
//   node test/templates.test.mjs        (server must be running on BASE)

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

const hr = new Session();     await hr.signIn('bafrin');
const clerk = new Session();  await clerk.signIn('sakar');
const it = new Session();     await it.signIn('itadmin');

console.log('--- who may use forms ---');
check('administration can open the forms page', (await hr.get('/templates')).status === 200);
check('a room clerk can open the forms page', (await clerk.get('/templates')).status === 200);
check('IT cannot open the forms page', (await it.get('/templates')).status === 403);

console.log('\n--- the seeded forms are there ---');
const list = await hr.get('/templates');
for (const name of ['داواکاری مۆڵەت', 'نامەی ناوخۆیی', 'بڕیاری ئیداری', 'ئاگادارکردنەوەی کارمەند']) {
  check(`"${name}" is listed`, list.body.includes(name));
}
const templateId = /href="\/templates\/(\d+)"/.exec(list.body)?.[1];
check('a form can be opened', Boolean(templateId), `id ${templateId}`);

console.log('\n--- filling one in ---');
const form = await hr.get(`/templates/${templateId}`);
check('the fill form renders its declared fields', /name="[a-z_]+"/.test(form.body) && form.body.includes('_csrf'));

// Scoped to the form that posts back to this template, not to the whole page.
// The page shell has inputs of its own, the search box among them, and scraping
// every input on the page picks those up as if the form had declared them.
// The backslashes are doubled because this is a template literal, where \s
// would resolve to a plain s before the RegExp ever saw it.
const formBlock = new RegExp(
  `<form[^>]*action="/templates/${templateId}"[\\s\\S]*?</form>`).exec(form.body)?.[0] ?? '';
check('the fill form was found on the page', formBlock.length > 0);

const fieldNames = [...formBlock.matchAll(/<(?:input|textarea|select)[^>]*name="([a-z_]+)"/g)]
  .map(m => m[1]).filter(n => n !== '_csrf' && n !== 'document_id' && n !== 'reference');
check('it has more than one field', fieldNames.length > 1, fieldNames.join(','));

const values = Object.fromEntries(fieldNames.map(n => [n, `تاقیکردنەوەی ${n}`]));
const filled = await hr.post(`/templates/${templateId}`, values);
check('filling it in redirects to the printed form', filled.status === 303 && /\/fills\/\d+\/print/.test(filled.location ?? ''), filled.location);

const fillId = /\/fills\/(\d+)\/print/.exec(filled.location ?? '')?.[1];
const printed = await hr.get(`/fills/${fillId}/print`);
check('the printed form renders', printed.status === 200 && printed.body.includes('شارەوانی ڕانیە'));
check('it carries the values that were typed', printed.body.includes(`تاقیکردنەوەی ${fieldNames[0]}`));
check('it has a signature block', printed.body.includes('واژوو'));
check('it has no sidebar and no buttons', !printed.body.includes('class="sidebar"') && !printed.body.includes('class="btn"'));
check('it prints itself from an external script, not an inline one blocked by the policy',
      printed.body.includes('/print.js') && !/<script>[^<]/.test(printed.body));

console.log('\n--- a typed value can never become markup ---');
const xss = Object.fromEntries(fieldNames.map(n => [n, '<img src=x onerror=alert(1)>']));
const xssFill = await hr.post(`/templates/${templateId}`, xss);
const xssId = /\/fills\/(\d+)\/print/.exec(xssFill.location ?? '')?.[1];
const xssPrinted = await hr.get(`/fills/${xssId}/print`);
check('a script-shaped value is escaped, not rendered', !xssPrinted.body.includes('<img src=x') && xssPrinted.body.includes('&lt;img'));

console.log('\n--- authoring ---');
check('administration can reach the authoring form', (await hr.get('/templates/new')).status === 200);
check('a room clerk cannot', (await clerk.get('/templates/new')).status === 403);
check('"new" is not mistaken for a form id', (await hr.get('/templates/new')).body.includes('تێمپلەیتی نوێ'));

await hr.get('/templates/new');
const made = await hr.post('/templates/new', {
  name: `فۆڕمی تاقیکردنەوە ${Date.now()}`,
  category: 'تاقیکردنەوە',
  fields: 'who | ناوی کەس | text\ndays | ژمارەی ڕۆژ | number',
  body: 'بەڕێز {{who}} بۆ {{days}} ڕۆژ.',
});
check('a new form can be created', made.status === 303 && /\/templates\/\d+/.test(made.location ?? ''), made.location);

await hr.get('/templates/new');
const bad = await hr.post('/templates/new', {
  name: `فۆڕمی هەڵە ${Date.now()}`, category: 'تاقیکردنەوە',
  fields: 'who | ناوی کەس | text',
  body: 'بەڕێز {{who}} لە {{nowhere}}.',
});
check('a placeholder with no field behind it is refused', bad.status === 400 && bad.body.includes('nowhere'));

await hr.get('/templates/new');
const badType = await hr.post('/templates/new', {
  name: `جۆری هەڵە ${Date.now()}`, category: 'تاقیکردنەوە',
  fields: 'who | ناوی کەس | rocket', body: '{{who}}',
});
check('an unknown field type is refused', badType.status === 400 && badType.body.includes('rocket'));

console.log('\n--- it is written down ---');
const mayor = new Session(); await mayor.signIn('aram');
const log = await mayor.get('/log?action=template');
for (const a of ['template.created', 'template.filled', 'template.printed']) {
  check(`${a} appears in the log`, log.body.includes(a));
}

console.log(failures ? `\n${failures} FAILED` : '\nform templates work');
process.exit(failures ? 1 : 0);
