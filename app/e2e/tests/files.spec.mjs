// 2. "Unselect a file."
//
// A browser's file box has no remove button. Once a file was chosen, the only way
// to un-choose it was to reload the page and lose the rest of the form.

import { test, expect } from '@playwright/test';
import { signIn, inkPdf, registerLetter, mark } from './helpers.mjs';

test('a chosen file can be removed again, and nothing is sent', async ({ page }) => {
  await signIn(page, 'shilan');
  const id = await registerLetter(page, `تاقیکردنەوەی لابردنی فایل ${mark()}`);
  await page.goto(`/documents/${id}`);

  const input = page.locator('form[action$="/attachments"] input[type=file]');
  await input.setInputFiles({ name: 'wrong-letter.pdf', mimeType: 'application/pdf', buffer: inkPdf() });
  const picked = page.locator('form[action$="/attachments"] .file-picked li');
  await expect(picked).toHaveCount(1);
  await expect(picked).toContainText('wrong-letter.pdf');

  await picked.locator('button.remove').click();
  await expect(picked).toHaveCount(0);
  expect(await input.evaluate(el => el.files.length)).toBe(0);

  // And the form still refuses to send nothing, so the removal really took.
  await page.locator('form[action$="/attachments"] button[type=submit]').click();
  expect(await input.evaluate(el => el.validity.valueMissing)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/documents/${id}$`));
});

test('one of several pages can be removed and the rest kept', async ({ page }) => {
  await signIn(page, 'shilan');
  await page.goto('/tray');
  const input = page.locator('form[action="/tray/upload"] input[type=file]');
  await input.setInputFiles([
    { name: 'page-1.pdf', mimeType: 'application/pdf', buffer: inkPdf() },
    { name: 'page-2-blank.pdf', mimeType: 'application/pdf', buffer: inkPdf() },
    { name: 'page-3.pdf', mimeType: 'application/pdf', buffer: inkPdf() },
  ]);
  const picked = page.locator('form[action="/tray/upload"] .file-picked li');
  await expect(picked).toHaveCount(3);
  await picked.filter({ hasText: 'page-2-blank.pdf' }).locator('button.remove').click();
  await expect(picked).toHaveCount(2);
  expect(await input.evaluate(el => [...el.files].map(f => f.name))).toEqual(['page-1.pdf', 'page-3.pdf']);
});

test('a file of the wrong type is refused the moment it is chosen', async ({ page }) => {
  await signIn(page, 'shilan');
  const id = await registerLetter(page, `تاقیکردنەوەی جۆری فایل ${mark()}`);
  await page.goto(`/documents/${id}`);
  const input = page.locator('form[action$="/attachments"] input[type=file]');
  await input.setInputFiles({ name: 'drawing.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('AC1032' + 'x'.repeat(200)) });
  await expect(page.locator('form[action$="/attachments"] + .hint, form[action$="/attachments"] .file-error').first()).toBeVisible();
  await expect(page.locator('form[action$="/attachments"] .file-error')).toContainText('drawing.dwg');
  expect(await input.evaluate(el => el.files.length)).toBe(0);
});
