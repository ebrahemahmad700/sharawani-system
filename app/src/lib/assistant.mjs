// The assistant. The free, offline layer.
//
// PLAN.md section 7.6 describes a tool-calling design: a model reads the
// question, picks one of eight named database functions, the database returns
// rows, and the model phrases the answer. It also describes a rules layer that
// runs first, matching the commonest question shapes with plain patterns and
// answering from a template with no model involved at all.
//
// This file is that rules layer. It answers the questions the mayor actually
// asks most, it costs nothing, it works with the internet down, and it never
// sends a word outside the building. The model backend, when chosen in the
// week-24 bake-off, plugs in behind answer() for everything the rules do not
// catch. Until then, an unmatched question gets an honest "I did not
// understand; here is the search page" rather than a guess.
//
// Everything runs on the read-only role: eight-second statement timeout, no
// UPDATE anywhere, cannot read password hashes, may INSERT only into the log
// and the conversation tables. The model, when it arrives, gets the same role.

import { withReadonly } from './db.mjs';
import { kuNormalize, parseNumber, toArabicIndic } from './ku.mjs';
import { askModel, modelConfigured, MODEL } from './assistant-model.mjs';

// Where to send the reader after a model answer. Based on which tools were
// called, because the model's prose is not something to parse for a link.
function linkForCalls(calls) {
  const names = calls.map(c => c.name);
  const queue = calls.find(c => c.name === 'list_room_queue');
  if (queue?.args?.roomId) return `/inbox?room=${queue.args.roomId}`;
  if (names.includes('find_overdue')) return '/dashboard';
  if (names.includes('staff_on_leave')) return '/leave';
  if (names.includes('search_archive')) return '/archive';
  if (names.includes('count_documents')) return '/dashboard';
  if (names.includes('find_document') || names.includes('document_trail')) return '/documents';
  return null;
}

const n = v => toArabicIndic(v);
// The copula "is": یە after a word ending in a vowel letter, ە otherwise.
const ye = w => (/[اەۆوی]$/.test(String(w)) ? 'یە' : 'ە');

// ---------------------------------------------------------------------------
// The tool functions. Each is a plain query on the read-only connection. These
// are the same eight the model will be allowed to call; the rules layer uses
// five of them.
// ---------------------------------------------------------------------------

