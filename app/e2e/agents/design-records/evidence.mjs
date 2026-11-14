// Targeted measurements. GET only.
import { writeFileSync } from 'fs';
import { join } from 'path';
import { launch, signedIn, shot, HERE, BASE } from './lib.mjs';

const browser = await launch();
const out = {};
const DESK = { viewport: { width: 1366, height: 768 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function thWrap(page) {
  return page.evaluate(() => [...document.querySelectorAll('main table thead')].map(th => {
    const cells = [...th.querySelectorAll('th')].filter(c => !c.querySelector('.sr-only') && c.textContent.trim());
    return cells.map(c => {
      const lh = parseFloat(getComputedStyle(c).lineHeight) || 21.6;
      const range = document.createRange(); range.selectNodeContents(c);
      const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
      return { t: c.textContent.trim(), w: Math.round(c.getBoundingClientRect().width), lines, wrap: getComputedStyle(c).overflowWrap, ws: getComputedStyle(c).whiteSpace };
    }).filter(x => x.lines > 1);
  }).filter(a => a.length));
}

async function textOf(page, sel) { return page.$$eval(sel, els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim())); }

// aram, desk
{
  const ctx = await signedIn(browser, 'aram', DESK);
  const p = await ctx.newPage();
  for (const u of ['/dashboard', '/companies', '/companies/93', '/rooms']) { await p.goto(u); out[`thwrap ${u}`] = await thWrap(p); }
  await p.goto('/dashboard');
  out.dashHeads = await p.evaluate(() => [...document.querySelectorAll('.card .row')].filter(r => r.querySelector('h2')).map(r => {
    const a = r.querySelector('a'); const s = getComputedStyle(a);
    return { h2: r.querySelector('h2').textContent, link: a.textContent, fs: s.fontSize, fw: s.fontWeight, deco: s.textDecorationLine };
  }));
  out.dashAssistant = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.assistant-card')); const o = getComputedStyle(document.querySelector('.card:not(.assistant-card)')); return { assistant: [c.borderRadius, c.borderTopWidth, c.borderTopColor], other: [o.borderRadius, o.borderTopWidth, o.borderTopColor] }; });
  out.dashCols = await p.evaluate(() => { const g = document.querySelectorAll('.grid.cols-2')[0]; const [a, b] = g.children; const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); const rowsH = [...a.querySelectorAll('tbody tr')].map(tr => tr.getBoundingClientRect().height); return { firstColH: Math.round(ra.height), secondColH: Math.round(rb.height), hole: Math.round(ra.height - rb.height), roomRows: rowsH.length, avgRowH: Math.round(rowsH.reduce((x, y) => x + y, 0) / rowsH.length) }; });
  await p.goto('/companies?q=zzqqxxnomatch'); out.emptyCompanies = await textOf(p, '.empty');
  await p.goto('/log?user=zzqqxxnomatch'); out.emptyLog = await p.evaluate(() => { const e = document.querySelector('.empty'); const s = getComputedStyle(e); return { t: e.textContent.trim(), inTd: !!e.closest('td'), pad: s.padding }; });
  await p.locator('.card').first().screenshot({ path: shot('e-log-empty.png') });
  await p.goto('/companies?q=zzqqxxnomatch'); await p.locator('.card').last().screenshot({ path: shot('e-companies-empty.png') });
  await p.goto('/companies/99999999'); out.nfCompany = { status: null, h1: await textOf(p, '.topbar h1'), body: await textOf(p, 'main .card') };
  const r = await p.goto('/companies/99999999'); out.nfCompany.status = r.status();
  await p.goto('/password?changed=1'); out.noticePassword = await textOf(p, '.notice');
  await p.goto('/log');
  out.logDetailsVisible = await p.evaluate(() => { const d = document.querySelector('.log-detail details'); return d ? { open: d.open, ddVisible: d.querySelector('dd')?.getBoundingClientRect().height } : null; });
  await p.goto('/assistant'); out.assistantPlaceholder = await p.getAttribute('input[name=q]', 'placeholder');
  await p.goto('/dashboard'); out.dashAssistantPlaceholder = await p.getAttribute('.assistant-card input[name=q]', 'placeholder');
  await ctx.close();
}
// karwan
{
  const ctx = await signedIn(browser, 'karwan', DESK);
  const p = await ctx.newPage();
  const r = await p.goto('/archive/99999999');
  out.nfArchive = { status: r.status(), h1: await textOf(p, '.topbar h1'), body: await textOf(p, 'main .card'), buttons: await textOf(p, 'main .btn') };
  await p.locator('main').screenshot({ path: shot('e-nf-archive.png') });
  await p.goto('/archive?q=zzqqxxnomatch'); out.emptyArchive = await textOf(p, '.empty');
  await p.goto('/archive/236?saved=1'); out.noticeArchive = await textOf(p, 'main > .notice');
  await ctx.close();
}
// bafrin
{
  const ctx = await signedIn(browser, 'bafrin', DESK);
  const p = await ctx.newPage();
  const r = await p.goto('/templates/99999999');
  out.nfTemplate = { status: r.status(), h1: await textOf(p, '.topbar h1'), body: await textOf(p, 'main .card'), buttons: await textOf(p, 'main .btn') };
  await p.goto('/leave?ok=1'); out.noticeLeave = await textOf(p, 'main > .notice');
  await p.goto('/templates/4?saved=1'); out.noticeTemplate = await textOf(p, 'main > .notice');
  await p.goto('/leave');
  out.leaveWhen = await p.$$eval('main td .muted', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => /ماوە|سبەی|ئەمڕۆ/.test(t)).slice(0, 4));
  await ctx.close();
}
// aram 404 documents
{
  const ctx = await signedIn(browser, 'aram', DESK);
  const p = await ctx.newPage();
  await p.goto('/documents/99999999'); await p.locator('main').screenshot({ path: shot('e-nf-document.png') });
  await p.goto('/companies/99999999'); await p.locator('main').screenshot({ path: shot('e-nf-company.png') });
  await ctx.close();
}
// itadmin
{
  const ctx = await signedIn(browser, 'itadmin', DESK);
  const p = await ctx.newPage();
  for (const u of ['/admin/users', '/admin/rooms', '/admin/doc-types', '/admin/scanners']) { await p.goto(u); out[`thwrap ${u}`] = await thWrap(p); }
  await p.goto('/admin/users?ok=1'); out.noticeUsers = await textOf(p, 'main > .notice');
  await p.goto('/admin/users');
  out.usersHeadH = await p.evaluate(() => Math.round(document.querySelector('main thead').getBoundingClientRect().height));
  await p.locator('main table thead').screenshot({ path: shot('e-users-thead.png') });
  await p.goto('/admin/rooms');
  out.roomsForm = await p.evaluate(() => [...document.querySelectorAll('form.grid .field')].map(f => ({ l: f.querySelector('label')?.textContent.trim() || f.textContent.trim(), x: Math.round(f.getBoundingClientRect().left), y: Math.round(f.getBoundingClientRect().top + scrollY), w: Math.round(f.getBoundingClientRect().width), labelY: f.querySelector('label') ? Math.round(f.querySelector('label').getBoundingClientRect().top + scrollY) : null })));
  await p.locator('main .card').first().screenshot({ path: shot('e-rooms-form.png') });
  await p.goto('/admin/doc-types');
  await p.locator('main .card').last().screenshot({ path: shot('e-doctypes-form.png') });
  out.inactive = await p.evaluate(() => { const tr = [...document.querySelectorAll('main tbody tr')].find(t => t.style.opacity); return tr ? getComputedStyle(tr).opacity : null; });
  await p.goto('/admin/scanners');
  out.scannerRows = await p.evaluate(() => [...document.querySelectorAll('main tbody tr')].map(tr => ({ op: getComputedStyle(tr).opacity, pill: tr.querySelector('.pill')?.textContent, btn: [...tr.querySelectorAll('.btn')].map(b => b.className + ':' + b.textContent.trim()) })));
  await p.goto('/admin/users');
  out.userRowsInactive = await p.evaluate(() => { const tr = [...document.querySelectorAll('main tbody tr')].find(t => t.style.opacity); return tr ? { op: getComputedStyle(tr).opacity, pill: tr.querySelector('.pill')?.textContent || null, btns: [...tr.querySelectorAll('.btn')].map(b => b.className + ':' + b.textContent.trim()) } : null; });
  await ctx.close();
}
// sakar phone checks
{
  const ctx = await signedIn(browser, 'sakar', PHONE);
  const p = await ctx.newPage();
  await p.goto('/leave');
  out.phone = await p.evaluate(() => {
    const snd = document.querySelector('.sound-toggle'); const btn = document.querySelector('main form .btn'); const card = document.querySelector('main .card');
    const inp = document.querySelector('#note');
    const tbl = document.querySelector('main table'); const pin = document.querySelector('main td:last-child');
    return { soundDisplay: getComputedStyle(snd).display, btnPad: getComputedStyle(btn).padding, cardPad: getComputedStyle(card).padding, cardRadius: getComputedStyle(card).borderRadius, cardMb: getComputedStyle(card).marginBottom, inputFs: getComputedStyle(inp).fontSize, leaveTableMinW: getComputedStyle(tbl).minWidth, leaveTableW: Math.round(tbl.getBoundingClientRect().width), pinned: getComputedStyle(pin).position };
  });
  await p.locator('main .card').nth(1).screenshot({ path: shot('e-phone-leave-list.png'), clip: undefined }).catch(() => {});
  await ctx.close();
}
writeFileSync(join(HERE, 'evidence.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
