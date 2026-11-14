// Shared helpers for the "letters" tester. Plain node scripts driving real Chrome.
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

export const MARK = 'LTR' + Math.random().toString(36).slice(2, 7);

export async function browser({ headless = true } = {}) {
  return chromium.launch({ channel: 'chrome', headless });
}

const LOG = join(HERE, 'observations.log');
export function note(...args) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

/** A fresh context signed in as username; collects page errors. */
export async function as(b, username, { viewport = { width: 1400, height: 900 } } = {}) {
  const context = await b.newContext({ viewport, baseURL: BASE, locale: 'ckb' });
  const page = await context.newPage();
  page.problems = [];
  page.who = username;
  page.on('pageerror', e => page.problems.push(`pageerror on ${page.url()}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') page.problems.push(`console on ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) page.problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on('dialog', d => d.accept());
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(u => !['/login', '/'].includes(new URL(u).pathname), { timeout: 20000 }),
    page.click('button[type=submit]'),
  ]);
  return { context, page };
}

export function problems(page, where) {
  if (page.problems.length) {
    note(`PROBLEMS (${page.who}) during ${where}:`, page.problems.slice(0, 8));
    page.problems.length = 0;
  }
}

export async function shot(page, name, opts = {}) {
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: opts.fullPage ?? false, ...(opts.clip ? { clip: opts.clip } : {}) }).catch(e => note('shot failed', e.message));
  return path;
}

export async function locShot(locator, name) {
  const path = join(SHOTS, `${name}.png`);
  await locator.screenshot({ path }).catch(e => note('locshot failed', e.message));
  return path;
}

export const noticeText = async page => {
  const n = page.locator('.content > .notice');
  return (await n.count()) ? (await n.allTextContents()).map(s => s.trim().replace(/\s+/g, ' ')).join(' | ') : null;
};

export const docId = url => Number(/\/documents\/(\d+)/.exec(url)?.[1]);

/** Register via the real form. Returns {id, no}. Handles the similar panel by pressing register again. */
export async function register(page, { subject, sender, plot = '', kind = null, priority = null, confirmSimilar = true } = {}) {
  await page.goto('/registry/new');
  await page.fill('#subject', subject);
  await page.fill('#sender_name', sender);
  if (plot) await page.fill('#plot_no', plot);
  if (kind) await page.selectOption('#sender_kind', kind);
  if (priority) await page.selectOption('#priority', priority);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[data-similar-form] > .row button[type=submit]')]);
  await page.waitForLoadState('domcontentloaded');
  if (!/\/documents\/\d+/.test(page.url()) && confirmSimilar && await page.locator('input[name="confirm_similar"]').count()) {
    await Promise.all([page.waitForURL(/\/documents\/\d+/), page.click('form[data-similar-form] > .row button[type=submit]')]);
  }
  await page.waitForURL(/\/documents\/\d+/, { timeout: 15000 });
  const id = docId(page.url());
  const no = (await page.locator('table tr:has(th:text("ژمارەی هاتوو")) td').first().textContent()).trim();
  return { id, no };
}

/** Choose a room option by visible text in a select. */
export async function pickRoom(page, selector, text) {
  const value = await page.locator(`${selector} option`).evaluateAll((os, t) =>
    os.find(o => o.textContent.trim().startsWith(t) || o.textContent.includes(t))?.value, text);
  if (value == null) throw new Error(`no option «${text}» in ${selector}`);
  await page.selectOption(selector, value);
  return value;
}

export async function sendSingle(page, id, roomText, { note: n = '', returnToMe = false } = {}) {
  await page.goto(`/documents/${id}`);
  await pickRoom(page, '#to_room', roomText);
  if (n) await page.fill('#note', n);
  if (returnToMe) await page.check('form:has(input[name=mode][value=single]) input[name=return_to_assigner]');
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form:has(input[name=mode][value=single]) button[type=submit]')]);
  await page.waitForLoadState('domcontentloaded');
  return noticeText(page);
}

export async function sendSequence(page, id, roomTexts, { returnToMe = true } = {}) {
  await page.goto(`/documents/${id}`);
  const selects = page.locator('select[name=seq_room]');
  for (let i = 0; i < roomTexts.length; i++) {
    const value = await selects.nth(i).locator('option').evaluateAll((os, t) =>
      os.find(o => o.textContent.includes(t))?.value, roomTexts[i]);
    if (value == null) throw new Error(`no seq option ${roomTexts[i]}`);
    await selects.nth(i).selectOption(value);
  }
  const box = page.locator('form:has(input[name=mode][value=sequence]) input[name=return_to_assigner]');
  if (returnToMe) await box.check(); else await box.uncheck();
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form:has(input[name=mode][value=sequence]) button[type=submit]')]);
  await page.waitForLoadState('domcontentloaded');
  return noticeText(page);
}

