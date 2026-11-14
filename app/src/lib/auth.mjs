// Authentication and sessions.
//
// Local accounts only. There is no external identity provider on a municipal LAN,
// and adding one would mean the building cannot log in when the internet is down.
//
// Passwords are argon2id at the parameters in BUILD-PLAN.md section 7.2:
// 64 MiB memory, 3 iterations, 1 thread. Never bcrypt.
//
// Sessions are opaque random tokens in an httpOnly cookie. The token is hashed
// before storage, so a stolen database backup does not hand over live sessions.

import argon2 from 'argon2';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { withActor, withoutActor } from './db.mjs';
import { logEvent, clientIp } from './log.mjs';
import { refused } from './respond.mjs';

const ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 65536,     // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export const COOKIE = 'docsys_session';

export const hashPassword = pw => argon2.hash(pw, ARGON2);

const sha256 = s => createHash('sha256').update(s).digest('hex');

/**
 * Verify a password. Always does the hashing work even when the user does not
 * exist, so that response time does not reveal which usernames are real.
 */
async function verifyPassword(stored, given) {
  const DUMMY = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2E$3aTz3bUxvIjxBPPPz1yBmyRUq0kXfKBHDzY0mYPqQwA';
  try {
    return await argon2.verify(stored ?? DUMMY, given);
  } catch {
    return false;
  }
}

/**
 * Sign in. Returns { ok, user, token } or { ok: false, reason }.
 *
 * Failures are logged with the attempted username but never the attempted
 * password. reason is for the log; the screen says one thing for every failure
 * so it cannot be used to enumerate accounts.
 */
export async function login({ username, password, req }) {
  const uname = String(username ?? '').trim().toLowerCase();

  return withoutActor(async q => {
    // Before the password is even looked at. Checking first means a locked-out
    // attacker cannot use the timing of the argon2 verification to learn whether
    // a username exists, and it costs the server nothing to refuse.
    const { rows: [t] } = await q(`SELECT * FROM login_throttle($1, $2)`, [uname, clientIp(req)]);
    if (t && !t.allowed) {
      await logEvent(q, {
        action: 'auth.login_throttled',
        req,
        detail: { username: uname.slice(0, 60), wait_seconds: t.wait_seconds, by_username: t.by_username, by_address: t.by_address },
      });
      return { ok: false, reason: 'throttled', waitSeconds: t.wait_seconds };
    }

    const { rows } = await q(
      `SELECT u.id, u.username, u.full_name, u.role, u.room_id, u.password_hash,
              u.is_active, u.must_change_password, r.directorate_id
         FROM app_user u
         LEFT JOIN room r ON r.id = u.room_id
        WHERE lower(u.username) = $1`,
      [uname],
    );
    const u = rows[0];

    const good = await verifyPassword(u?.password_hash, String(password ?? ''));

    if (!u || !good || !u.is_active) {
      await logEvent(q, {
        action: 'auth.login_failed',
        req,
        detail: {
          username: uname.slice(0, 60),
          reason: !u ? 'no_such_user' : !good ? 'bad_password' : 'inactive',
        },
      });
      return { ok: false, reason: 'invalid' };
    }

    // The maintenance lock: everyone except the mayor is refused, with his message.
    const { rows: lock } = await q(
      `SELECT
         coalesce((SELECT value::boolean FROM system_setting WHERE key = 'system_locked'), false) AS locked,
         coalesce((SELECT value #>> '{}'  FROM system_setting WHERE key = 'lock_message'), '')    AS message`,
    );
    if (lock[0].locked && u.role !== 'mayor') {
      await logEvent(q, { action: 'auth.login_failed', req, userId: u.id, detail: { username: uname, reason: 'system_locked' } });
      return { ok: false, reason: 'locked', message: lock[0].message };
    }

    const token = randomBytes(32).toString('base64url');
    const { rows: sess } = await q(
      `INSERT INTO user_session (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => (
         SELECT coalesce((SELECT (value #>> '{}')::int FROM system_setting WHERE key = 'session_max_hours'), 12)::int)))
       RETURNING id`,
      [u.id, sha256(token), req?.ip ?? null, req?.get?.('user-agent')?.slice(0, 500) ?? null],
    );

    await logEvent(q, { action: 'auth.login', req, userId: u.id, roomId: u.room_id, sessionId: sess[0].id });

    delete u.password_hash;
    return { ok: true, user: u, token, sessionId: sess[0].id };
  });
}

/**
 * Resolve a cookie to a user, sliding the idle timeout forward.
 * Returns null for absent, unknown, expired, idle-expired or revoked sessions.
 */
