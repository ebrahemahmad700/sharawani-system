// Screenshot the approved mockups.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'url';
import { shot } from './lib.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Main', 'Admin', 'Archive', 'Login'];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const n of names) {
  await page.goto(pathToFileURL(`C:/Users/Ibrahim/Desktop/sharawani_system/design/${n}.dc.html`).href);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(`mock-${n}.png`), fullPage: true });
  console.log(n);
}
await browser.close();
