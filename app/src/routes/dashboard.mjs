// The mayor's desk, the rooms overview, and the activity log.
//
// Screen: design/Main.dc.html.
//
// The dashboard is exception-first. With twenty-five to thirty rooms, a table of
// everything is a wall; what the mayor needs at a glance is what is late, what
// is at risk, and what happened since he last looked. The full per-room table
// comes after that, not before.

import { Router } from 'express';
import { withActor } from '../lib/db.mjs';
import { requireAuth, requireRole, roomContext } from '../lib/auth.mjs';
import { overdue } from '../lib/routing.mjs';
import { page } from '../views/layout.mjs';
import { html, num, date, time, elapsed, ltr, initials } from '../lib/html.mjs';

const router = Router();

const MAYORS = ['mayor', 'deputy_mayor'];
const OVERSEERS = ['mayor', 'deputy_mayor', 'directorate_head'];

// Kurdish names for every action in lib/log.mjs.
//
// About forty were missing, and the log and the dashboard's activity feed showed
// the program's own codes to the mayor: company.viewed, step.sent,
// attachment.added (browser audit, 13 September). test/log-names.test.mjs holds
// every code in ACTIONS to having a name here, so a new action cannot arrive
// without one.
export const ACTION_KU = {
  'auth.login': 'چووە ژوورەوە', 'auth.login_failed': 'هەوڵی چوونەژوورەوەی سەرنەکەوتوو',
  'auth.login_throttled': 'چوونەژوورەوە بۆ ماوەیەک ڕاگیرا', 'auth.logout': 'دەرچوو',
  'auth.password_changed': 'وشەی نهێنی گۆڕی', 'auth.session_revoked': 'دانیشتنێک کۆتایی پێهێنرا',

  'document.registered': 'کتابی تۆمارکرد', 'document.updated': 'کتابی دەستکاری کرد',
  'document.viewed': 'کتابی کردەوە', 'document.printed': 'کتابی چاپکرد',
  'document.closed': 'کتابی داخست', 'document.cancelled': 'کتابی هەڵوەشاندەوە',
  'document.legacy_imported': 'کتابی کۆنی هێنایە ناو سیستەم',
  'access.refused': 'داوای کتابێکی کرد کە ڕێگەی پێنەدرا', 'case.viewed': 'هەموو دۆسیەی کتابێکی بینی',
  'compare.viewed': 'هاتوو و دەرچووی کتابێکی بەراورد کرد',
  'margin.written': 'هامشی دەستنووسی لەسەر کتاب نووسی',
  'stamp.applied': 'مۆری هاتوو/دەرچووی لە سکانێک دا',
  'verify.issued': 'کۆدی پشتڕاستکردنەوەی بۆ کتاب دەرکرد', 'verify.hit': 'کتابێک پشتڕاستکرایەوە',
  'verify.miss': 'پشتڕاستکردنەوەیەک نەدۆزرایەوە', 'verify.throttled': 'پشتڕاستکردنەوە بۆ ماوەیەک ڕاگیرا',

  'step.sent': 'کتابی نارد', 'step.sequence_sent': 'کتابی بە ڕیزبەندی نارد',
  'step.activated': 'نۆرەی ژووری دواتر هات', 'step.received': 'کتابی وەرگرت',
  'step.completed': 'هەنگاوی تەواوکرد', 'step.forwarded': 'کتابی بۆ ژوورێکی تر نارد',
  'step.returned': 'کتابی گەڕاندەوە', 'step.recalled': 'ناردنەکەی گەڕاندەوە',
  'step.reassigned': 'کتابی دایە کەسێکی تر', 'step.skipped': 'هەنگاوێکی تێپەڕاند',
  'step.cancelled': 'هەنگاوێک هەڵوەشێنرایەوە', 'step.paper_received': 'پەڕگەی کاغەزی وەرگرت',

  'manifest.created': 'لیستی گەیاندنی دروستکرد', 'manifest.received': 'لیستی گەیاندنی وەرگرت',
  'manifest.cancelled': 'لیستی گەیاندنی هەڵوەشاندەوە', 'manifest.printed': 'لیستی گەیاندنی چاپکرد',
  'barcode.scanned': 'بارکۆدی خوێندەوە', 'barcode.miss': 'بارکۆدێکی نەناسراو خوێندرایەوە',
  'note.added': 'تێبینی نووسی',

  'company.created': 'کۆمپانیای تۆمارکرد', 'company.updated': 'زانیاری کۆمپانیای گۆڕی',
  'company.linked': 'کتابی بە کۆمپانیاوە بەست', 'company.unlinked': 'کتابی لە کۆمپانیا لابرد',
  'company.file_added': 'پەڕگەی کۆمپانیای زیادکرد', 'company.file_withdrawn': 'پەڕگەی کۆمپانیای کشاندەوە',
  'company.viewed': 'کۆمپانیای کردەوە',
  'doc_type.created': 'جۆری مامەڵەی زیادکرد', 'doc_type.updated': 'جۆری مامەڵەی گۆڕی',

  'notify.read_all': 'ئاگادارکردنەوەکانی خوێندەوە', 'push.subscribed': 'ئاگادارکردنەوەی مۆبایلی چالاککرد',
  'push.removed': 'ئاگادارکردنەوەی مۆبایلی لابرد',
  'track.hit': 'هاووڵاتییەک دۆخی کتابی بینی', 'track.miss': 'بەدواداچوونێکی هاووڵاتی نەدۆزرایەوە',
  'track.throttled': 'بەدواداچوونی هاووڵاتی بۆ ماوەیەک ڕاگیرا', 'receipt.printed': 'پسوولەی چاپکرد',

  'attachment.added': 'هاوپێچی زیادکرد', 'attachment.viewed': 'هاوپێچی بینی',
  'attachment.downloaded': 'هاوپێچی داگرت', 'attachment.printed': 'هاوپێچی چاپکرد',
  'attachment.rejected_virus': 'هاوپێچێک بەهۆی ڤایرۆسەوە ڕەتکرایەوە',

  'archive.uploaded': 'نەخشەی بارکرد', 'archive.updated': 'زانیاری نەخشەی گۆڕی',
  'archive.viewed': 'نەخشەی بینی', 'archive.downloaded': 'نەخشەی داگرت',
  'archive.verified': 'نەخشەی پشتڕاستکردەوە', 'archive.linked': 'نەخشەی بە کتابەوە بەست',
  'archive.unlinked': 'نەخشەی لە کتاب لابرد', 'archive.location_changed': 'شوێنی نەخشەی گۆڕی',
  'archive.batch_opened': 'کۆمەڵێک نەخشەی کردەوە', 'archive.batch_qc': 'کۆمەڵێک نەخشەی پشکنی',

  'tray.detected': 'سکانێکی نوێ گەیشتە سینی', 'tray.claimed': 'سکانی بە کتابەوە بەست',
  'tray.archived': 'سکانی ناردە ئەرشیف',
  'scanner.added': 'سکانەری زیادکرد', 'scanner.changed': 'سکانەری گۆڕی',

  'template.created': 'تێمپلەیتی دروستکرد', 'template.updated': 'تێمپلەیتی گۆڕی',
  'template.filled': 'تێمپلەیتی پڕکردەوە', 'template.printed': 'تێمپلەیتی چاپکرد',
  'template.deactivated': 'تێمپلەیتی ناچالاککرد',

  'leave.requested': 'داوای مۆڵەت کرد', 'leave.approved': 'مۆڵەتی پەسەندکرد',
  'leave.rejected': 'مۆڵەتی ڕەتکردەوە', 'leave.cancelled': 'مۆڵەتی هەڵوەشاندەوە',
  'delegation.started': 'جێگر دەستبەکار بوو', 'delegation.ended': 'کاری جێگر کۆتایی هات',
  'delegation.ended_early': 'کاری جێگر زووتر کۆتایی هات',

  'send.queued': 'ناردنی دەرەکی ڕیزکرا', 'send.sent': 'بۆ دەرەوە نێردرا',
  'send.failed': 'ناردنی دەرەکی سەرنەکەوت', 'send.response_linked': 'وەڵامی دەرەکی بەسترایەوە',

  'user.created': 'هەژماری دروستکرد', 'user.updated': 'هەژماری گۆڕی',
  'user.password_reset': 'وشەی نهێنی نوێکردەوە', 'user.deactivated': 'هەژماری ناچالاککرد',
  'room.created': 'ژووری دروستکرد', 'room.updated': 'ژووری گۆڕی',
  'directorate.updated': 'بەڕێوەبەرایەتیی گۆڕی',
  'route_template.created': 'ڕێڕەوی ئامادەی دروستکرد', 'route_template.updated': 'ڕێڕەوی ئامادەی گۆڕی',
  'system.locked': 'سیستەمی داخست', 'system.unlocked': 'سیستەمی کردەوە',
  'system.setting_changed': 'ڕێکخستنی سیستەمی گۆڕی',
  'report.viewed': 'ڕاپۆرتی هەفتانەی بینی', 'report.printed': 'ڕاپۆرتی هەفتانەی چاپکرد',
  'alert.seen': 'ئاگادارییەکی ئەمنی بینی',
  'plot.located': 'شوێنی پارچەیەکی لەسەر نەخشە دیاریکرد', 'plot.moved': 'شوێنی پارچەیەکی لەسەر نەخشە گۆڕی',
  'map.viewed': 'نەخشەی پارچەکانی بینی',

  'assistant.question': 'پرسیاری لە یاریدەدەر کرد', 'assistant.tool_call': 'یاریدەدەر زانیاری هێنا',
  'assistant.answer': 'یاریدەدەر وەڵامی دایەوە', 'assistant.no_rows': 'یاریدەدەر هیچی نەدۆزییەوە',
  'assistant.error': 'هەڵە لە یاریدەدەر', 'assistant.fallback': 'یاریدەدەر بە ڕێگای یەدەگ وەڵامی دایەوە',
  'assistant.search_archive': 'یاریدەدەر لە ئەرشیف گەڕا',

  'ops.backup_completed': 'یەدەگ گیرا', 'ops.backup_failed': 'گرتنی یەدەگ سەرنەکەوت',
  'ops.backup_verified': 'یەدەگ پشکنرا', 'ops.migration_applied': 'سیستەم نوێکرایەوە',

  'search.documents': 'گەڕا بەدوای کتاب', 'search.archive': 'گەڕا لە ئەرشیف',
  'search.rooms': 'گەڕا بەدوای ژوور', 'search.people': 'گەڕا بەدوای کەس',
};