export const TOOLS = {
  async find_document(q, { serial, year, kind }) {
    const { rows } = await q(`
      SELECT d.id, d.incoming_no, d.outgoing_no, d.subject, d.status, d.sender_name, d.incoming_date,
             r.name AS room_name, u.full_name AS holder_name, s.sent_at, s.due_at,
             (s.due_at < now()) AS overdue
        FROM document d
        LEFT JOIN room r ON r.id = d.current_room_id
        LEFT JOIN routing_step s ON s.id = d.current_step_id
        LEFT JOIN app_user u ON u.id = s.assigned_to
       WHERE ($1::int IS NULL OR d.incoming_seq = $1 OR d.outgoing_seq = $1)
         AND ($2::int IS NULL OR d.incoming_year = $2 OR d.outgoing_year = $2)
         AND ($3::text IS NULL OR ($3 = 'incoming' AND d.incoming_seq = $1) OR ($3 = 'outgoing' AND d.outgoing_seq = $1))
       ORDER BY (d.incoming_seq = $1) DESC, d.incoming_year DESC LIMIT 5`, [serial, year, kind]);
    return rows;
  },

  async document_trail(q, { documentId }) {
    const { rows } = await q(`
      SELECT s.seq_no, s.status, s.sent_at, s.completed_at, s.action_taken, r.name AS room_name, u.full_name AS person
        FROM routing_step s JOIN room r ON r.id = s.to_room_id LEFT JOIN app_user u ON u.id = s.assigned_to
       WHERE s.document_id = $1 ORDER BY s.seq_no`, [documentId]);
    return rows;
  },

  async list_room_queue(q, { roomId }) {
    const { rows } = await q(`
      SELECT d.incoming_no, d.subject, s.sent_at, (s.due_at < now()) AS overdue, u.full_name AS holder,
             -- The whole count, not the length of the sample: «٢٠ کتاب» was the
             -- LIMIT, while the room had 143 (records test, 13 September).
             count(*) OVER () AS total,
             count(*) FILTER (WHERE s.due_at < now()) OVER () AS late_total
        FROM routing_step s JOIN document d ON d.id = s.document_id LEFT JOIN app_user u ON u.id = s.assigned_to
       WHERE s.to_room_id = $1 AND s.status = 'active'
       ORDER BY (s.due_at < now()) DESC, s.sent_at LIMIT 20`, [roomId]);
    return rows;
  },

  async find_overdue(q) {
    const { rows } = await q(`
      SELECT r.name AS room_name, count(*) AS late, min(s.due_at) AS oldest_due,
             max(extract(epoch FROM (now() - s.due_at)) / 86400)::int AS worst_days
        FROM routing_step s JOIN room r ON r.id = s.to_room_id
       WHERE s.status = 'active' AND s.due_at < now()
       GROUP BY r.name ORDER BY late DESC, worst_days DESC LIMIT 15`);
    return rows;
  },

  async count_documents(q, { period }) {
    const { rows: [r] } = await q(`
      SELECT
        count(*) FILTER (WHERE incoming_date = current_date)                                   AS today,
        count(*) FILTER (WHERE incoming_date >= date_trunc('week', current_date))              AS this_week,
        count(*) FILTER (WHERE incoming_date >= date_trunc('month', current_date))             AS this_month,
        count(*) FILTER (WHERE outgoing_date >= date_trunc('month', current_date))             AS out_this_month,
        count(*) FILTER (WHERE status = 'in_flow')                                             AS in_flow,
        count(*) FILTER (WHERE status = 'ready_to_close')                                      AS ready_to_close
      FROM document`);
    return [{ period, ...r }];
  },

  async room_performance(q, { roomId }) {
    const { rows: [r] } = await q(`
      SELECT count(*) FILTER (WHERE status = 'done') AS done,
             avg(extract(epoch FROM (completed_at - sent_at)) / 86400) FILTER (WHERE status = 'done') AS avg_days,
             count(*) FILTER (WHERE status = 'active' AND due_at < now()) AS late_now
        FROM routing_step WHERE to_room_id = $1 AND sent_at > now() - interval '90 days'`, [roomId]);
    return [r];
  },

  async search_archive(q, { text }) {
    const norm = kuNormalize(text);
    const { rows } = await q(`
      SELECT plot_no, title, neighbourhood, shelf, folder_no FROM archive_file
       WHERE is_active AND (search_blob LIKE '%' || $1 || '%' OR search_blob % $1)
       ORDER BY similarity(search_blob, $1) DESC LIMIT 10`, [norm]);
    return rows;
  },

  // The model is given room names as a person wrote them and needs an id. This
  // is the same resolver the rules use, exposed as a tool of its own so that the
  // model never has to guess an id and never sees the room table.
  async find_room(q, { text }) {
    const room = await resolveRoom(q, String(text ?? ''));
    return room ? [room] : [];
  },

  async staff_on_leave(q) {
    const { rows } = await q(`
      -- One line per person: overlapping approved records listed the same person
      -- seven times (records test, 13 September).
      SELECT * FROM (
        SELECT DISTINCT ON (u.id) u.full_name, r.name AS room_name, l.start_date, l.end_date, d.full_name AS deputy,
               (l.end_date - current_date) AS days_left
          FROM leave_record l JOIN app_user u ON u.id = l.user_id
          LEFT JOIN room r ON r.id = u.room_id LEFT JOIN app_user d ON d.id = r.deputy_user_id
         WHERE l.status = 'approved' AND l.start_date <= current_date AND l.end_date >= current_date
         ORDER BY u.id, l.end_date DESC) x
       ORDER BY ku_sort_key(x.room_name), ku_sort_key(x.full_name)`);
    return rows;
  },
};

