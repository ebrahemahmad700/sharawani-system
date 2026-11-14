// Which phone rules in app.css actually apply at 390px.
import { launch, ctxFor, settle } from './lib.mjs';
const browser = await launch();
const ctx = await ctxFor(browser, 'sakar', { width: 390, height: 844 });
const p = await ctx.newPage();
await p.goto('/documents/542'); await settle(p);
console.log(JSON.stringify(await p.evaluate(() => {
  const cs = s => { const e = document.querySelector(s); return e ? getComputedStyle(e) : null; };
  const c = cs('main .card'), b = cs('main .btn:not(.small)'), s = cs('.sound-toggle'), t = cs('#note_body'), sel = cs('main select');
  return {
    card: { padding: c.padding, marginBottom: c.marginBottom, radius: c.borderRadius },
    btn: { padding: b.padding, minHeight: b.minHeight },
    soundToggle: { display: s.display, visible: document.querySelector('.sound-toggle').getBoundingClientRect().width },
    textareaFs: t.fontSize, selectFs: sel.fontSize,
    matchesPhone: matchMedia('(max-width: 900px)').matches,
  };
}), null, 1));
await browser.close();