export async function completeStep(page, id, action, replyNote = '') {
  await page.goto(`/documents/${id}`);
  if (!(await page.locator('form[action$="/complete"]').count())) return 'NO COMPLETE FORM';
  await page.selectOption('#action', action);
  if (replyNote) await page.fill('#reply_note', replyNote);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('form[action$="/complete"] button[type=submit]')]);
  await page.waitForLoadState('domcontentloaded');
  return noticeText(page);
}

/** Text of trail items on the letter page. */
export async function trailText(page) {
  return (await page.locator('ol.trail > li').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
}

export async function inboxHas(page, subjectPart, roomQuery = '') {
  await page.goto('/inbox' + roomQuery);
  const rows = page.locator('.card table tbody tr', { hasText: subjectPart });
  return rows.count();
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

import zlib from 'zlib';
/** A real PNG, grey with a dark square in it (copied from audit/lib.mjs). */
export function inkPng(size = 200) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0;
  const rows = [];
  const seed = Math.floor(Math.random() * 200);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1, 0xE0); row[0] = 0;
    if (y > size / 4 && y < size * 3 / 4) for (let x = size / 4; x < size * 3 / 4; x++) row[1 + x] = 0x10;
    row[1 + (y % size)] = seed; // make every PNG unique
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const ROOM = { desk: '1', mayor: '2', arch8: '3', arch9: '4', contracts: '5', legal: '6', land: '7', accounts: '8', admin: '9' };

export async function sendTo(page, id, roomId, { note: n = '', returnToMe = false } = {}) {
  if (!/\/documents\/\d+$/.test(new URL(page.url()).pathname) || docId(page.url()) !== id) await page.goto(`/documents/${id}`);
  if (!(await page.locator('#to_room').count())) return 'NO SEND FORM';
  await page.selectOption('#to_room', roomId);
  if (n) await page.fill('#note', n);
  if (returnToMe) await page.check('form:has(input[name=mode][value=single]) input[name=return_to_assigner]');
  const resp = page.waitForResponse(r => r.url().endsWith(`/documents/${id}/route`));
  await page.click('form:has(input[name=mode][value=single]) button[type=submit]');
  const r = await resp;
  await page.waitForLoadState('domcontentloaded');
  return r.status() >= 500 ? `HTTP ${r.status()} ${await page.locator('h1').first().textContent()}` : noticeText(page);
}

export async function seqTo(page, id, roomIds, { returnToMe = true } = {}) {
  await page.goto(`/documents/${id}`);
  if (!(await page.locator('select[name=seq_room]').count())) return 'NO SEND FORM';
  const selects = page.locator('select[name=seq_room]');
  for (let i = 0; i < roomIds.length; i++) await selects.nth(i).selectOption(roomIds[i]);
  const box = page.locator('form:has(input[name=mode][value=sequence]) input[name=return_to_assigner]');
  if (returnToMe) await box.check(); else await box.uncheck();
  const resp = page.waitForResponse(r => r.url().endsWith(`/documents/${id}/route`));
  await page.click('form:has(input[name=mode][value=sequence]) button[type=submit]');
  const r = await resp;
  await page.waitForLoadState('domcontentloaded');
  return r.status() >= 500 ? `HTTP ${r.status()} ${await page.locator('h1').first().textContent()}` : noticeText(page);
}

/** Press a submit button on the current page and report status + notice. */
export async function press(page, selector) {
  const resp = page.waitForResponse(r => r.request().method() === 'POST', { timeout: 20000 });
  await page.click(selector);
  const r = await resp;
  await page.waitForLoadState('domcontentloaded');
  if (r.status() >= 500) return `HTTP ${r.status()} ${(await page.locator('h1').first().textContent()).trim()}`;
  return (await noticeText(page)) ?? `(no notice) ${page.url()}`;
}

export async function myDay(page) {
  await page.goto('/my-day');
  const tiles = await page.locator('.stats .stat').evaluateAll(ss => ss.map(s => s.innerText.replace(/\s+/g, ' ')));
  return tiles;
}

export async function bell(page) {
  await page.goto('/notifications');
  return (await page.locator('ul.notif-list > li').allTextContents()).slice(0, 6).map(s => s.replace(/\s+/g, ' ').trim());
}
