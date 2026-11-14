// Shared steps for the audit journeys.

import { mkdirSync, appendFileSync } from 'fs';
import { test } from '@playwright/test';
import { join } from 'path';
import zlib from 'zlib';
import { signIn, inkPdf, mark, PASSWORD } from '../tests/helpers.mjs';

export { inkPdf, mark, PASSWORD, signIn };

const SHOTS = join(process.cwd(), 'audit-output', 'journeys');
mkdirSync(SHOTS, { recursive: true });

/**
 * A person at their own computer: a fresh browser context, signed in.
 * Collects the page's console errors and failed requests on the side, so a
 * journey can say at the end whether anything went wrong that nobody saw.
 */
export async function as(browser, username, { viewport = { width: 1366, height: 768 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(`pageerror on ${page.url()}: ${e}`));
  // A 400 is the server refusing a form the journey filled in wrongly on purpose,
  // which is the answer being tested, not a problem with the page.
  page.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text())) page.problems.push(`console on ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) page.problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on('dialog', d => d.accept());
  await signIn(page, username);
  return { context, page };
}

/**
 * Write down something wrong and carry on.
 *
 * A soft expect would do the same for one test, but a failed test in a serial
 * journey skips every test after it, and the point of the audit is to reach the
 * end and see everything. findings.jsonl is what summarise.mjs reads.
 */
const FINDINGS = join(process.cwd(), 'audit-output', 'findings.jsonl');
let shotNo = 0;
export async function ok(cond, message, { page = null, severity = 'bug', detail = null } = {}) {
  if (cond) return true;
  let file = null;
  if (page) {
    file = `finding-${Date.now()}-${++shotNo}.png`;
    await page.screenshot({ path: join(SHOTS, file), fullPage: true }).catch(() => { file = null; });
  }
  const t = test.info();
  appendFileSync(FINDINGS, JSON.stringify({
    at: new Date().toISOString(), file: t.file.split(/[\\/]/).pop(), test: t.title,
    severity, message, detail, url: page ? page.url() : null, screenshot: file,
  }) + '\n');
  console.log(`  FINDING [${severity}] ${t.title}: ${message}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}

/** Whether a locator becomes visible within a few seconds. */
export const visible = (locator, timeout = 5000) =>
  locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);

/** At the end of a journey step: anything that went wrong in the page itself. */
export async function noProblems(page, where) {
  if (page.problems.length) await ok(false, `errors in the page during: ${where}`, { detail: page.problems.slice(0, 6) });
  page.problems.length = 0;
}

export const shot = (page, name) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }).catch(() => {});

/** The notice at the top of the page, or null. */
export const noticeText = async page => {
  const n = page.locator('.content > .notice').first();
  return (await n.count()) ? (await n.textContent()).trim() : null;
};

/** Pick the first real option of a select (skipping the "choose" placeholder). */
export async function pickFirst(page, selector) {
  const value = await page.locator(`${selector} option`).evaluateAll(os =>
    os.map(o => o.value).find(v => v !== ''));
  await page.selectOption(selector, value);
  return value;
}

/** Choose an option by the text it shows. */
export async function pickByText(page, selector, text) {
  const value = await page.locator(`${selector} option`).evaluateAll((os, t) =>
    os.find(o => o.textContent.includes(t))?.value, text);
  if (value == null) throw new Error(`no option containing «${text}» in ${selector}`);
  await page.selectOption(selector, value);
  return value;
}

export const docIdFrom = url => Number(/\/documents\/(\d+)/.exec(url)?.[1]);

/** A real PNG, grey with a dark square in it, for photo and tray uploads. */
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
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1, 0xE0); row[0] = 0;
    if (y > size / 4 && y < size * 3 / 4) for (let x = size / 4; x < size * 3 / 4; x++) row[1 + x] = 0x10;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    // Different bytes every call: the server refuses the same file twice.
    chunk('tEXt', Buffer.from(`Comment\0${Math.random()}`, 'latin1')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A file that claims to be a DWG drawing. Only the header matters to the server. */
export const dwgBytes = () => Buffer.concat([Buffer.from('AC1032'), Buffer.from(String(Math.random())), Buffer.alloc(2048, 7)]);
