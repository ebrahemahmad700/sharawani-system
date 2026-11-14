// The assistant's model layer.
//
// The rules layer in assistant.mjs runs first and answers the five commonest
// questions for nothing, offline, in a few milliseconds. This file handles what
// the rules do not catch, and only that.
//
// What the model can and cannot see, which is the whole point of the design:
//
//   - It never receives the database. It receives a question and a list of named
//     functions it may call.
//   - Every function runs on the read-only role, inside withReadonly(user), so
//     row-level security decides what comes back. Permission filtering lives in
//     the query, never in the prompt. A model that is talked into asking for
//     something still gets only rows this user may see.
//   - It cannot write. The role has no UPDATE and no DELETE, and the tool list
//     has no write function in it.
//   - What does leave the building is the question and the rows a tool returned.
//     That is a real disclosure to Groq and it is why assistant_backend is a
//     setting: put it back to 'rules' and nothing leaves at all.
//
// Model choice was measured, not assumed. On Kurdish Sorani with proper nouns:
//   qwen/qwen3.8-27b     keeps room and person names byte-for-byte, calls tools
//                        with correct arguments.            <- chosen
//   openai/gpt-oss-120b  drops person names from its answer, omits arguments.
//   groq/compound        good Kurdish, cannot call tools at all.

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.ASSISTANT_MODEL || 'qwen/qwen3.8-27b';
const MAX_STEPS = 4;             // tool call, result, tool call, answer
// Generous, because most of it is spent waiting out a rate limit rather than
// waiting on the model. A question that takes eight seconds and answers is worth
// more to the mayor than one that gives up in two.
const TIMEOUT_MS = Number(process.env.ASSISTANT_TIMEOUT_MS || 45_000);

export const modelConfigured = () => Boolean(process.env.GROQ_API_KEY);

// The schemas the model sees. Deliberately a smaller surface than TOOLS: every
// argument is a scalar the query binds as a parameter, so nothing the model
// produces can become SQL.
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'find_document',
      description: 'Find a letter by its number and report where it is now, who holds it, and whether it is late. Use this whenever the question mentions a number.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'integer', description: 'The number after the last slash. From ه/2026/25 this is 25.' },
          year: { type: 'integer', description: 'Four-digit year. Omit for the current year.' },
          kind: { type: 'string', enum: ['incoming', 'outgoing'], description: 'ه means incoming, د means outgoing. Omit if unknown.' },
        },
        required: ['serial'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_room',
      description: 'Resolve a room name or room number written by a person into a room id. Call this before list_room_queue or room_performance.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The room name or number as the person wrote it.' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_room_queue',
      description: 'List the letters currently waiting in one room, oldest and latest first.',
      parameters: {
        type: 'object',
        properties: { roomId: { type: 'integer', description: 'From find_room.' } },
        required: ['roomId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'document_trail',
      description: 'The full history of one letter: every room it passed through, who held it, what they did and when.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'integer', description: 'The id from find_document.' } },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_overdue',
      description: 'Which rooms are holding letters past their due date, how many each, and how late the worst one is.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'count_documents',
      description: 'Counts of letters: today, this week, this month, outgoing this month, how many are in flow and how many are ready to close.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: ['today', 'week', 'month'] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'room_performance',
      description: 'How one room has performed over the last ninety days: how many letters completed, average days taken, how many are late right now.',
      parameters: {
        type: 'object',
        properties: { roomId: { type: 'integer', description: 'From find_room.' } },
        required: ['roomId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_archive',
      description: 'Search the drawing archive by plot number, owner name, neighbourhood or title.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'staff_on_leave',
      description: 'Who is on approved leave today, until when, and who is deputising for them.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// English instructions, Kurdish output. Models follow instructions written in
// English considerably better, and the requirement is about what it produces.
// The vocabulary list is not decoration: left to itself the model calls a letter
// "پەیام" or "پەڕگە", and in this building a letter is a کتاب.
const SYSTEM = `You are the assistant inside the document system of Rania Municipality (شارەوانی ڕانیە), used by the mayor and the deputy mayor.

HOW YOU WORK
- Answer only from what the tools return. You have no other knowledge of this municipality.
- Always call a tool before answering a question about letters, rooms, staff or the archive. Never answer such a question from memory.
- If a tool returns nothing, say plainly that nothing was found. Never invent a letter, a room, a person, a number or a date.
- You may call several tools in turn. To ask about a room, call find_room first to get its id.
- If the question is not about this system at all, say you cannot answer it and suggest the search page. Do not chat.

HOW YOU WRITE
- Reply in Kurdish Sorani only. Never in English, Arabic or Persian.
- Two or three sentences at most. The mayor is busy.
- Copy every name, room name and document number exactly as the tool returned it, character for character. Never transliterate or translate a name.
- Use Arabic-Indic digits: ٠١٢٣٤٥٦٧٨٩.

VOCABULARY, use these exact words
- a letter is کتاب (not پەیام, not نامە, not پەڕگە)
- a room is ژوور
- incoming is هاتوو, outgoing is دەرچوو
- late or past due is دواکەوتوو
- leave is مۆڵەت, a deputy is جێگر
- a plot is پارچە, a neighbourhood is گەڕەک (not قەزاگە)
- the drawing archive is ئەرشیفی نەخشە, a shelf is ڕەف, a folder is دۆسیە`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One request, retrying when the account's rate limit is hit.
 *
 * The free Groq tier allows 7000 input tokens a minute, and one call here costs
 * roughly 1400 of them: the system prompt plus nine tool schemas, sent again on
 * every step of the loop. Two people asking at once will hit it. Groq's refusal
 * says exactly how long to wait, so the honest thing is to wait that long rather
 * than fail the question. It also means an answer can take a few seconds longer
 * than usual, which is preferable to "I did not understand".
 */
async function callWithRetry(key, messages, deadline) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) return null;

    let json;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOL_SCHEMAS,
          temperature: 0.1,        // this is a lookup, not a conversation
          max_tokens: 700,
        }),
        signal: AbortSignal.timeout(left),
      });
      json = await res.json();
    } catch (err) {
      console.error('[assistant] model unreachable:', err.message);
      return null;
    }

    if (!json.error) return json.choices?.[0] ?? null;

    // "Please try again in 1.448571428s"
    const wait = /try again in ([\d.]+)s/i.exec(json.error.message)?.[1];
    const isRateLimit = json.error.code === 'rate_limit_exceeded' || /rate limit/i.test(json.error.message);
    if (!isRateLimit || !wait) {
      console.error('[assistant] model error:', json.error.message);
      return null;
    }

    const ms = Math.ceil(Number(wait) * 1000) + 250;
    if (Date.now() + ms > deadline) {
      console.error(`[assistant] rate limited, ${wait}s wait exceeds the time budget`);
      return null;
    }
    console.log(`[assistant] rate limited, waiting ${wait}s`);
    await sleep(ms);
  }
  return null;
}

