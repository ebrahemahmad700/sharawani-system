// Find a letter with notes and attachments, without opening one held by the viewer's room.
import { launch, ctxFor, load, save } from './lib.mjs';
const ids = load('ids.json');
const browser = await launch();
const ctx = await ctxFor(browser, 'shilan');
const found = [];
const cands = ids.registry.filter(r => r.where !== 'ژووری هات و دەرچوو').map(r => r.href);
for (const href of cands.slice(0, 60)) {
  const r = await ctx.request.get(href);
  const t = await r.text();
  const notes = (t.match(/<ul class="note-list">([\s\S]*?)<\/ul>/)?.[1].match(/<li>/g) ?? []).length;
  const att = (t.match(/<ul class="attach-list">([\s\S]*?)<\/ul>/)?.[1].match(/<li/g) ?? []).length;
  const barcode = t.match(/<th>بارکۆد<\/th><td class="mono"><span dir="ltr">(\d+)</)?.[1];
  const priority = /pill (warn|danger)">(پەلە|زۆر پەلە)/.test(t);
  found.push({ href, notes, att, barcode, priority });
  if (notes && att) console.log('BOTH', href, notes, att);
}
save('probe.json', found);
console.log(found.filter(f => f.notes || f.att).slice(0, 20));
await browser.close();
