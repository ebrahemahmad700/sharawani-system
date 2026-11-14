import { launch, close, as, note, shot, notice, MARK } from './lib.mjs';
const b = await launch();
const { page: hr } = await as('bafrin');
await hr.goto('/templates/new');
await hr.fill('#name', `خانەی کوردی ${MARK}`);
await hr.fill('#category', `تاقیکردنەوە ${MARK}`);
await hr.fill('#fields', 'employee | ناو | text');
await hr.fill('#body', 'بەڕێز {{employee}}، بەڕێوەبەر: {{بەڕێوەبەر}} ، ژمارە: {{ number-2 }}');
await hr.click('form[action="/templates/new"] button[type=submit]');
await hr.waitForLoadState('domcontentloaded');
const id = /\/templates\/(\d+)$/.exec(hr.url())?.[1];
note('templates-bad', 'kurdish/dash placeholder only', { url: hr.url(), errors: await hr.locator('.notice.error').allInnerTexts() });
if (id) {
  await hr.fill('#f_employee', 'ئاراس');
  await hr.click(`form[action="/templates/${id}"] button[type=submit]`);
  await hr.waitForLoadState('domcontentloaded');
  await hr.waitForTimeout(800);
  note('templates-bad', 'kurdish placeholder printed', { body: (await hr.locator('.sheet .body').innerText()).replace(/\s+/g, ' ') });
  await shot(hr, 'tpl-kurdish-placeholder-print', { locator: hr.locator('.sheet') });
}
await close();
