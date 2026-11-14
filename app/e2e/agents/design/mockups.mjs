// Screenshot the approved mockups as Chrome draws them.
import { launch, shotPath } from './lib.mjs';
import { pathToFileURL } from 'url';

const names = ['Login', 'Main', 'Registry', 'Inbox', 'Document', 'Route', 'Archive', 'Admin', 'Outgoing'];
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('pageerror', String(e)));
page.on('requestfailed', r => console.log('failed', r.url()));
for (const n of names) {
  await page.goto(pathToFileURL(`C:/Users/Ibrahim/Desktop/sharawani_system/design/${n}.dc.html`).href);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: shotPath('mockups', `${n}.png`) });
  console.log(n);
}
await browser.close();
