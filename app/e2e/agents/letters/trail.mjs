// Print the trail of letters as a user: node trail.mjs user id [id...]
import { browser, as, note, trailText, shot } from './lib.mjs';
const [who, ...ids] = process.argv.slice(2);
const b = await browser();
const { page } = await as(b, who);
for (const id of ids) {
  await page.goto(`/documents/${id}`);
  note(`trail ${id} as ${who}: status`, (await page.locator('.card .pill').first().textContent().catch(() => '?')), await trailText(page));
  if (process.env.SHOT) await shot(page, `trail-${id}-${who}`, { fullPage: true });
}
await b.close();
