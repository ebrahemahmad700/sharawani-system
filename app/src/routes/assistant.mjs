// The assistant panel: ask a question, see the answer and the conversation.
//
// Every answer comes from lib/assistant.mjs on the read-only role. This file
// only renders. The page shows the last exchanges of the current conversation
// so a follow-up reads in context, and every answer carries a link to the
// screen that shows the same thing in full.

import { Router } from 'express';
import { withReadonly } from '../lib/db.mjs';
import { requireAuth, requireRole } from '../lib/auth.mjs';
import { answer } from '../lib/assistant.mjs';
import { page } from '../views/layout.mjs';
import { html, time } from '../lib/html.mjs';

const router = Router();
// The mayor and the deputy mayor, and nobody else. The assistant can reach
// across every room in the building, and it is the one feature that sends a
// question outside the building when the model backend is on.
const ASKERS = ['mayor', 'deputy_mayor'];

async function history(user, conversationId) {
  if (!conversationId) return [];
  return withReadonly(user, async q => {
    const { rows } = await q(`
      SELECT m.role, m.content, m.created_at FROM assistant_message m
        JOIN assistant_conversation c ON c.id = m.conversation_id
       WHERE m.conversation_id = $1 AND c.user_id = $2 AND m.role IN ('user', 'assistant')
       ORDER BY m.id DESC LIMIT 20`, [conversationId, user.id]);
    return rows.reverse();
  });
}

function render({ user, csrf, messages, conversationId, latest }) {
  return page({
    user, title: 'یاریدەدەر', current: '/assistant',
    body: html`
      <div class="card form">
        <p class="card-sub">
          وەڵامەکان ڕاستەوخۆ لە بنکەی زانیارییەکەوە دێن، نەک لە زانیاری خۆی. ئێستا ئەم پرسیارانە تێدەگات:
          کتابێک لای کێیە · چی لە ژوورێک چاوەڕوانە · کام ژوور دواکەوتووە · کێ لە مۆڵەتە · چەند کتاب هاتووە.
        </p>
        ${messages.length ? html`<div style="margin-bottom:16px">${messages.map(m => html`
          <div style="display:flex;gap:10px;margin-bottom:10px;${m.role === 'user' ? '' : 'flex-direction:row-reverse'}">
            <div style="max-width:78%;padding:10px 14px;border-radius:12px;${m.role === 'user' ? 'background:#EFEDE5' : 'background:var(--ok-bg)'}">
              ${m.content}
              <span class="cell-sub">${time(m.created_at)}</span>
            </div>
          </div>`)}</div>` : ''}
        ${latest?.link ? html`<p><a class="btn secondary" href="${latest.link}">بینینی تەواو</a></p>` : ''}
        <form method="post" action="/assistant/ask" class="row">
          <input type="hidden" name="_csrf" value="${csrf}">
          ${conversationId ? html`<input type="hidden" name="conversation" value="${conversationId}">` : ''}
          <input type="text" name="q" aria-label="پرسیار" maxlength="500" required autofocus autocomplete="off" placeholder="پرسیارەکەت لێرە بنووسە">
          <button class="btn gold" type="submit">بپرسە</button>
        </form>
      </div>`,
  });
}

router.get('/assistant', requireAuth, requireRole(...ASKERS), async (req, res, next) => {
  try {
    const conversationId = req.query.c || null;
    const messages = await history(req.user, conversationId);
    res.send(render({ user: req.user, csrf: res.locals.csrf, messages, conversationId, latest: null }));
  } catch (err) { next(err); }
});

router.post('/assistant/ask', requireAuth, requireRole(...ASKERS), async (req, res, next) => {
  try {
    const conversationId = req.body.conversation || null;
    const latest = await answer({ question: req.body.q, user: req.user, conversationId, req });
    const messages = await history(req.user, latest.conversationId);
    res.send(render({ user: req.user, csrf: res.locals.csrf, messages, conversationId: latest.conversationId, latest }));
  } catch (err) { next(err); }
});

export default router;
