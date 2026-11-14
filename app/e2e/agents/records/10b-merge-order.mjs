// Does "merge into one PDF" keep the order the files were chosen in?
import { launch, close, as, note, shot, notice, BASE } from './lib.mjs';
import { PDFDocument } from 'pdf-lib';

const MARK = 'rord' + Date.now().toString(36).slice(-3);
const b = await launch();
const { page: h } = await as('ahang');
// Six one-page PDFs, page i is (300 + 10*i) points wide, so the merged file's page widths show the order.
// File 1 is made big (padding in a stream) so it takes longest to arrive.
async function pdfOf(i, pad = 0) {
  const d = await PDFDocument.create();
  const p = d.addPage([300 + 10 * i, 400]);
  if (pad) { const img = await d.embedPng(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3b2c1a90000000049454e44ae426082', 'hex')); p.drawImage(img, { x: 0, y: 0, width: 1, height: 1 }); d.setSubject('x'.repeat(pad)); }
  return Buffer.from(await d.save());
}
const files = [];
for (let i = 1; i <= 6; i++) files.push({ name: `${MARK}-page${i}.pdf`, mimeType: 'application/pdf', buffer: await pdfOf(i, i === 1 ? 3_000_000 : 0) });
note('merge-order', 'sizes', { sizes: files.map(f => f.buffer.length) });
await h.goto('/tray');
await h.setInputFiles('form[action="/tray/upload"] #file', files);
note('merge-order', 'browser order', { names: await h.locator('form[action="/tray/upload"] #file').evaluate(i => [...i.files].map(f => f.name)) });
await h.locator('form[action="/tray/upload"] input[name=merge]').check();
await h.click('form[action="/tray/upload"] button[type=submit]'); await h.waitForLoadState('domcontentloaded', { timeout: 60000 });
note('merge-order', 'uploaded', { notices: await notice(h) });
const row = h.locator('.card:has(h2:text("سکانە نوێیەکان")) tbody tr', { hasText: MARK }).first();
const name = (await row.locator('td').first().innerText()).replace(/\s+/g, ' ');
const href = await row.locator('a').getAttribute('href');
const bytes = await (await h.request.get(`${BASE}${href}/preview`)).body();
const merged = await PDFDocument.load(bytes);
const widths = merged.getPages().map(p => Math.round(p.getWidth()));
note('merge-order', 'merged page order', { name, widths, expected: [310, 320, 330, 340, 350, 360], pageOrder: widths.map(w => (w - 300) / 10) });
await shot(h, 'merge-order-row', { locator: row });
await close();