export async function resolveSession(token) {
  if (!token) return null;
  return withoutActor(async q => {
    const { rows } = await q(
      `UPDATE user_session s
          SET last_seen_at = now()
        FROM app_user u, system_setting idle
       WHERE s.token_hash = $1
         AND s.user_id = u.id
         AND idle.key = 'session_idle_minutes'
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > now() - make_interval(mins => (idle.value #>> '{}')::int)
         AND u.is_active
      RETURNING s.id AS session_id, u.id, u.username, u.full_name, u.role,
                u.room_id, u.must_change_password, u.job_title, u.phone_extension,
                -- Scalar subqueries rather than a join: this is an UPDATE ... FROM,
                -- and adding room to the FROM list would turn it into an inner join
                -- and lock out anyone without a room, which is IT.
                (SELECT name            FROM room WHERE id = u.room_id) AS room_name,
                (SELECT room_number     FROM room WHERE id = u.room_id) AS room_number,
                (SELECT phone_extension FROM room WHERE id = u.room_id) AS room_extension,
                (SELECT department      FROM room WHERE id = u.room_id) AS room_department,
                (SELECT floor_label     FROM room WHERE id = u.room_id) AS room_floor`,
      [sha256(token)],
    );
    return rows[0] ?? null;
  });
}

/**
 * The room a person is sitting in, and the rooms they may look into.
 *
 * Kept out of resolveSession because it is wanted by the page shell and not by
 * the session check, and running it on every request including every download
 * and every print sheet would be two queries where one will do. The pages that
 * want it ask for it.
 *
 * app_visible_rooms() is the same function row-level security uses, so this list
 * can never offer a room the database would refuse. That is the whole reason the
 * switcher is safe: it is not a way to become another room, it is a view of the
 * rooms you already are.
 */
export async function roomContext(user) {
  if (!user) return { room: null, rooms: [] };
  return withActor(user, async q => {
    const { rows: [room] } = await q(
      `SELECT id, name, room_number, phone_extension, department, floor_label
         FROM room WHERE id = $1`, [user.roomId ?? 0]);
    const { rows: rooms } = await q(
      `SELECT id, name, room_number FROM room
        WHERE is_active AND id = ANY (app_visible_rooms())
        ORDER BY sort_order, ku_sort_key(name)`);
    return { room: room ?? null, rooms };
  });
}

export async function logout({ token, user, req }) {
  if (!token) return;
  await withActor(user, async q => {
    const { rows } = await q(
      `UPDATE user_session SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id`,
      [sha256(token)],
    );
    if (rows[0]) {
      await logEvent(q, { action: 'auth.logout', req, userId: user?.id, sessionId: rows[0].id });
    }
  });
}

/**
 * Express middleware. Attaches req.user and req.sessionId, or leaves them null.
 * It never redirects; requireAuth below decides what an anonymous request means.
 */
export function attachUser() {
  return async (req, _res, next) => {
    try {
      const u = await resolveSession(req.cookies?.[COOKIE]);
      req.user = u ? {
        id: u.id, username: u.username, fullName: u.full_name, role: u.role, roomId: u.room_id,
        jobTitle: u.job_title ?? null, extension: u.phone_extension ?? null,
        roomName: u.room_name ?? null, roomNumber: u.room_number ?? null,
        roomExtension: u.room_extension ?? null, roomDepartment: u.room_department ?? null,
        roomFloor: u.room_floor ?? null,
      } : null;
      req.sessionId = u?.session_id ?? null;
      req.mustChangePassword = u?.must_change_password ?? false;
    } catch (err) {
      console.error('[auth] session lookup failed:', err.message);
      req.user = null;
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect(303, '/login');
  if (req.mustChangePassword && !req.path.startsWith('/password')) return res.redirect(303, '/password');
  next();
}

/** Route-level role gate. The database still enforces the real rules. */
export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.user) return res.redirect(303, '/login');
    if (!allowed.has(req.user.role)) return refused(req, res);
    next();
  };
}

// A Secure cookie is never sent back over plain HTTP, so tying this to NODE_ENV
// alone means a production build cannot be tested on localhost: the browser
// silently drops the cookie and login appears to loop for no reason. SECURE_COOKIES
// decides it when set; NODE_ENV is only the fallback. Set SECURE_COOKIES=true the
// moment there is TLS in front, which is a line in the deployment checklist.
const SECURE_COOKIES = process.env.SECURE_COOKIES
  ? process.env.SECURE_COOKIES === 'true'
  : process.env.NODE_ENV === 'production';

export const setSessionCookie = (res, token) =>
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    path: '/',
  });

export const clearSessionCookie = res => res.clearCookie(COOKIE, { path: '/' });

// Timing-safe compare for CSRF tokens and similar fixed-length secrets.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
