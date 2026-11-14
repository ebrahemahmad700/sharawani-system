// Helpers for the "records" tester. Registers, admin screens, tools.
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const MARK = process.env.MARK || ('rec' + Date.now().toString(36).slice(-5));

let browser;
export async function launch() {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  return browser;
}
export async function close() { await browser?.close(); }

/** A fresh context signed in as username. */
export async function as(username, { viewport = { width: 1400, height: 900 }, password = PASSWORD } = {}) {
  const context = await browser.newContext({ viewport, baseURL: BASE, locale: 'ckb' });
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(`pageerror ${page.url()}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') page.problems.push(`console ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) page.problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on('dialog', d => d.accept());
  if (username) await signIn(page, username, password);
  return { context, page };
}

export async function signIn(page, username, password = PASSWORD) {
  await page.goto('/login');
  if (await page.locator('form[action="/login/switch"]').count()) {
    await page.locator('form[action="/login/switch"] button').click();
    await page.waitForURL(/\/login/);
  }
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/login' && r.request().method() === 'POST', { timeout: 30000 }),
    page.click('button[type=submit]'),
  ]);
  await page.waitForLoadState('domcontentloaded');
}

const LOG = join(HERE, 'log.jsonl');
export function note(area, what, data = {}) {
  const line = { at: new Date().toISOString(), area, what, ...data };
  appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(`[${area}] ${what}${Object.keys(data).length ? ' ' + JSON.stringify(data).slice(0, 600) : ''}`);
}

export async function shot(page, name, opts = {}) {
  const path = join(SHOTS, `${name}.png`);
  if (opts.locator) await opts.locator.screenshot({ path }).catch(e => console.log('shot fail', e.message));
  else await page.screenshot({ path, fullPage: opts.fullPage ?? false, clip: opts.clip }).catch(e => console.log('shot fail', e.message));
  return path;
}

/** The notice shown at the top of the content, if any. */
export async function notice(page) {
  const n = page.locator('.notice');
  const out = [];
  for (let i = 0; i < await n.count(); i++) out.push((await n.nth(i).innerText()).trim().replace(/\s+/g, ' '));
  return out;
}

/** The validation message Chrome would show for the first invalid field, or null. */
export async function invalidField(page, formSel = 'form') {
  return page.evaluate(sel => {
    for (const f of document.querySelectorAll(sel)) {
      const bad = f.querySelector(':invalid');
      if (bad && bad.tagName !== 'FORM' && bad.tagName !== 'FIELDSET') return { name: bad.name || bad.id, msg: bad.validationMessage };
    }
    return null;
  }, formSel);
}

export const text = async (page, sel) => (await page.locator(sel).first().innerText()).trim().replace(/\s+/g, ' ');

export const KU = '٠١٢٣٤٥٦٧٨٩';
export const toKu = s => String(s).replace(/[0-9]/g, d => KU[d]);
export const fromKu = s => String(s).replace(/[٠-٩]/g, d => KU.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** Build a small PDF with text drawn on it. */
export async function textPdf(lines = ['test'], pages = 1) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const pg = doc.addPage([595, 842]);
    let y = 780;
    for (const l of lines) { pg.drawText(String(l), { x: 60, y, size: 28, font }); y -= 50; }
    pg.drawRectangle({ x: 60, y: 100, width: 200, height: 60 });
  }
  return Buffer.from(await doc.save());
}

export { inkPdf } from '../../tests/helpers.mjs';
export { inkPng, dwgBytes } from '../../audit/lib.mjs';

export function dxfBytes() {
  return Buffer.from('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n10.0\n0\nENDSEC\n0\nEOF\n');
}

/** A tiny little-endian baseline TIFF, 8x8 grey. */
export function tifBytes() {
  const w = 8, h = 8;
  const pixels = Buffer.alloc(w * h, 0x80);
  const entries = [
    [256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 1],
    [273, 4, 1, 0 /* patched */], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h],
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = ifdOffset + ifdSize;
  const buf = Buffer.alloc(dataOffset + pixels.length);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdOffset, 4);
  buf.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, count, value], i) => {
    const o = ifdOffset + 2 + i * 12;
    buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(count, o + 4);
    if (tag === 273) value = dataOffset;
    if (type === 3) buf.writeUInt16LE(value, o + 8); else buf.writeUInt32LE(value, o + 8);
  });
  buf.writeUInt32LE(0, ifdOffset + 2 + entries.length * 12);
  pixels.copy(buf, dataOffset);
  return buf;
}

export function saveJson(name, data) { writeFileSync(join(HERE, name), JSON.stringify(data, null, 2)); }

/** Register a letter through the form. Returns { id, no, barcode }. */
export async function registerLetter(page, subject, extra = {}) {
  await page.goto('/registry/new');
  await page.fill('#subject', subject);
  await page.fill('#sender_name', extra.sender || `نێردەری تاقیکردنەوە ${Math.random().toString(36).slice(2, 7)}`);
  if (extra.type) await page.selectOption('#doc_type_option_id', String(extra.type));
  if (extra.company) await page.selectOption('#company_id', String(extra.company));
  if (extra.plot) await page.fill('#plot_no', extra.plot);
  await page.click('form[data-similar-form] button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await page.click('form[data-similar-form] .row button[type=submit]');
    await page.waitForLoadState('domcontentloaded');
  }
  await page.waitForURL(/\/documents\/\d+/, { timeout: 15000 });
  const id = Number(/\/documents\/(\d+)/.exec(page.url())[1]);
  const cell = async label => (await page.locator(`tr:has(th:text-is("${label}")) td`).first().innerText()).trim();
  return { id, no: (await cell('ژمارەی هاتوو')).replace(/[⁦-⁩‎‏]/g, ''), barcode: (await cell('بارکۆد')).replace(/[⁦-⁩‎‏]/g, '') };
}

export const isoDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
export const localDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
