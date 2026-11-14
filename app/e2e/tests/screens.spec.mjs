// 1. "The scroller isn't working properly."
//
// It was not working at all: a mouse wheel or touchpad did not move any page in
// the application. See the long comment above body in public/app.css. These turn
// a real wheel over real pages, on a laptop screen and on a phone screen, and also
// check the other thing found while looking: on a phone, half of a letter's page
// was pushed off the side of the screen where it could not be reached.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers.mjs';

const LONG_PAGES = ['/registry', '/tray', '/my-day', '/dashboard', '/archive/new', '/registry/new'];

test.describe('on a laptop screen', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the mouse wheel scrolls every long page', async ({ page }) => {
    await signIn(page, 'aram');
    let tried = 0;
    for (const path of LONG_PAGES) {
      await page.goto(path);
      const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      if (room < 200) continue;                         // this page is short today
      tried++;
      await page.mouse.move(700, 400);
      await page.mouse.wheel(0, 500);
      await expect.poll(() => page.evaluate(() => scrollY), { message: `wheel on ${path}` }).toBeGreaterThan(100);
    }
    expect(tried, 'at least some pages were long enough to scroll').toBeGreaterThan(1);
  });

  test('the top bar stays in reach while scrolling', async ({ page }) => {
    await signIn(page, 'aram');
    await page.goto('/registry');
    // As far as the page allows. A demo with fourteen letters is a short page.
    const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    test.skip(room < 60, 'the register is too short to scroll');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(Math.min(300, room - 20));
    const top = await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(2);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('nothing on a letter\'s page is wider than the screen', async ({ page }) => {
    await signIn(page, 'shilan');
    await page.goto('/registry');
    const first = page.locator('table a[href^="/documents/"]').first();
    await page.goto(await first.getAttribute('href'));
    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('.content .card')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; })
        .map(el => el.querySelector('h2')?.textContent?.trim() ?? el.className);
    });
    expect(wide, 'cards pushed off the side of the screen').toEqual([]);
  });

  test('the wheel scrolls on a phone-sized screen too', async ({ page }) => {
    await signIn(page, 'shilan');
    await page.goto('/registry');
    await page.mouse.move(200, 500);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  });

  test('the menu drawer is out of sight until it is opened', async ({ page }) => {
    await signIn(page, 'shilan');
    const sidebar = page.locator('.sidebar');
    const hidden = await sidebar.evaluate(el => el.getBoundingClientRect().left >= innerWidth - 1);
    expect(hidden).toBe(true);
    await page.locator('label.nav-toggle').click();
    await expect.poll(() => sidebar.evaluate(el => Math.round(el.getBoundingClientRect().right))).toBeLessThanOrEqual(390);
  });
});