// The filter on the log screen: groups a person recognises rather than codes they
// would have to know.
const ACTION_GROUPS = [
  ['', 'هەموو کردارەکان'], ['auth.', 'چوونەژوورەوە و دەرچوون'], ['document.', 'کتاب'],
  ['step.', 'ناردن و وەرگرتن'], ['note.', 'تێبینی'], ['attachment.', 'هاوپێچ'],
  ['manifest.', 'لیستی گەیاندن'], ['archive.', 'ئەرشیفی نەخشە'], ['tray.', 'سینیی سکان'],
  ['company.', 'کۆمپانیا'], ['template.', 'تێمپلەیت'], ['leave.', 'مۆڵەت'],
  ['user.', 'هەژمارەکان'], ['room.', 'ژوورەکان'], ['system.', 'سیستەم'],
  ['search.', 'گەڕان'], ['track.', 'بەدواداچوونی هاووڵاتی'], ['assistant.', 'یاریدەدەر'],
  ['access.', 'ڕێگەپێنەدان'], ['margin.', 'هامش'], ['verify.', 'پشتڕاستکردنەوەی کتاب'],
  ['plot.', 'نەخشەی پارچەکان'], ['alert.', 'ئاگادارییە ئەمنییەکان'],
];

// What the detail keys mean, for the few that recur. Unknown keys are shown as
// they are, inside the folded details, which is where IT looks for them.
const DETAIL_KU = {
  seq_no: 'هەنگاو', due_days: 'ماوە (ڕۆژ)', via_delegation: 'لە ڕێگەی جێگر', step_id: 'ژمارەی هەنگاو',
  attachment_id: 'هاوپێچ', size_bytes: 'قەبارە (بایت)', sha256: 'هاش', virus_scan: 'پشکنینی ڤایرۆس',
  kind: 'جۆر', action_taken: 'کردار', incoming_no: 'ژمارەی کتاب', note_id: 'تێبینی', length: 'درێژی',
  company_id: 'کۆمپانیا', tray_id: 'سکان', target_user_id: 'بەکارهێنەر', new_user_id: 'بەکارهێنەر',
  username: 'ناوی بەکارهێنەر', role: 'ڕۆڵ', room_id: 'ژوور', is_active: 'چالاک', field: 'خانە',
  template_id: 'تێمپلەیت', fill_id: 'پڕکراوە', version: 'وەشان', fields: 'خانەکان',
  leave_id: 'مۆڵەت', for_user_id: 'بۆ', from: 'لە', to: 'بۆ', code: 'کۆد', manifest_id: 'لیستی گەیاندن',
  source: 'سەرچاوە', reason: 'هۆکار', count: 'ژمارە',
  what: 'چی', target_id: 'ژمارەی داواکراو', rooms: 'ژوورەکان', page: 'پەڕە', margin_id: 'هامش',
  plot_no: 'پارچە', lat: 'پانی', lng: 'درێژی', week: 'هەفتە', alert_id: 'ئاگاداری', alert: 'جۆری ئاگاداری',
  rung: 'پلە', days_late: 'ڕۆژی دواکەوتن',
};
// What a person typed into a search box is usually a citizen's name or a plot
// number, which is letter content in all but name, and IT is not to see letter
// content (security test, 13 September). The log keeps it, for the mayor's office
// and for an investigation; IT's view of the log leaves it out.
const SEARCH_TEXT_KEYS = ['q', 'raw', 'query', 'text'];
function shownDetail(l, user) {
  if (user.role !== 'sysadmin' || !String(l.action).startsWith('search.')) return l.detail;
  return Object.fromEntries(Object.entries(l.detail).map(([k, v]) =>
    [k, SEARCH_TEXT_KEYS.includes(k) && v ? '(پیشان نادرێت)' : v]));
}
// Counts, ids, days and dates in Kurdish digits like every other number on the
// screen; they showed as 12 and 2026-10-01 inside the folded details (design
// test, 13 September). Identifiers and what somebody typed stay as written.
const DETAIL_AS_WRITTEN = new Set(['incoming_no', 'outgoing_no', 'manifest_no', 'registration_no', 'plot_key',
  'code', 'barcode', 'username', 'by_username', 'sha', 'sha256', 'host', ...SEARCH_TEXT_KEYS]);
