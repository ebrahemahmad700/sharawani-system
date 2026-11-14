// Helpers for the design tester. Everything written stays under agents/design/.
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

export async function launch() {
  return chromium.launch({ channel: 'chrome' });
}

/** A signed-in context for a user; reuses a saved cookie when it still works. */
export async function ctxFor(browser, username, { width = 1366, height = 768, scale = 1 } = {}) {
  const file = join(STATE, `${username}.json`);
  const opts = { viewport: { width, height }, deviceScaleFactor: scale, locale: 'ckb', baseURL: BASE };
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const p = await ctx.newPage();
    const r = await p.goto('/');
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

export function shotPath(...parts) {
  const f = join(SHOTS, ...parts);
  mkdirSync(dirname(f), { recursive: true });
  return f;
}

export const mark = 'DZN' + Date.now().toString(36).slice(-5);

export function saveJson(name, obj) { writeFileSync(join(HERE, name), JSON.stringify(obj, null, 2)); }
export function loadJson(name, dflt = null) {
  const f = join(HERE, name);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : dflt;
}

/** Wait for fonts so Kurdish text renders in its real face. */
export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(250);
}