// ---------------------------------------------------------------------------
// The rules. Each has a pattern over the normalised question, the tool it
// calls, how to build the arguments, and how to phrase the rows.
// ---------------------------------------------------------------------------

const fmtDate = d => d ? n(new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('/')) : '';
const daysAgo = d => { const days = Math.floor((Date.now() - new Date(d)) / 86400000); return days <= 0 ? 'ئەمڕۆ' : `${n(days)} ڕۆژ لەمەوبەر`; };

async function resolveRoom(q, text) {
  const norm = kuNormalize(text);
  const { rows } = await q(`
    SELECT id, name FROM room WHERE is_active
       AND (ku_normalize(name) LIKE '%' || $1 || '%' OR room_number = $2 OR ku_normalize(name) % $1)
     ORDER BY (ku_normalize(name) LIKE '%' || $1 || '%') DESC, similarity(ku_normalize(name), $1) DESC LIMIT 1`,
    [norm, norm.replace(/[^0-9]/g, '') || null]);
  return rows[0] ?? null;
}

// The question is normalised before it is matched, so "کێ" arrives as "کی" and
// "چاوەڕوان" as "چاوەروان". A pattern written in ordinary Kurdish would never
// match. So the Kurdish runs inside every pattern are passed through the same
// normaliser at load time. Only the Arabic-script runs: the normaliser's last
// step lower-cases Latin, which would quietly turn \S into \s and \D into \d
// and break the pattern in a way no error ever reports.
const rx = (src, flags = '') =>
  new RegExp(src.replace(/[\u0600-\u06FF]+/g, run => kuNormalize(run)), flags);

