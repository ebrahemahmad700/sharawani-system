// 7. "Shilan and Aram can't open the account at the same time."
//
// Two browsers, or two computers: always could, and this proves it with both
// working in the same second. One browser: no website can, because every tab
// shares one sign-in. What was wrong was that it happened silently. These check
// that it is now said out loud, in both tabs.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers.mjs';

test('two people in two browsers work at the same time', async ({ browser }) => {
  const shilanCtx = await browser.newContext();
  const aramCtx = await browser.newContext();
  const shilan = await shilanCtx.newPage();
  const aram = await aramCtx.newPage();

  await Promise.all([signIn(shilan, 'shilan'), signIn(aram, 'aram')]);
  await Promise.all([shilan.goto('/registry'), aram.goto('/dashboard')]);
  await Promise.all([shilan.goto('/tray'), aram.goto('/inbox')]);

  await expect(shilan.locator('.whoami .name')).toHaveText('شیلان عومەر');
  await expect(aram.locator('.whoami .name')).toHaveText('ئارام حەمە');

  // And each can still do work that needs their session.
  await shilan.goto('/registry/new');
  await expect(shilan.locator('#subject')).toBeVisible();
  await aram.goto('/admin/scanners');
  await expect(aram.locator('h2').first()).toBeVisible();

  await shilanCtx.close();
  await aramCtx.close();
});

test('in one browser, the sign-in page explains rather than bouncing away', async ({ page }) => {
  await signIn(page, 'shilan');
  await page.goto('/login');
  await expect(page.locator('.auth-panel')).toContainText('شیلان عومەر');
  await expect(page.locator('.auth-panel')).toContainText('Ctrl+Shift+N');
  await expect(page.locator('form[action="/login/switch"]')).toBeVisible();
});

test('a tab left open as Shilan stops, when Aram signs in in another tab', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, 'shilan');
  await first.goto('/registry');

  const second = await context.newPage();
  await signIn(second, 'aram');                     // uses the switch on the sign-in page

  await first.bringToFront();
  const warning = first.locator('.session-changed');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('ئارام حەمە');
  await warning.locator('button').click();
  await expect(first.locator('.whoami .name')).toHaveText('ئارام حەمە');
});
