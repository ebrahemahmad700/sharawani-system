import { browser, as, note, register, MARK, shot, problems } from './lib.mjs';

const b = await browser();
const { page } = await as(b, 'shilan');
note('shilan landed on', page.url());
const r = await register(page, { subject: `${MARK} تاقیکردنەوەی سەرەتایی بۆ ناسینی ژوورەکان`, sender: `نێردەر ${MARK}` });
note('registered', r);
const rooms = await page.locator('#to_room option').evaluateAll(os => os.map(o => `${o.value}=${o.textContent.trim()}`));
note('rooms', rooms);
const types = await page.goto('/registry/new').then(() => page.locator('#doc_type_option_id option').evaluateAll(os => os.map(o => `${o.value}=${o.textContent.trim()}`)));
note('types', types.slice(0, 20));
await shot(page, 's00-new-form', { fullPage: true });
problems(page, 'explore');
await b.close();
