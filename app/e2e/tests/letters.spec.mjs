// 6. Rooms could not open the PDFs on a letter.
// 5. Plot numbers came out as "2٤0/4".
// 8. The legal and contracts rooms could not start a letter.
// 10. Rooms 8 and 9 could not attach a DWG.
//
// The server half of each is in ../test/fixes.test.mjs. What is checked here is
// what only a browser can show: the PDF is drawn, with ink on it, inside the page;
// the digits change as they are typed; the buttons are where a person looks.

import { test, expect } from '@playwright/test';
import { signIn, inkPdf, registerLetter, mark } from './helpers.mjs';

test('a PDF attached by the registry is drawn inside the page for the legal room', async ({ browser }) => {
  const regCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const reg = await regCtx.newPage();
  await signIn(reg, 'shilan');
  const subject = `نامەی بۆ ژووری یاسا ${mark()}`;
  const id = await registerLetter(reg, subject);

  await reg.locator('form[action$="/attachments"] input[type=file]')
    .setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: inkPdf() });
  await reg.locator('form[action$="/attachments"] button[type=submit]').click();
  await expect(reg).toHaveURL(/attached=1/);

  await reg.selectOption('#to_room', { label: 'ژووری یاسا' });
  await reg.locator('form[action$="/route"]').first().locator('button[type=submit]').click();
  await expect(reg).toHaveURL(/sent=1/);
  await regCtx.close();

  for (const [label, viewport] of [['laptop', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, isMobile: label === 'phone', hasTouch: label === 'phone' });
    const legal = await ctx.newPage();
    await signIn(legal, 'sakar');
    await legal.goto(`/documents/${id}`);
    const view = legal.locator('#attachments a.btn', { hasText: 'بینین' }).first();
    await expect(view, `${label}: a view button`).toBeVisible();
    await view.click();
    await expect(legal).toHaveURL(/\/attachments\/\d+\/view/);

    const canvas = legal.locator('.pdf-page canvas').first();
    await expect(canvas, `${label}: the page is drawn`).toBeVisible();
    // Ink, not a blank white box: the rectangle in the test PDF is black.
    const dark = await canvas.evaluate(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) n++;
      return n;
    });
    expect(dark, `${label}: dark pixels on the drawn page`).toBeGreaterThan(50);
    await expect(legal.locator('.viewer-list')).toContainText('original.pdf');
    if (label === 'phone') {
      // Legal finishes its step, so repeated runs do not fill the room's inbox.
      await legal.goto(`/documents/${id}`);
      await legal.locator('form[action$="/complete"] button[type=submit]').click();
      // Finishing a step says so, rather than "letter sent" (browser audit, 13 September).
      await expect(legal).toHaveURL(/done=complete/);
    }
    await ctx.close();
  }
});

test('the legal room starts a letter, and its plot number is typed in one kind of digit', async ({ page }) => {
  await signIn(page, 'hemin');
  await expect(page.locator('.nav a[href="/registry/new"]')).toBeVisible();
  await page.goto('/registry/new');
  await page.fill('#subject', `یادداشتی ژووری یاسا ${mark()}`);
  await page.locator('#plot_no').pressSequentially('2٤0/4');
  await expect(page.locator('#plot_no')).toHaveValue('240/4');
  await page.locator('#physical_shelf').pressSequentially('ب3');
  await expect(page.locator('#physical_shelf')).toHaveValue('ب٣');
  await page.click('form[data-similar-form] button[type=submit]');
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await page.click('form[data-similar-form] .row button[type=submit]');
  }
  await expect(page).toHaveURL(/\/documents\/\d+\?registered=1/);
  await expect(page.locator('table')).toContainText('240/4');
});

test('room 8 is offered DWG on a letter; the registry is not', async ({ browser }) => {
  const reg = await (await browser.newContext()).newPage();
  await signIn(reg, 'aram');
  const id = await registerLetter(reg, `نەخشەی پارچە بۆ ژووری ٨ ${mark()}`);
  await reg.selectOption('#to_room', { label: 'نەخشەی بنەڕەتی (٨)' });
  await reg.locator('form[action$="/route"]').first().locator('button[type=submit]').click();
  await expect(reg).toHaveURL(/sent=1/);
  expect(await reg.locator('form[action$="/attachments"] input[type=file]').getAttribute('accept')).not.toContain('.dwg');

  const room8 = await (await browser.newContext()).newPage();
  await signIn(room8, 'karwan');
  await room8.goto(`/documents/${id}`);
  const input = room8.locator('form[action$="/attachments"] input[type=file]');
  expect(await input.getAttribute('accept')).toContain('.dwg');
  await input.setInputFiles({ name: 'plot-map.dwg', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(3000, 1)]) });
  await expect(room8.locator('form[action$="/attachments"] .file-picked li')).toContainText('plot-map.dwg');
  await room8.locator('form[action$="/attachments"] button[type=submit]').click();
  await expect(room8).toHaveURL(/attached=1/);
  await expect(room8.locator('#attachments')).toContainText('plot-map.dwg');
  await expect(room8.locator('#attachments')).toContainText('DWG');
});

// 4. Scanner devices. The simulated scanner answers the same requests a real
// network scanner does; see src/lib/escl.mjs. Skipped where it is not switched on.
test('pressing scan on a letter puts the scanned pages on it', async ({ page }) => {
  await signIn(page, 'shilan');
  const id = await registerLetter(page, `کتابی سکانکراو لە سکانەر ${mark()}`);
  const scanLink = page.locator('a', { hasText: 'سکانکردن لە سکانەر' });
  test.skip(await scanLink.count() === 0, 'no scanner is configured on this server');
  await scanLink.click();
  await expect(page.locator('input[name="scanner_id"]').first()).toBeChecked();
  await expect(page.locator('[data-scanner-status]').first()).toHaveText('ئامادەیە');
  await page.selectOption('#source', 'Feeder');
  await page.locator('form[action="/scan"] button[type=submit]').click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}\\?attached=1`));
  await expect(page.locator('#attachments')).toContainText(/SIMULATOR-\d{12}\.pdf/);
  await expect(page.locator('#attachments')).toContainText('٢ پەڕە');
});