const detailValue = (k, v) => v === true ? 'بەڵێ' : v === false ? 'نەخێر' : v == null ? '—'
  : typeof v === 'object' ? JSON.stringify(v)
  : DETAIL_AS_WRITTEN.has(k) ? String(v)
  : typeof v === 'number' || /^\d+$/.test(v) ? num(v)
  : /^\d{4}-\d{2}-\d{2}$/.test(v) ? num(v.replace(/-/g, '/'))
  : String(v);
export const actionName = a => ACTION_KU[a] ?? a;

// ---------------------------------------------------------------------------
// Everything the dashboard shows, in one round trip
// ---------------------------------------------------------------------------

// Where a late letter is on the escalation ladder (migration 0520).
const LADDER = {
  1: ['warn',   'بیرخراوەتەوە'],
  2: ['warn',   'بەرپرس ئاگادارە'],
  3: ['danger', 'گەیشتووەتە لای سەرۆک'],
};
const ladderPill = rung => LADDER[rung]
  ? html`<span class="pill ${LADDER[rung][0]}">${LADDER[rung][1]}</span>`
  : html`<span class="pill muted">ئەمڕۆ</span>`;

async function dashboardData(q) {
  const { rows: [counts] } = await q(`
    SELECT
      (SELECT count(*) FROM document WHERE incoming_date = current_date)                      AS today_in,
      (SELECT count(*) FROM document WHERE outgoing_date >= date_trunc('month', current_date)) AS month_out,
      (SELECT count(*) FROM routing_step WHERE status = 'active')                              AS active_steps,
      (SELECT count(*) FROM routing_step WHERE status = 'active' AND due_at < now())           AS overdue_steps,
      (SELECT count(*) FROM document WHERE status = 'ready_to_close')                          AS ready_to_close,
      (SELECT count(*) FROM routing_step s JOIN room r ON r.id = s.to_room_id
        WHERE s.status = 'active' AND r.kind = 'executive')                                    AS waiting_for_me,
      (SELECT count(*) FROM security_alert WHERE seen_at IS NULL)                              AS alerts_unseen,
      setting_int('escalate_head_days', 3)                                                     AS ladder_head,
      setting_int('escalate_mayor_days', 5)                                                    AS ladder_mayor`);

  const { rows: rooms } = await q(`
    SELECT r.id, r.name, r.room_number, r.kind, r.sort_order,
           h.full_name AS head_name, d.full_name AS deputy_name,
           r.deputy_user_id IS NULL AS no_deputy,
           EXISTS (SELECT 1 FROM room_delegation g
                    WHERE g.room_id = r.id AND g.starts_on <= current_date
                      AND g.ends_on >= current_date AND g.ended_early_at IS NULL) AS head_away,
           count(s.id) FILTER (WHERE s.status = 'active')                          AS pending,
           count(s.id) FILTER (WHERE s.status = 'active' AND s.due_at < now())     AS late,
           min(s.sent_at) FILTER (WHERE s.status = 'active')                       AS oldest_sent
      FROM room r
      LEFT JOIN app_user h ON h.id = r.head_user_id
      LEFT JOIN app_user d ON d.id = r.deputy_user_id
      LEFT JOIN routing_step s ON s.to_room_id = r.id
     WHERE r.is_active
     GROUP BY r.id, h.full_name, d.full_name
     ORDER BY r.sort_order, r.name`);

  const late = await overdue(q, { limit: 15 });

  const { rows: recent } = await q(`
    SELECT l.id, l.occurred_at, l.action, l.detail, l.document_id,
           u.full_name AS user_name, r.name AS room_name, d.incoming_no
      FROM activity_log l
      LEFT JOIN app_user u ON u.id = l.user_id
      LEFT JOIN room     r ON r.id = l.room_id
      LEFT JOIN document d ON d.id = l.document_id
     WHERE l.action NOT LIKE 'document.viewed' AND l.action NOT LIKE 'search.%'
     ORDER BY l.id DESC LIMIT 40`);

  const { rows: [lock] } = await q(`
    SELECT coalesce((SELECT value::boolean FROM system_setting WHERE key = 'system_locked'), false) AS locked,
           coalesce((SELECT value #>> '{}' FROM system_setting WHERE key = 'lock_message'), '') AS message`);

  return { counts, rooms, late, recent, lock };
}