const RULES = [
  {
    // "نەخشەی پارچەی 8567/7" / "پارچەی ٢٤٧/٥": a plot, not a letter number. It was
    // read as "letter 7 of the year 8567" (records test, 13 September).
    name: 'plot',
    test: t => rx('پارچ|نەخش').test(t) && /\d+\s*\/\s*\d+/.test(t),
    tool: 'search_archive',
    args: t => { const m = /\d+\s*\/\s*\d+/.exec(t); return m ? { text: m[0].replace(/\s+/g, '') } : null; },
    say: (rows, a) => rows.length === 0
      ? `هیچ نەخشەیەک بۆ پارچەی ${a.text} لە ئەرشیفدا نییە. فایلی پارچەکە کتابەکانیشی پیشان دەدات.`
      : `${n(rows.length)} نەخشە بۆ پارچەی ${a.text}: ${rows.slice(0, 5).map(r => `${r.title} (ڕەف ${r.shelf}، دۆسیە ${r.folder_no})`).join('؛ ')}.`,
    link: (rows, a) => `/plots?p=${encodeURIComponent(a.text)}`,
  },
  {
    name: 'where_is_document',
    // "کتابی ٤٤٩٨ لای کێیە" / "کتاب ٤٤٩٨ لە کوێیە" / "٤٤٩٨ لای کێیە"
    test: t => rx('(کتاب\\S*|نامە\\S*|ژمارە\\S*)?\\s*\\S*\\d[\\d/]*\\S*\\s*(لای|لە)\\s*(کێ|کوێ|چ)').test(t) || /^\S*\d[\d/]*\S*$/.test(t),
    tool: 'find_document',
    args: t => {
      const m = /\S*\d[\d/]*\S*/.exec(t);
      const p = parseNumber(m?.[0] ?? '');
      return p ? { serial: p.serial, year: p.year ?? new Date().getFullYear(), kind: p.kind } : null;
    },
    say: (rows, a) => {
      if (rows.length === 0) return `هیچ کتابێک بە ژمارەی ${n(a.serial)} لە ساڵی ${n(a.year)} نەدۆزرایەوە.`;
      const d = rows[0];
      const no = d.incoming_no;
      if (d.status === 'closed') return `کتابی ${no} داخراوە. ژمارەی دەرچووی ${d.outgoing_no}${ye(d.outgoing_no)}. بابەت: ${d.subject}.`;
      if (d.status === 'cancelled') return `کتابی ${no} هەڵوەشێنراوەتەوە. بابەت: ${d.subject}.`;
      if (d.status === 'registered') return `کتابی ${no} تۆمارکراوە و هێشتا بۆ هیچ ژوورێک نەنێردراوە. بابەت: ${d.subject}.`;
      if (d.status === 'ready_to_close') return `کتابی ${no} کارەکەی تەواوبووە و لای ${d.room_name} چاوەڕوانی ژمارەی دەرچوونە. بابەت: ${d.subject}.`;
      return `کتابی ${no} ئێستا لای ${d.room_name}${ye(d.room_name)}${d.holder_name ? `، لای ${d.holder_name}` : ''}. ${daysAgo(d.sent_at)} نێردراوە${d.overdue ? ' و لە کاتی دیاریکراو تێپەڕیوە' : ''}. بابەت: ${d.subject}.`;
    },
    link: rows => rows[0] ? `/documents/${rows[0].id}` : null,
  },
  {
    name: 'room_queue',
    // "چی لە ژووری یاسا چاوەڕوانە" / "ژووری ١٤ چی هەیە" / "لای یاسا چی ماوە"
    test: t => rx('(چی|چ|چەند)\\s.*(چاوەڕوان|ماوە|هەیە|کراوە)').test(t) && rx('(ژوور|لای)').test(t),
    tool: 'list_room_queue',
    args: async (t, q) => {
      const m = rx('(?:ژووری|ژوور|لای)\\s+(\\S+(?:\\s+\\S+)?)').exec(t);
      const room = m ? await resolveRoom(q, m[1].replace(rx('\\s*(چی|چەند|چاوەڕوان|ماوە|هەیە).*$'), '')) : null;
      return room ? { roomId: room.id, roomName: room.name } : null;
    },
    say: (rows, a) => {
      if (rows.length === 0) return `لە ${a.roomName} هیچ کتابێک چاوەڕوان نییە.`;
      const total = Number(rows[0].total), late = Number(rows[0].late_total);
      const list = rows.slice(0, 5).map(r => `${r.incoming_no} (${r.subject.slice(0, 40)}${r.subject.length > 40 ? '…' : ''})`).join('؛ ');
      return `لە ${a.roomName} ${n(total)} کتاب چاوەڕوانە${late ? `، ${n(late)}یان دواکەوتوون` : ''}. کۆنترینەکان: ${list}${total > 5 ? ' و هی تر.' : '.'}`;
    },
    link: (rows, a) => `/inbox?room=${a.roomId}`,
  },
  {
    name: 'overdue',
    // "کام ژوور دواکەوتووە" / "چی دواکەوتووە" / "دواکەوتووەکان"
    test: t => rx('دواکەوت').test(t),
    tool: 'find_overdue',
    args: () => ({}),
    say: rows => {
      if (rows.length === 0) return 'هیچ کتابێک لە کاتی دیاریکراو تێنەپەڕیوە. هەموو ژوورەکان لە کاتدان.';
      const list = rows.map(r => `${r.room_name} (${n(r.late)} کتاب، کۆنترینیان ${n(r.worst_days)} ڕۆژ)`).join('؛ ');
      return `${n(rows.length)} ژوور کتابی دواکەوتوویان هەیە: ${list}.`;
    },
    link: () => '/dashboard',
  },
  {
    name: 'on_leave',
    // "کێ لە مۆڵەتە" / "کێ لە مۆڵەتدایە" / "مۆڵەتەکان"
    // Staff leave, not a company's licence (also مۆڵەت): «مۆڵەتی کۆمپانیای ئاسۆ
    // کەی بەسەردەچێت» got the list of staff on leave (records test).
    test: t => rx('مۆڵەت|مولت').test(t) && !rx('کۆمپانیا|بەسەرد|بیناساز|پارچ').test(t),
    tool: 'staff_on_leave',
    args: () => ({}),
    say: rows => {
      if (rows.length === 0) return 'ئەمڕۆ کەس لە مۆڵەتدا نییە.';
      const list = rows.map(r => `${r.full_name} (${r.room_name ?? '—'}${r.deputy ? `، جێگر: ${r.deputy}` : '، بێ جێگر'}، تا ${fmtDate(r.end_date)})`).join('؛ ');
      return `${n(rows.length)} کەس ئەمڕۆ لە مۆڵەتدان: ${list}.`;
    },
    link: () => '/leave',
  },
  {
    name: 'counts',
    // "چەند کتاب هاتووە ئەمڕۆ" / "ئەم مانگە چەند دەرچووە"
    test: t => rx('چەند').test(t) && rx('(کتاب|نامە|هاتوو|دەرچوو)').test(t),
    tool: 'count_documents',
    args: t => ({ period: rx('مانگ').test(t) ? 'month' : rx('هەفتە').test(t) ? 'week' : 'today' }),
    say: ([r], a) => {
      if (a.period === 'month') return `ئەم مانگە ${n(r.this_month)} کتاب هاتووە و ${n(r.out_this_month)} دەرچووە. ئێستا ${n(r.in_flow)} لە گەڕاندان و ${n(r.ready_to_close)} ئامادەی داخستنن.`;
      if (a.period === 'week') return `ئەم هەفتەیە ${n(r.this_week)} کتاب هاتووە. ئێستا ${n(r.in_flow)} لە گەڕاندان.`;
      return `ئەمڕۆ ${n(r.today)} کتاب هاتووە. ئێستا ${n(r.in_flow)} لە گەڕاندان و ${n(r.ready_to_close)} ئامادەی داخستنن.`;
    },
    link: () => '/dashboard',
  },
];

