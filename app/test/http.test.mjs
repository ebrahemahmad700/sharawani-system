// The system through the front door, as a person actually uses it.
//
// Everything else in this suite talks to the database as the owner, who is not
// subject to row-level security. This one goes over HTTP, so every query runs as
// the restricted application role with the policies switched on. It is the only
// test that proves the security rules do not lock out the people they should
// let in — the failure mode that does not show up until go-live day.
//
//   node test/http.test.mjs            (server must be running on BASE)

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

/** A signed-in browser: keeps cookies, finds the CSRF token, posts forms. */
class Session {
  constructor() { this.cookies = new Map(); }

  #cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  #store(res) {
    // getSetCookie() only exists from Node 19.7. On 18 the header comes back as
    // one string, which is fine here because these responses set one cookie.
    const list = res.headers.getSetCookie?.()
      ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of list) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }

  async get(path) {
    const res = await fetch(BASE + path, {
      headers: { cookie: this.#cookieHeader() }, redirect: 'manual',
    });
    this.#store(res);
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  }

  async post(path, fields) {
    // Fetch the CSRF token from whichever page carries the form.
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach(x => form.append(k, x));
      else form.append(k, v);
    }
    if (!form.has('_csrf')) form.append('_csrf', this.csrf);

    const res = await fetch(BASE + path, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: this.#cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    this.#store(res);
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  }

  async signIn(username) {
    const login = await this.get('/login');
    this.csrf = /name="_csrf" value="([^"]+)"/.exec(login.body)?.[1];
    const res = await this.post('/login', { username, password: PASSWORD });
    // The token changes once a session exists, so refresh it from a real page.
    const home = await this.get('/');
    const next = await this.get(home.location?.replace(BASE, '') ?? '/');
    this.csrf = /name="_csrf" value="([^"]+)"/.exec(next.body)?.[1] ?? this.csrf;
    return res;
  }

  async csrfFrom(path) {
    const p = await this.get(path);
    const t = /name="_csrf" value="([^"]+)"/.exec(p.body)?.[1];
    if (t) this.csrf = t;
    return p;
  }
}

// --- sign in ----------------------------------------------------------------

console.log('--- signing in ---');

const registry = new Session();
const r1 = await registry.signIn('shilan');
check('the registry clerk can sign in', r1.status === 303, `status ${r1.status}`);

const home = await registry.get('/');
check('a registry clerk lands on the register', home.location?.endsWith('/registry'), home.location);

const mayor = new Session();
await mayor.signIn('aram');
const mayorHome = await mayor.get('/');
check('the mayor lands on his dashboard', mayorHome.location?.endsWith('/dashboard'), mayorHome.location);

const legal = new Session();
await legal.signIn('hemin');

// --- register a letter ------------------------------------------------------

console.log('\n--- registering a letter over HTTP ---');

await registry.csrfFrom('/registry/new');
const subject = 'داواکاری مۆڵەتی بیناسازی بۆ پارچە ٨٩٢ — تاقیکردنەوە';
const reg = await registry.post('/registry/new', { confirm_similar: '1',
  subject,
  doc_type: 'citizen_request',
  sender_kind: 'citizen',
  sender_name: 'ئازاد سەعید',
  sender_contact: '٠٧٧٠ ١٢٣ ٤٥٦٧',
  priority: 'urgent',
  plot_no: '892',
  neighbourhood: 'هەواری شار',
  physical_shelf: 'ب٣',
  physical_folder: '١٤',
});
check('registering redirects to the new document', reg.status === 303 && /\/documents\/\d+/.test(reg.location ?? ''),
      `${reg.status} ${reg.location}`);

const docPath = reg.location.replace(BASE, '').split('?')[0];
const docId = Number(docPath.split('/').pop());

const view = await registry.get(docPath);
check('the document page loads', view.status === 200, `status ${view.status}`);
check('it shows the subject', view.body.includes(subject));
check('it shows a number', /[هد]\/\d{4}\/\d+/.test(view.body));
check('the plot is shown', view.body.includes('892'));
check('the paper location is shown', view.body.includes('ب٣'));

// --- the row-level security question ----------------------------------------

console.log('\n--- what row-level security actually allows ---');

const mayorView = await mayor.get(docPath);
check('the mayor can see a letter he has not been sent', mayorView.status === 200,
      `status ${mayorView.status}`);

