// Rania Municipality document system — web server.
//
// Server-rendered HTML, no single-page application. Fewer moving parts, works on
// old office machines, survives a refresh, and prints properly. Print is a
// first-class feature here, not an afterthought.

import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomBytes, createHmac } from 'crypto';

import { attachUser, requireAuth, safeEqual } from './lib/auth.mjs';
import { healthy, shutdown } from './lib/db.mjs';
import { stop as stopRealtime } from './lib/realtime.mjs';
import { authPage } from './views/layout.mjs';
import { html } from './lib/html.mjs';
import { notFound } from './lib/respond.mjs';

import loginRoutes from './routes/login.mjs';
import registryRoutes from './routes/registry.mjs';
import inboxRoutes from './routes/inbox.mjs';
import documentRoutes from './routes/documents.mjs';
import dashboardRoutes from './routes/dashboard.mjs';
import archiveRoutes from './routes/archive.mjs';
import leaveRoutes from './routes/leave.mjs';
import outgoingRoutes from './routes/outgoing.mjs';
import adminRoutes from './routes/admin.mjs';
import printRoutes from './routes/print.mjs';
import attachmentRoutes from './routes/attachments.mjs';
import assistantRoutes from './routes/assistant.mjs';
import cronRoutes from './routes/cron.mjs';
import templateRoutes from './routes/templates.mjs';
import trayRoutes from './routes/tray.mjs';
import barcodeRoutes from './routes/barcode-lookup.mjs';
import manifestRoutes from './routes/manifests.mjs';
import companyRoutes from './routes/companies.mjs';
import trackRoutes from './routes/track.mjs';
import docTypeRoutes from './routes/doctypes.mjs';
import notificationRoutes from './routes/notifications.mjs';
import boardRoutes from './routes/board.mjs';
import photoRoutes from './routes/photo.mjs';
import plotRoutes from './routes/plots.mjs';
import replyRoutes from './routes/reply.mjs';
import myDayRoutes from './routes/myday.mjs';
import scannerRoutes from './routes/scanners.mjs';
import verifyRoutes from './routes/verify.mjs';
import alertRoutes from './routes/alerts.mjs';
import reportRoutes from './routes/reports.mjs';
import caseRoutes from './routes/case.mjs';
import compareRoutes from './routes/compare.mjs';
import stampRoutes from './routes/stamp.mjs';
import marginRoutes from './routes/margin.mjs';
import plotMapRoutes from './routes/plotmap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

// nginx sits in front on the LAN and nothing else does, so its headers are
// trustworthy. Without this every request appears to come from 127.0.0.1 and
// the log records nothing useful about who did what from where.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());

app.use((_req, res, next) => {
  // No external scripts, no inline event handlers, nothing framed. The pages are
  // plain HTML and two Google font requests, so this can be strict.
  //
  // manifest-src and worker-src are named rather than left to default-src. Both
  // would fall back to it correctly today, but worker-src falls back through
  // child-src to script-src, and a future tightening of script-src would take
  // the service worker down with it without anything saying so.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; " +
    "manifest-src 'self'; worker-src 'self'; connect-src 'self'; " +
    "form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Mounted before sessions and before CSRF, deliberately. The caller is a cron
// service, not a person: there is no cookie to attach and no token to check, and
// its own bearer secret is what authorises it. Putting it here means a machine
// call never touches the session table.
app.use(cronRoutes);

app.use('/app.css', express.static(join(here, '..', 'public', 'app.css'), { maxAge: '1h' }));
app.use(express.static(join(here, '..', 'public'), { maxAge: '1h', index: false }));

app.use(attachUser());

// --- CSRF -------------------------------------------------------------------
// The token is derived from the session id, so there is no server-side store to
// keep in step and it survives a restart. GET is never state-changing.

const CSRF_SECRET = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
const csrfFor = sessionId => createHmac('sha256', CSRF_SECRET).update(String(sessionId ?? 'anon')).digest('base64url');

app.use((req, res, next) => {
  res.locals.csrf = csrfFor(req.sessionId);
  // Also on the user, because the page shell renders the sign-out form and has
  // no other way to reach it. It is a per-request object built by attachUser,
  // so nothing outlives the request.
  if (req.user) req.user.csrf = res.locals.csrf;
  // A multipart upload has no parsed body at this point; the upload route reads
  // the token from the parsed fields and checks it itself. Everything else is
  // checked here.
  const isMultipart = (req.get('content-type') ?? '').startsWith('multipart/form-data');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isMultipart) {
    const given = req.body?._csrf ?? req.get('x-csrf-token');
    // The login form is posted by someone with no session yet, so it is checked
    // against the anonymous token rather than skipped.
    if (!given || !safeEqual(given, csrfFor(req.sessionId))) {
      return res.status(403).send(String(authPage({
        title: 'داواکاری ڕەتکرایەوە',
        body: html`<div class="auth-form">
          <div class="auth-head"><h1>داواکاری ڕەتکرایەوە</h1></div>
          <p class="auth-sub">لەوانەیە دانیشتنەکەت بەسەرچووبێت. تکایە دووبارە بچۆرە ژوورەوە.</p>
          <a class="btn auth-submit" href="/login">چوونەژوورەوە</a>
        </div>`,
      })));
    }
  }
  next();
});

// ?ok= and ?error= carry the message a form's answer shows. Arriving from outside
// the application, a link in an email or a message, they would put any sentence
// in the green or red box of an official screen (records test, 13 September).
// The browser says where a navigation came from; only the application's own
// redirects and links carry a notice.
app.use((req, _res, next) => {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && (req.query.ok !== undefined || req.query.error !== undefined)) {
    delete req.query.ok;
    delete req.query.error;
  }
  next();
});