function roomRow(r) {
  const risk = r.head_away && r.no_deputy;
  return html`<tr>
    <td>
      <a href="/inbox?room=${r.id}">${r.name}</a>
      ${r.room_number ? html`<span class="muted"> (${num(r.room_number)})</span>` : ''}
    </td>
    <td>
      ${r.head_name ?? html`<span class="muted">—</span>`}
      ${r.head_away ? html` <span class="pill ${risk ? 'danger' : 'info'}">${risk ? 'لە مۆڵەتە، جێگری نییە' : 'لە مۆڵەتە'}</span>` : ''}
    </td>
    <td>${num(r.pending)}</td>
    <td class="muted">${r.oldest_sent ? elapsed(r.oldest_sent) : '—'}</td>
    <td>
      ${Number(r.late) > 0 ? html`<span class="pill danger">${num(r.late)} دواکەوتوو</span>`
        : Number(r.pending) > 0 ? html`<span class="pill ok">لە کاتدا</span>`
        : html`<span class="pill muted">پاک</span>`}
    </td>
  </tr>`;
}

router.get('/dashboard', requireAuth, requireRole(...MAYORS), async (req, res, next) => {
  try {
    const { counts, rooms, late, recent, lock } = await withActor(req.user, dashboardData);
    const atRisk = rooms.filter(r => r.head_away && r.no_deputy);
    const reachedMayor = late.filter(l => l.rung >= 3);
    const noDeputy = rooms.filter(r => r.no_deputy && r.kind !== 'registry' && r.kind !== 'executive');

    res.send(page({
      user: req.user, title: 'داشبۆردی گشتی', current: '/dashboard',
      counts: { inbox: counts.waiting_for_me, alerts: Number(counts.alerts_unseen) || null },
      actions: html`<a class="btn secondary" href="/reports/weekly">ڕاپۆرتی هەفتانە</a>`,
      notice: lock.locked ? { kind: 'warn', text: `سیستەم داخراوە بۆ هەمووان جگە لە تۆ. ${lock.message}` } : null,
      body: html`
        <div class="grid cols-4 stats">
          <div class="stat"><div class="n">${num(counts.today_in)}</div><div class="k">هاتووی ئەمڕۆ</div></div>
          <div class="stat"><div class="n">${num(counts.waiting_for_me)}</div><div class="k">چاوەڕوانی بڕیاری من</div></div>
          <div class="stat"><div class="n${Number(counts.overdue_steps) > 0 ? ' danger' : ''}">${num(counts.overdue_steps)}</div><div class="k">دواکەوتوو لە ژوورەکان</div></div>
          <div class="stat"><div class="n">${num(counts.month_out)}</div><div class="k">دەرچووی ئەم مانگە</div></div>
        </div>

        ${Number(counts.alerts_unseen) > 0 ? html`
          <div class="notice warn dash-alerts">
            <strong>${num(counts.alerts_unseen)} ئاگاداری ئەمنی نەبینراو</strong> لە تۆماری چالاکیدا.
            <a href="/alerts">بینین</a>
          </div>` : ''}

        ${late.length || atRisk.length ? html`
          <div class="card attention">
            <div class="card-head">
              <h2>پێویستی بە سەرنجە</h2>
              ${reachedMayor.length ? html`<span class="pill danger">${num(reachedMayor.length)} گەیشتووەتە لای سەرۆک</span>` : ''}
            </div>
            ${late.length ? html`<p class="card-sub">
              دواکەوتن بە پلە بەرز دەبێتەوە: دوای ${num(counts.ladder_head)} ڕۆژ بەرپرسی ژوور ئاگادار دەکرێت و
              دوای ${num(counts.ladder_mayor)} ڕۆژ سەرۆک. ژمارەکان بەپێی جۆری مامەڵە دەگۆڕێن.
            </p>` : ''}
            ${atRisk.map(r => html`<div class="notice warn" style="margin-bottom:8px">
              ژووری <strong>${r.name}</strong>: بەرپرس لە مۆڵەتە و جێگری نییە. کتابەکان لەوێ دەوەستن.
            </div>`)}
            ${late.length ? html`<div class="table-wrap"><table>
              <thead><tr><th>ژمارە</th><th>بابەت</th><th>ژوور</th><th>لای</th><th>دواکەوتن</th></tr></thead>
              <tbody>${late.map(l => html`<tr class="${l.rung >= 3 ? 'escalated' : ''}">
                <td class="mono">${ltr(l.incoming_no)}</td>
                <td><a href="/documents/${l.document_id}">${l.subject}</a></td>
                <td>${l.room_name}</td>
                <td>${l.rung >= 3 ? html`<strong>${l.holder_name ?? '—'}</strong>` : html`<span class="muted">${l.holder_name ?? '—'}</span>`}
                  ${l.rung >= 2 && l.head_name && l.head_name !== l.holder_name ? html`<span class="cell-sub">بەرپرس: ${l.head_name}</span>` : ''}</td>
                <td class="nowrap"><span class="pill danger">${num(Math.floor(l.days_over))} ڕۆژ</span>
                  <span class="cell-sub">${ladderPill(l.rung)}</span></td>
              </tr>`)}</tbody>
            </table></div>` : ''}
          </div>` : ''}

        <!-- Rooms and the assistant on one side, the activity list on the other.
             The list takes the height of that side and scrolls inside itself, so
             the two sides end on the same line. Forty lines, so there is always
             more list than side; the rooms scroll too past a height, so a long
             list of rooms cannot leave the activity card half empty. -->
        <div class="grid cols-2 dash-pair">
          <div class="dash-side">
          <div class="card dash-rooms">
            <div class="card-head">
              <h2>ژوورەکان</h2>
              <div class="end"><a href="/rooms">هەمووی ببینە</a></div>
            </div>
            <div class="table-wrap"><table>
              <thead><tr><th>ژوور</th><th>بەرپرس</th><th>چاوەڕوان</th><th>کۆنترین</th><th>دۆخ</th></tr></thead>
              <tbody>${rooms.filter(r => r.kind !== 'executive').map(roomRow)}</tbody>
            </table></div>
            ${noDeputy.length ? html`<p class="hint">
              ${num(noDeputy.length)} ژوور جێگری نییە: ${noDeputy.map(r => r.name).join('، ')}.
            </p>` : ''}
          </div>

          <div class="card assistant-card">
            <h2>یاریدەدەر</h2>
            <form method="post" action="/assistant/ask" class="row">
              <input type="hidden" name="_csrf" value="${res.locals.csrf}">
              <input type="text" name="q" aria-label="پرسیار لە یاریدەدەر" maxlength="500" placeholder="پرسیارەکەت لێرە بنووسە" autocomplete="off">
              <button class="btn gold" type="submit">بپرسە</button>
            </form>
            <div class="hint" style="margin-top:12px">بۆ نموونە بپرسە:</div>
            <ul class="assistant-examples">
              <li>کتابی ٤٤٩٨ لای کێیە؟</li>
              <li>چی لە ژووری یاسا چاوەڕوانە؟</li>
              <li>کام ژوور دواکەوتووە؟</li>
              <li>کێ لە مۆڵەتە؟</li>
              <li>ئەمڕۆ چەند کتاب هاتووە؟</li>
            </ul>
          </div>
          </div>

          <div class="card dash-feed">
            <div class="card-head">
              <h2>دوایین چالاکییەکان</h2>
              <div class="end"><a href="/log">تۆماری تەواو</a></div>
            </div>
            ${recent.length === 0 ? html`<div class="empty">هێشتا هیچ چالاکییەک نییە.</div>` : html`
              <div class="table-wrap"><table><tbody>${recent.map(l => html`<tr>
                <td style="width:70px" class="muted">${time(l.occurred_at)}</td>
                <td>
                  <strong>${l.user_name ?? 'سیستەم'}</strong> ${actionName(l.action)}
                  ${l.incoming_no ? html` <a href="/documents/${l.document_id}" class="mono">${ltr(l.incoming_no)}</a>` : ''}
                  ${l.room_name ? html`<span class="muted"> · ${l.room_name}</span>` : ''}
                </td>
              </tr>`)}</tbody></table></div>`}
          </div>
        </div>

        <div class="card">
          <h2>${lock.locked ? 'کردنەوەی سیستەم' : 'داخستنی سیستەم'}</h2>
          <p class="card-sub">
            ${lock.locked
              ? 'ئێستا تەنها تۆ دەتوانیت بچیتە ژوورەوە. هەموو دانیشتنەکانی تر کۆتایی هاتوون.'
              : 'هەموو دانیشتنەکان کۆتایی دێن و هیچ کەس ناتوانێت بچێتە ژوورەوە جگە لە تۆ. کردنەوەی یەک کرتەیە.'}
          </p>
          <form method="post" action="${lock.locked ? '/admin/unlock' : '/admin/lock'}" class="row">
            <input type="hidden" name="_csrf" value="${res.locals.csrf}">
            ${lock.locked ? '' : html`<input type="text" name="message" aria-label="پەیامی داخستن" maxlength="300" placeholder="پەیامێک بۆ ئەوانەی هەوڵدەدەن بچنە ژوورەوە" style="max-width:420px">`}
            <button class="btn ${lock.locked ? '' : 'danger'}" type="submit">${lock.locked ? 'کردنەوەی سیستەم' : 'داخستنی سیستەم'}</button>
          </form>
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// All rooms
// ---------------------------------------------------------------------------

router.get('/rooms', requireAuth, requireRole(...OVERSEERS), async (req, res, next) => {
  try {
    const { rooms: all } = await withActor(req.user, dashboardData);
    // A directorate head sees the rooms of their directorate. Every room was
    // listed, counted through what the head may see, so rooms outside it read
    // as empty and "clean" when they were not (letters test, 13 September).
    const { rooms: visible } = await roomContext(req.user);
    const rooms = MAYORS.includes(req.user.role) ? all : all.filter(r => visible.some(v => Number(v.id) === Number(r.id)));
    res.send(page({
      user: req.user, title: MAYORS.includes(req.user.role) ? 'هەموو ژوورەکان' : 'ژوورەکانی بەڕێوەبەرایەتی', current: '/rooms',
      body: html`<div class="card"><div class="table-wrap"><table>
        <thead><tr><th>ژوور</th><th>بەرپرس</th><th>چاوەڕوان</th><th>کۆنترین</th><th>دۆخ</th></tr></thead>
        <tbody>${rooms.map(roomRow)}</tbody>
      </table></div></div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// The activity log. Row-level security decides what each role sees of it.
// ---------------------------------------------------------------------------

router.get('/log', requireAuth, async (req, res, next) => {
  try {
    const filter = String(req.query.action ?? '').trim();
    const who = String(req.query.user ?? '').trim();
    // Older pages by the last id seen rather than by an offset: new rows arriving
    // between two pages pushed a row from page one onto page two (records test).
    const before = Number(req.query.before) || null;
    const PER = 100;

    const rows = await withActor(req.user, async q => {
      const { rows } = await q(`
        SELECT l.id, l.occurred_at, l.action, l.detail, l.document_id, l.ip_address,
               u.full_name AS user_name, u.username, r.name AS room_name, d.incoming_no
          FROM activity_log l
          LEFT JOIN app_user u ON u.id = l.user_id
          LEFT JOIN room     r ON r.id = l.room_id
          LEFT JOIN document d ON d.id = l.document_id
         WHERE ($1 = '' OR l.action LIKE $1 || '%')
           AND ($2 = '' OR lower(u.username) = lower($2) OR u.full_name ILIKE '%' || $2 || '%')
           AND ($3::bigint IS NULL OR l.id < $3)
         ORDER BY l.id DESC
         LIMIT $4`, [filter, who, before, PER]);
      return rows;
    });

    res.send(page({
      user: req.user, title: 'تۆماری چالاکی', current: '/log',
      body: html`
        <div class="card">
          <form method="get" action="/log" class="row" role="search">
            <select name="action" aria-label="جۆری کردار" class="filter-field">
              ${ACTION_GROUPS.map(([k, l]) => html`<option value="${k}"${k === filter ? ' selected' : ''}>${l}</option>`)}
              ${filter && !ACTION_GROUPS.some(([k]) => k === filter) ? html`<option value="${filter}" selected>${actionName(filter)}</option>` : ''}
            </select>
            <input type="text" name="user" value="${who}" placeholder="ناوی بەکارهێنەر یان ناوی کەس" aria-label="ناوی بەکارهێنەر" dir="ltr" class="filter-field">
            <button class="btn" type="submit">گەڕان</button>
          </form>
          <p class="hint">هیچ ڕیزێک لەم تۆمارە ناتوانرێت بسڕدرێتەوە یان بگۆڕدرێت، لەلایەن هیچ کەسێکەوە.</p>
          ${rows.length === 0 ? html`<div class="empty">${filter || who || before ? 'هیچ کردارێک نەدۆزرایەوە.' : 'هیچ کردارێک نییە.'}</div>` : html`
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>کات</th><th>کێ</th><th>چی</th><th>کتاب</th><th>ژوور</th><th>وردەکاری</th></tr></thead>
            <tbody>${rows.map(l => html`<tr>
              <td class="muted">${num(l.id)}</td>
              <td class="muted">${date(l.occurred_at)} ${time(l.occurred_at)}</td>
              <td>${l.user_name ?? html`<span class="muted">سیستەم</span>`}</td>
              <td title="${l.action}">${actionName(l.action)}</td>
              <td>${l.incoming_no ? html`<a href="/documents/${l.document_id}" class="mono">${ltr(l.incoming_no)}</a>` : ''}</td>
              <td class="muted">${l.room_name ?? ''}</td>
              <td class="muted log-detail">${l.detail && Object.keys(l.detail).length ? html`<details>
                <summary>وردەکاری</summary>
                <dl>${Object.entries(shownDetail(l, req.user)).map(([k, v]) => html`<dt>${DETAIL_KU[k] ?? k}</dt><dd dir="auto">${detailValue(k, v)}</dd>`)}</dl>
              </details>` : ''}</td>
            </tr>`)}</tbody>
          </table></div>`}
          ${before || rows.length === PER ? html`<div class="row" style="margin-top:12px">
            ${before ? html`<a class="btn secondary" href="/log?action=${filter}&user=${who}">نوێترین</a>` : ''}
            ${rows.length === PER ? html`<a class="btn secondary" href="/log?action=${filter}&user=${who}&before=${rows[rows.length - 1].id}">کۆنتر</a>` : ''}
          </div>` : ''}
        </div>`,
    }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// The maintenance lock. What the mayor gets instead of a power switch.
// ---------------------------------------------------------------------------

router.post('/admin/lock', requireAuth, requireRole('mayor'), async (req, res, next) => {
  try {
    const message = String(req.body.message ?? '').trim().slice(0, 300);
    await withActor(req.user, async q => {
      await q(`INSERT INTO system_setting (key, value, updated_by) VALUES
                 ('system_locked', 'true', $1), ('lock_message', $2, $1),
                 ('lock_by', $3, $1), ('lock_at', to_jsonb(now()::text), $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
              [req.user.id, JSON.stringify(message), JSON.stringify(req.user.id)]);
      // Every session but this one ends now.
      await q(`UPDATE user_session SET revoked_at = now(), revoked_reason = 'system locked'
                WHERE revoked_at IS NULL AND id <> $1`, [req.sessionId]);
      await q(`INSERT INTO activity_log (user_id, action, detail, session_id)
               VALUES ($1, 'system.locked', $2, $3)`,
              [req.user.id, JSON.stringify({ message }), req.sessionId]);
    });
    res.redirect(303, '/dashboard');
  } catch (err) { next(err); }
});

router.post('/admin/unlock', requireAuth, requireRole('mayor'), async (req, res, next) => {
  try {
    await withActor(req.user, async q => {
      await q(`UPDATE system_setting SET value = 'false', updated_by = $1, updated_at = now() WHERE key = 'system_locked'`, [req.user.id]);
      await q(`INSERT INTO activity_log (user_id, action, detail, session_id) VALUES ($1, 'system.unlocked', '{}', $2)`,
              [req.user.id, req.sessionId]);
    });
    res.redirect(303, '/dashboard');
  } catch (err) { next(err); }
});

// A directorate head's view, same shape as the dashboard restricted to their rooms.
// Directorates are open question Q2; until answered this shows their own room's
// neighbourhood, and the schema's directorate table decides the rest.
router.get('/directorate', requireAuth, requireRole('directorate_head'), (req, res) => res.redirect(303, '/rooms'));

export default router;