// ---------------------------------------------------------------------------
// answer(): the one entry point.
// ---------------------------------------------------------------------------

/**
 * @returns {{ text: string, link: string|null, backend: 'rules'|'none', tool: string|null, rows: number }}
 */
export async function answer({ question, user, conversationId = null, req = null }) {
  const raw = String(question ?? '').trim().slice(0, 500);
  const norm = kuNormalize(raw);
  const started = Date.now();

  return withReadonly(user, async q => {
    // Conversation bookkeeping, on the read-only role's INSERT grants.
    let convId = conversationId;
    if (!convId) {
      const { rows: [c] } = await q(`INSERT INTO assistant_conversation (user_id, backend) VALUES ($1, 'rules') RETURNING id`, [user.id]);
      convId = c.id;
    }
    await q(`INSERT INTO assistant_message (conversation_id, role, content) VALUES ($1, 'user', $2)`, [convId, raw]);
    await q(`INSERT INTO activity_log (user_id, room_id, action, detail) VALUES ($1, $2, 'assistant.question', $3)`,
            [user.id, user.roomId, JSON.stringify({ conversation: convId, chars: raw.length })]);

    let result = { text: null, link: null, backend: 'none', tool: null, rows: 0 };

    for (const rule of RULES) {
      if (!norm || !rule.test(norm)) continue;
      const args = await rule.args(norm, q);
      if (!args) continue;
      const rows = await TOOLS[rule.tool](q, args);
      await q(`INSERT INTO assistant_message (conversation_id, role, tool_name, tool_args, tool_row_count, content)
               VALUES ($1, 'tool', $2, $3, $4, '')`, [convId, rule.tool, JSON.stringify(args), rows.length]);
      await q(`INSERT INTO activity_log (user_id, action, detail) VALUES ($1, 'assistant.tool_call', $2)`,
              [user.id, JSON.stringify({ tool: rule.tool, row_count: rows.length, rule: rule.name })]);
      result = { text: rule.say(rows, args), link: rule.link(rows, args), backend: 'rules', tool: rule.tool, rows: rows.length };
      break;
    }

    // The model layer, for everything the rules did not catch. Off unless the
    // setting says otherwise, so the building can go back to fully offline by
    // changing one row and without a deploy.
    if (!result.text && raw) {
      const { rows: [cfg] } = await q(
        `SELECT coalesce((SELECT value #>> '{}' FROM system_setting WHERE key = 'assistant_backend'), 'rules') AS backend`);
      if (cfg.backend === 'model' && modelConfigured()) {
        const modelResult = await askModel({
          question: raw,
          // The tool runs on this same read-only connection, as this same user.
          // Row-level security decides what comes back, not the prompt.
          runTool: async (name, args) => {
            if (!Object.hasOwn(TOOLS, name)) throw new Error(`unknown tool ${name}`);
            const rows = await TOOLS[name](q, args ?? {});
            await q(`INSERT INTO assistant_message (conversation_id, role, tool_name, tool_args, tool_row_count, content)
                     VALUES ($1, 'tool', $2, $3, $4, '')`, [convId, name, JSON.stringify(args ?? {}), rows.length]);
            await q(`INSERT INTO activity_log (user_id, action, detail) VALUES ($1, 'assistant.tool_call', $2)`,
                    [user.id, JSON.stringify({ tool: name, row_count: rows.length, via: 'model' })]);
            return rows;
          },
        });
        if (modelResult) {
          result = {
            text: modelResult.text,
            // Only offer a link when exactly one letter was looked up; anything
            // else and a link would point somewhere the answer did not mention.
            link: linkForCalls(modelResult.calls),
            backend: 'model',
            tool: modelResult.calls.map(c => c.name).join(',') || null,
            rows: modelResult.calls.reduce((sum, c) => sum + c.rows, 0),
          };
          await q(`UPDATE assistant_conversation SET backend = 'model' WHERE id = $1`, [convId]);
        } else {
          await q(`INSERT INTO activity_log (user_id, action, detail) VALUES ($1, 'assistant.fallback', $2)`,
                  [user.id, JSON.stringify({ reason: 'model_unavailable_or_empty', model: MODEL })]);
        }
      }
    }

    if (!result.text) {
      // Honest about not understanding. No guessing, no made-up answer.
      result.text = 'ئەم پرسیارە تێنەگەیشتم. دەتوانم وەڵامی ئەمانە بدەمەوە: کتابێک لای کێیە، چی لە ژوورێک چاوەڕوانە، کام ژوور دواکەوتووە، کێ لە مۆڵەتە، و چەند کتاب هاتووە. یان لە پەڕەی گەڕان بگەڕێ.';
      result.link = raw ? `/documents?q=${encodeURIComponent(raw)}` : '/documents';
      await q(`INSERT INTO activity_log (user_id, action, detail) VALUES ($1, 'assistant.fallback', $2)`,
              [user.id, JSON.stringify({ reason: 'no_rule_matched' })]);
    }

    await q(`INSERT INTO assistant_message (conversation_id, role, content, latency_ms) VALUES ($1, 'assistant', $2, $3)`,
            [convId, result.text, Date.now() - started]);
    await q(`UPDATE assistant_conversation SET last_message_at = now() WHERE id = $1`, [convId]);
    await q(`INSERT INTO activity_log (user_id, action, detail) VALUES ($1, 'assistant.answer', $2)`,
            [user.id, JSON.stringify({ backend: result.backend, tool: result.tool, row_count: result.rows, ms: Date.now() - started })]);

    return { ...result, conversationId: convId };
  });
}

export { RULES };