const legalView = await legal.get(docPath);
check('a room head cannot see a letter that has not reached his room yet',
      legalView.status === 404, `status ${legalView.status}`);

// --- route it ---------------------------------------------------------------

console.log('\n--- routing over HTTP ---');

await mayor.csrfFrom(docPath);
const rooms = [...mayorView.body.matchAll(/<option value="(\d+)">([^<]+)</g)]
  .map(m => ({ id: Number(m[1]), name: m[2].trim() }));
const legalRoom = rooms.find(r => r.name.includes('یاسا'));
check('the room picker is populated', rooms.length >= 8, `${rooms.length} rooms`);

const sent = await mayor.post(`${docPath}/route`, {
  mode: 'single', to_room_id: String(legalRoom.id), note: 'تکایە بیروڕای یاسایی',
});
check('the mayor can send it to a room', sent.status === 303, `status ${sent.status}`);

const legalNow = await legal.get(docPath);
check('once it is sent to his room, the room head can see it', legalNow.status === 200, `status ${legalNow.status}`);

const legalInbox = await legal.get('/inbox');
check('it appears in that room inbox', legalInbox.body.includes(subject));

const afterSend = await mayor.get(docPath);
check('the trail shows the leg', afterSend.body.includes('ژووری یاسا'));
check('the note is on the trail', afterSend.body.includes('بیروڕای یاسایی'));

// --- the room does its part -------------------------------------------------

console.log('\n--- the room completes its step ---');

await legal.csrfFrom(docPath);
const completed = await legal.post(`${docPath}/complete`, {
  action: 'opinion', reply_note: 'ڕێگەپێدراوە بەپێی یاسا',
});
check('the room head can complete the step', completed.status === 303, `status ${completed.status}`);

const afterComplete = await legal.get(docPath);
check('the reply shows on the trail', afterComplete.body.includes('ڕێگەپێدراوە بەپێی یاسا'));
check('the letter is now ready to close', afterComplete.body.includes('ئامادەی داخستن'));

// --- close it ---------------------------------------------------------------

console.log('\n--- closing ---');

await registry.csrfFrom(docPath);
const closed = await registry.post(`${docPath}/close`, {
  recipient: 'ئازاد سەعید', summary: 'وەڵامی داواکاری', channel: 'hand',
});
check('the registry can close it', closed.status === 303, `status ${closed.status}`);

const final = await registry.get(docPath);
check('it is closed', final.body.includes('داخراو'));
check('an outgoing number was issued', /د\/\d{4}\/\d+/.test(final.body));

// --- search -----------------------------------------------------------------

console.log('\n--- search over HTTP ---');

const found = await registry.get('/documents?q=' + encodeURIComponent('پارچە 892'));
check('searching finds the letter', found.body.includes(subject));

const foundArabicKeyboard = await registry.get('/documents?q=' + encodeURIComponent('بيناسازي'));
check('the Arabic-keyboard spelling finds it too', foundArabicKeyboard.body.includes(subject));

// --- things that must not work ----------------------------------------------

console.log('\n--- refusals ---');

const noCsrf = await fetch(`${BASE}${docPath}/route`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'mode=single&to_room_id=1',
});
check('a post without a token is refused', noCsrf.status === 403, `status ${noCsrf.status}`);

const anon = await fetch(`${BASE}${docPath}`, { redirect: 'manual' });
check('a signed-out request is sent to the login page',
      anon.status === 303 && (anon.headers.get('location') ?? '').includes('/login'),
      `status ${anon.status}`);

const badLogin = new Session();
await badLogin.get('/login');
badLogin.csrf = /name="_csrf" value="([^"]+)"/.exec((await badLogin.get('/login')).body)?.[1];
// A username nobody owns, so running the suite twice inside the throttle's
// fifteen-minute window does not spend a real account's five attempts and leave
// the mayor locked out of every test that follows. The refusal is identical
// either way, which is the thing being checked.
const bad = await badLogin.post('/login', { username: `nobody-${Date.now().toString(36)}`, password: 'not-the-password' });
check('a wrong password is refused', bad.status === 401, `status ${bad.status}`);
check('the message does not say whether the user exists',
      bad.body.includes('ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە'));

console.log(failures ? `\n${failures} FAILED` : '\nthe system works through the front door');
process.exit(failures ? 1 : 0);
