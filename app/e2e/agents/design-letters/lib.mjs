// Helpers for the design-letters reviewer. Read-only: signs in and looks.
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const STATE = join(HERE, 'state');
mkdirSync(STATE, { recursive: true });

export const launch = () => chromium.launch({ channel: 'chrome' });

export async function ctxFor(browser, username, { width = 1366, height = 768 } = {}) {
  const file = join(STATE, `${username}.json`);
  const opts = { viewport: { width, height }, baseURL: BASE, hasTouch: false };
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const p = await ctx.newPage();
    await p.goto('/my-day');
    if (!/\/login/.test(p.url())) { await p.close(); return ctx; }
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.fill('#username', username);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(u => !/\/login/.test(new URL(u).pathname), { timeout: 20000 });
  await ctx.storageState({ path: file });
  await p.close();
  return ctx;
}

export const shot = (...parts) => { const f = join(SHOTS, ...parts); mkdirSync(dirname(f), { recursive: true }); return f; };
export const save = (name, obj) => writeFileSync(join(HERE, name), JSON.stringify(obj, null, 2));
export const load = (name, d = null) => existsSync(join(HERE, name)) ? JSON.parse(readFileSync(join(HERE, name), 'utf8')) : d;

export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(300);
}