/**
 * Ask the model, letting it call the tools until it has an answer.
 *
 * @param {object} o
 * @param {string} o.question        what the person typed
 * @param {(name: string, args: object) => Promise<any[]>} o.runTool
 *        Runs one tool on the read-only connection and returns its rows. The
 *        caller owns this so that permission filtering stays in the query.
 * @returns {Promise<{text: string, calls: {name: string, args: object, rows: number}[]}|null>}
 *          null when the model is unavailable or produced nothing usable, so the
 *          caller can fall back to the honest "I did not understand".
 */
export async function askModel({ question, runTool }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: String(question).slice(0, 500) },
  ];
  const calls = [];
  const deadline = Date.now() + TIMEOUT_MS;

  for (let step = 0; step < MAX_STEPS; step++) {
    const left = deadline - Date.now();
    if (left <= 0) break;

    const choice = await callWithRetry(key, messages, deadline);
    if (!choice) return null;

    const msg = choice.message ?? {};
    const toolCalls = msg.tool_calls ?? [];

    if (!toolCalls.length) {
      const text = String(msg.content ?? '').trim();
      return text ? { text, calls } : null;
    }

    // The assistant turn that asked for the tools has to go back verbatim, or the
    // next request is missing the call the tool results answer.
    messages.push(msg);

    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* the model sent malformed JSON */ }
      let rows = [];
      let failed = null;
      try {
        rows = await runTool(tc.function.name, args);
      } catch (err) {
        failed = err.message;
        console.error(`[assistant] tool ${tc.function.name} failed:`, err.message);
      }
      calls.push({ name: tc.function.name, args, rows: rows.length });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        // A row cap, because a room queue of two hundred letters would be most of
        // the context and none of it useful.
        content: failed
          ? JSON.stringify({ error: 'this tool could not run' })
          : JSON.stringify(rows.slice(0, 25)),
      });
    }
  }

  return null;
}

export { MODEL };