// Nothing a signed-in person sees is kept by the browser.
//
// Without this, signing out and pressing Back put the register back on the
// screen, every number, subject and sender, replayed from the browser's memory
// with no request to the server at all. On a counter computer the next person in
// the queue could do it. Found by the browser audit of 13 September. Files and
// the board already said no-store; now every page does.
app.use((req, res, next) => {
  if (req.user) res.setHeader('Cache-Control', 'no-store');
  next();
});

// --- routes -----------------------------------------------------------------

app.get('/healthz', async (_req, res) => {
  const ok = await healthy();
  res.status(ok ? 200 : 503).json({ ok, at: new Date().toISOString() });
});

app.use(loginRoutes);
// Public, like the login page and for the same reason: the person using it has
// no account. Everything it can reach is one SECURITY DEFINER function that
// returns a stage and three dates. See routes/track.mjs.
app.use(trackRoutes);
// Public for the same reason: the bank clerk checking a letter has no account.
// One SECURITY DEFINER function that returns a number, a date and a name. See
// routes/verify.mjs.
app.use(verifyRoutes);
// The corridor wall board. Mounted with the public routes because the screen on
// the wall has no account, and it reaches exactly one database function that
// cannot return a subject or a name. See routes/board.mjs.
app.use(boardRoutes);
app.use(requireAuthAll, photoRoutes);
app.use(requireAuthAll, registryRoutes);
app.use(requireAuthAll, inboxRoutes);
app.use(requireAuthAll, documentRoutes);
app.use(requireAuthAll, dashboardRoutes);
app.use(requireAuthAll, archiveRoutes);
app.use(requireAuthAll, leaveRoutes);
app.use(requireAuthAll, outgoingRoutes);
app.use(requireAuthAll, adminRoutes);
app.use(requireAuthAll, printRoutes);
app.use(requireAuthAll, attachmentRoutes);
app.use(requireAuthAll, templateRoutes);
app.use(requireAuthAll, trayRoutes);
app.use(requireAuthAll, barcodeRoutes);
app.use(requireAuthAll, manifestRoutes);
app.use(requireAuthAll, companyRoutes);
app.use(requireAuthAll, docTypeRoutes);
app.use(requireAuthAll, assistantRoutes);
app.use(requireAuthAll, notificationRoutes);
app.use(requireAuthAll, plotRoutes);
app.use(requireAuthAll, replyRoutes);
app.use(requireAuthAll, myDayRoutes);
app.use(requireAuthAll, scannerRoutes);
app.use(requireAuthAll, alertRoutes);
app.use(requireAuthAll, reportRoutes);
app.use(requireAuthAll, caseRoutes);
app.use(requireAuthAll, compareRoutes);
app.use(requireAuthAll, stampRoutes);
app.use(requireAuthAll, marginRoutes);
app.use(requireAuthAll, plotMapRoutes);

// Everything past the login routes needs a signed-in user. Individual routes
// still check their own role, and the database enforces the real rules.
function requireAuthAll(req, res, next) { return requireAuth(req, res, next); }

// Role-based landing, per BUILD-PLAN.md section 4.2.
const LANDING = {
  mayor:            '/dashboard',
  deputy_mayor:     '/dashboard',
  directorate_head: '/directorate',
  room_head:        '/inbox',
  room_clerk:       '/inbox',
  registry_clerk:   '/registry',
  archive_clerk:    '/archive',
  hr:               '/leave',
  sysadmin:         '/admin/users',
};

app.get('/', requireAuth, (req, res) => res.redirect(303, LANDING[req.user.role] ?? '/inbox'));

// --- errors -----------------------------------------------------------------

app.use((req, res) => notFound(req, res, 'ئەم پەڕەیە بوونی نییە.'));

app.use((err, req, res, _next) => {
  // The message goes to the server log, never to the screen: a database error
  // can quote row contents, and the person seeing the screen may not be allowed
  // to read them.
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).send(String(authPage({
    title: 'هەڵەیەک ڕوویدا',
    body: html`<div class="auth-form">
      <div class="auth-head"><h1>هەڵەیەک ڕوویدا</h1></div>
      <p class="auth-sub">داواکارییەکەت تەواو نەبوو. تکایە دووبارە هەوڵبدەوە، یان پەیوەندی بە بەڕێوەبەری سیستەم بکە.</p>
      <a class="btn auth-submit" href="/">گەڕانەوە</a>
    </div>`,
  })));
});

// --- lifecycle --------------------------------------------------------------

// A thrown error inside an async handler's own catch block, or a rejected
// promise nobody awaited, would otherwise end the process and sign out the
// whole municipality. Record it and keep serving; the systemd unit restarts the
// process if anything genuinely fatal happens.
process.on('unhandledRejection', err => console.error('[unhandled rejection]', err));
process.on('uncaughtException', err => console.error('[uncaught exception]', err));

// On a serverless platform the runtime owns the HTTP listener, and importing this
// module must not bind a port or install signal handlers. VERCEL is set by that
// platform; SERVERLESS is the manual override for any other one.
const SERVERLESS = Boolean(process.env.VERCEL || process.env.SERVERLESS);

if (!SERVERLESS) {
  const PORT = Number(process.env.PORT || 3000);
  const server = app.listen(PORT, () => {
    console.log(`docsys listening on http://localhost:${PORT}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`\n${sig} received, closing`);
      server.close(async () => { await stopRealtime(); await shutdown(); process.exit(0); });
      setTimeout(() => process.exit(1), 8000).unref();
    });
  }
}

export default app;
