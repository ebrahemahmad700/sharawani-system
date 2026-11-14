// Security-test helpers. Marker so nothing collides with the other testers.
import { chromium } from '@playwright/test';

export const BASE = 'http://localhost:3111';
export const PASSWORD = 'guhare-2026';
export const MARK = 'SECZ';               // unique marker for objects we create
export const tag = () => `${MARK}-${Math.random().toString(36).slice(2, 8)}`;

export async function launch() {
  return chromium.launch({ channel: 'chrome' });
}

/** A signed-in browser context for one user, plus its csrf token. */
export async function signIn(browser, username, password = PASSWORD) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto('/login');
  if (await page.locator('form[action="/login/switch"]').count()) {
    await page.locator('form[action="/login/switch"] button').click();
    await page.waitForURL(/\/login/);
  }
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  const csrf = await csrfOf(page);
  return { context, page, csrf, username };
}

/** Read the per-session CSRF token off the page shell. */
export async function csrfOf(page) {
  try {
    const v = await page.getAttribute('body', 'data-csrf');
    if (v) return v;
  } catch { /* not an app shell */ }
  // fall back to any hidden _csrf input
  const el = page.locator('input[name="_csrf"]').first();
  if (await el.count()) return await el.getAttribute('value');
  return null;
}

/** Register an incoming letter through the real form; returns { id, no, url }. */
export async function registerLetter(page, { subject, sender }) {
  await page.goto('/registry/new');
  await page.fill('#subject', subject);
  await page.fill('#sender_name', sender);
  await page.click('form[data-similar-form] button[type=submit]');
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await page.click('form[data-similar-form] .row button[type=submit]');
  }
  await page.waitForURL(/\/documents\/\d+/);
  const id = Number(/\/documents\/(\d+)/.exec(page.url())[1]);
  return { id, url: page.url() };
}

const reqOf = ctx => ctx.request ?? ctx.context?.request;

/** Convenience: POST form-encoded via the context's request API. */
export async function post(ctx, path, form, extraHeaders = {}) {
  return reqOf(ctx).post(path, { form, headers: extraHeaders, maxRedirects: 0 }).catch(e => ({ error: String(e) }));
}

export async function get(ctx, path, extraHeaders = {}) {
  return reqOf(ctx).get(path, { headers: extraHeaders, maxRedirects: 0 }).catch(e => ({ error: String(e) }));
}

/** A small but genuine PDF with ink. */
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

/** A PDF carrying an OpenAction JavaScript. Still a real %PDF. */
export function jsPdf() {
  const body = '%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>endobj\n'
    + '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n'
    + '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj\n'
    + '5 0 obj<< /S /JavaScript /JS (app.alert\\(1\\);) >>endobj\n'
    + 'trailer<< /Root 1 0 R >>\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

export function short(s, n = 300) {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
