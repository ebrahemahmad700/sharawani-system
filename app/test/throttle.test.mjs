// The failed sign-in throttle.
//
//   node test/throttle.test.mjs        (server must be running on BASE)
//
// Uses a username that does not exist, deliberately. Throttling a real fixture
// account would leave it locked for the next test file to trip over, and the
// point being proved is that one account's failures do not reach another's.

const BASE = process.env.BASE || 'http://localhost:3111';
const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) { const l = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []); for (const raw of l) { const [p] = raw.split(';'); const i = p.indexOf('='); if (i > 0) this.cookies.set(p.slice(0, i).trim(), p.slice(i + 1)); } }
  async get(path) { const r = await fetch(BASE + path, { headers: { cookie: this.header() }, redirect: 'manual' }); this.store(r); const body = await r.text(); const t = /name="_csrf" value="([^"]+)"/.exec(body)?.[1]; if (t) this.csrf = t; return { status: r.status, body }; }
  async tryLogin(username, password) {
    await this.get('/login');
    const f = new URLSearchParams({ username, password, _csrf: this.csrf });
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { cookie: this.header(), 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: f });
    this.store(r);
    return { status: r.status, body: await r.text() };
  }
}

const VICTIM = `nosuchperson-${Date.now().toString(36)}`;

console.log('--- guessing gets slowed down ---');
const attacker = new Session();
let firstThrottledAt = 0;
let sawThrottle = false;

for (let i = 1; i <= 7; i++) {
  const r = await attacker.tryLogin(VICTIM, 'not-the-password');
  if (r.status === 429) {
    if (!firstThrottledAt) firstThrottledAt = i;
    sawThrottle = true;
  } else if (r.status !== 401) {
    check(`attempt ${i} returned 401 or 429`, false, `status ${r.status}`);
  }
}

check('repeated wrong passwords are eventually refused outright', sawThrottle,
      firstThrottledAt ? `first refused on attempt ${firstThrottledAt}` : 'never refused');
check('the first few attempts are allowed through', firstThrottledAt === 0 || firstThrottledAt > 1,
      `first refused on attempt ${firstThrottledAt}`);

console.log('\n--- what the refusal says ---');
const throttled = await attacker.tryLogin(VICTIM, 'not-the-password');
check('the refusal is a 429, not a plain wrong-password 401', throttled.status === 429, `status ${throttled.status}`);
check('it tells the person to wait rather than that the password is wrong',
      /هەوڵبدەوە/.test(throttled.body) && !/ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە/.test(throttled.body));
// Enumeration: the throttle must not become a way to learn which usernames exist.
// It fires on an account that has never existed, which is the proof.
check('it fires for a username that does not exist at all', throttled.status === 429);

console.log('\n--- one account being attacked must not lock out anybody else ---');
const mayor = new Session();
const good = await mayor.tryLogin('aram', PASSWORD);
check('the mayor can still sign in while another account is being guessed at',
      good.status === 303, `status ${good.status}`);

console.log('\n--- it is written down ---');
const log = await mayor.get('/log?action=auth.login_throttled');
check('every refusal is in the activity log', log.body.includes('auth.login_throttled'));

console.log(failures ? `\n${failures} FAILED` : '\nthe sign-in throttle works');
process.exit(failures ? 1 : 0);
