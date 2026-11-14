// Shared bits for the mobile / accessibility tester.
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
export const STATE = join(HERE, 'state');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(STATE, { recursive: true });

export const DEVICES = {
  s360: { width: 360, height: 740, dsf: 3, mobile: true },
  i390: { width: 390, height: 844, dsf: 3, mobile: true },
  a412: { width: 412, height: 915, dsf: 2.625, mobile: true },
  t768: { width: 768, height: 1024, dsf: 2, mobile: true },
  t1024: { width: 1024, height: 768, dsf: 2, mobile: true },
  d1366: { width: 1366, height: 768, dsf: 1, mobile: false },
};

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

/** Sign in once per user and keep the cookies, so contexts reuse the session. */
export async function stateFor(browser, user) {
  const file = join(STATE, `${user}.json`);
  if (existsSync(file)) {
    // Check it still works.
    const ctx = await browser.newContext({ baseURL: BASE, storageState: file });
    const p = await ctx.newPage();
    const r = await p.goto('/notifications/count').catch(() => null);
    const okState = r && r.status() === 200 && !/\/login/.test(p.url());
    await ctx.close();
    if (okState) return file;
  }
  const ctx = await browser.newContext({ baseURL: BASE });
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.fill('#username', user);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(u => !['/login', '/'].includes(new URL(u).pathname), { timeout: 20000 });
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

export async function ctxFor(browser, user, devKey = 'i390', extra = {}) {
  const d = DEVICES[devKey];
  const opts = {
    baseURL: BASE,
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dsf,
    isMobile: d.mobile,
    hasTouch: d.mobile,
    locale: 'ckb',
    ...extra,
  };
  if (user) opts.storageState = await stateFor(browser, user);
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(`pageerror ${page.url()}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') page.problems.push(`console ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) page.problems.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('dialog', d => d.accept());
  return { context, page };
}

/** Horizontal overflow facts, plus the elements that stick out of the viewport. */
export async function overflow(page) {
  return page.evaluate(() => {
    const iw = window.innerWidth;
    const sw = document.documentElement.scrollWidth;
    const bw = document.body.scrollWidth;
    const out = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Skip things inside a horizontal scroller (they are meant to scroll).
      let p = el.parentElement, inScroller = false, inFixedHidden = false;
      while (p && p !== document.body) {
        const pcs = getComputedStyle(p);
        if ((pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') && p.scrollWidth > p.clientWidth - 1) { inScroller = true; break; }
        if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden' || pcs.overflow === 'hidden' || pcs.overflow === 'clip') { const pr = p.getBoundingClientRect(); if (pr.left >= -1 && pr.right <= iw + 1) { inScroller = true; break; } }
        p = p.parentElement;
      }
      if (inScroller) continue;
      if (el.closest('.sidebar') && getComputedStyle(document.querySelector('.sidebar')).position === 'fixed') continue;
      if (el.closest('.file-native') || el.classList.contains('file-native') || el.id === 'nav-toggle') continue;
      if (r.right > iw + 1 || r.left < -1) {
        const desc = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
        out.push({ el: desc, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 40) });
      }
    }
    // Keep only outermost offenders.
    return { iw, sw, bw, offenders: out.slice(0, 12) };
  });
}

/** Tappable things smaller than min px, visible on screen. */
export async function smallTargets(page, min = 40) {
  return page.evaluate(min => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, label.btn, [role=button], [tabindex]:not([tabindex="-1"])';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.classList.contains('file-native') || el.id === 'nav-toggle') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right < 0 || r.left > innerWidth) continue; // offscreen (closed drawer)
      // Links inside running text are exempt (WCAG 2.5.8 inline exception).
      const inline = el.tagName === 'A' && cs.display === 'inline' && !el.classList.contains('btn');
      if (r.width < min || r.height < min) {
        const desc = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.type && el.tagName === 'INPUT' ? `[type=${el.type}]` : '');
        out.push({ el: desc, w: Math.round(r.width), h: Math.round(r.height), inline, text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 30), x: Math.round(r.left), y: Math.round(r.top + scrollY) });
      }
    }
    return out;
  }, min);
}

export async function shot(page, name, clip) {
  const path = join(SHOTS, `${name}.png`);
  if (clip) await page.screenshot({ path, clip, scale: 'css' });
  else await page.screenshot({ path, scale: 'css' });
  return path;
}

export const mark = () => 'MOB' + Math.random().toString(36).slice(2, 7);

export const log = (file, obj) => appendFileSync(join(HERE, file), JSON.stringify(obj) + '\n');

/** A small PDF with ink. */
export function inkPdf() {
  const content = '0 0 0 rg 40 40 120 120 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

import zlib from 'zlib';
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
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}



/** Screenshot the page area around an element (page coordinates, full page). */
export async function shotAround(page, locator, name, { above = 40, height = 240 } = {}) {
  const box = await locator.boundingBox();
  const sy = await page.evaluate(() => scrollY);
  const vw = page.viewportSize().width;
  const path = join(SHOTS, `${name}.png`);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const y = Math.max(0, box.y + sy - above);
  await page.screenshot({ path, fullPage: true, scale: 'css', clip: { x: 0, y, width: vw, height: Math.min(height, docH - y) } });
  return path;
}
