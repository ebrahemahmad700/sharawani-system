// Helpers for design-records. Read-only: sign in and look.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

export const launch = () => chromium.launch({ channel: 'chrome' });

export async function signedIn(browser, username, opts = { viewport: { width: 1366, height: 768 } }) {
  const ctx = await browser.newContext({ ...opts, baseURL: BASE, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.fill('#username', username);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(u => !/\/login/.test(new URL(u).pathname), { timeout: 20000 });
  await p.close();
  return ctx;
}

export const shot = name => join(SHOTS, name);
