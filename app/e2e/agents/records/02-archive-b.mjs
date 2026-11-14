// Archive part 2: search, verification by the other room, location, download/preview, plot file, read-only role.
import { launch, close, as, note, shot, notice, invalidField, toKu, BASE } from './lib.mjs';

const MARK = 'rarc1';
const P = 8567;
const b = await launch();
const { page: k } = await as('karwan');
const { page: z } = await as('zhyan');
const { page: h } = await as('hemin');

async function search(p, q) {
  await p.goto(`/archive?q=${encodeURIComponent(q)}`);
  const rows = await p.locator('tbody tr').evaluateAll(trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').slice(0, 90)));
  return rows;
}
const mine = rows => rows.filter(r => r.includes(MARK) || r.includes(String(P))).length;

// Search
for (const [label, q] of [
  ['plot exact', `${P}/4`], ['plot kurdish digits', toKu(`${P}/4`)], ['plot dash', `${P}-4`], ['plot spaced', `${P} / 4`],
  ['plot prefix', String(P)], ['plot prefix kurdish', toKu(P)],
  ['owner', `خاوەن ${MARK}`], ['owner no vowels', `خاون ${MARK} حسن`], ['owner arabic ye/kaf', 'حەسەن'.replace('ە', 'ه')],
  ['neighbourhood', `گەڕەکی ${MARK}`], ['file name', `naxsha-${MARK}-5.jpg`], ['file name part', `naxsha-${MARK}-5`],
  ['title word', 'تاقیکردنەوە ' + MARK], ['year kurdish', toKu('2099')], ['folder', '47'],
]) {
  const rows = await search(k, q);
  note('archive-search', label, { q, total: rows.length, mine: mine(rows), first: rows[0] });
}
await search(k, `${P}-4`); await shot(k, 'arch-search-dash');

// Read-only role
await h.goto('/archive');
note('archive-ro', 'hemin archive', { newButton: await h.locator('a[href="/archive/new"]').count(), url: h.url() });
const rNew = await h.goto('/archive/new');
note('archive-ro', 'hemin /archive/new', { status: rNew.status(), notices: await notice(h) });
await h.goto('/archive/206');
note('archive-ro', 'hemin detail', { verifyForm: await h.locator('form[action$="/verify"]').count(), locationForm: await h.locator('form[action$="/location"]').count(), download: await h.locator('a[href$="/download"]').count() });
const dl = await h.request.get(`${BASE}/archive/210/download`);
note('archive-ro', 'hemin download pdf', { status: dl.status(), type: dl.headers()['content-type'], disp: dl.headers()['content-disposition'] });

// Verification: karwan cannot verify own; zhyan verifies. DWG without preview.
await k.goto('/archive/210');
note('archive-verify', 'karwan own record', { verifyBtn: await k.locator('form[action$="/verify"]').count(), notices: await notice(k) });
// forged verify by uploader
const tok = await k.locator('input[name=_csrf]').first().inputValue();
const forged = await k.request.post(`${BASE}/archive/210/verify`, { form: { _csrf: tok }, maxRedirects: 0 });
note('archive-verify', 'karwan forged verify own', { status: forged.status(), location: forged.headers().location });

await z.goto('/archive/206');
note('archive-verify', 'zhyan dwg without preview', { verifyBtn: await z.locator('form[action$="/verify"]').count(), notices: await notice(z), fileInputs: await z.locator('input[type=file]').count() });
await shot(z, 'arch-zhyan-dwg-nopreview');
await z.goto('/archive/209');
note('archive-verify', 'zhyan dxf without preview', { verifyBtn: await z.locator('form[action$="/verify"]').count(), notices: await notice(z) });

for (const id of [207, 208, 210, 211, 212, 213]) {
  await z.goto(`/archive/${id}`);
  const has = await z.locator('form[action$="/verify"] button').count();
  if (has) { await z.click('form[action$="/verify"] button'); await z.waitForLoadState('domcontentloaded'); }
  note('archive-verify', `zhyan verify ${id}`, { had: has, url: z.url(), notices: await notice(z), pill: await z.locator('.pill.ok').first().innerText().catch(() => null) });
}
await z.goto('/archive/207'); await shot(z, 'arch-verified-207');
// verify twice (already verified, forged)
const ztok = await z.locator('input[name=_csrf]').first().inputValue();
const again = await z.request.post(`${BASE}/archive/207/verify`, { form: { _csrf: ztok }, maxRedirects: 0 });
note('archive-verify', 'zhyan verify again', { status: again.status(), location: again.headers().location });

// Preview & download
for (const [id, what] of [[207, 'preview'], [207, 'download'], [211, 'download'], [213, 'download'], [209, 'preview']]) {
  const r = await z.request.get(`${BASE}/archive/${id}/${what}`);
  note('archive-file', `${id} ${what}`, { status: r.status(), type: r.headers()['content-type'], disp: r.headers()['content-disposition'], len: (await r.body()).length });
}
// the preview button opens a PDF in the viewer
await z.goto('/archive/207');
const [popup] = await Promise.all([z.waitForEvent('popup', { timeout: 10000 }).catch(() => null), z.click('a[href$="/preview"]')]);
if (popup) { await popup.waitForLoadState().catch(() => {}); note('archive-file', 'preview popup', { url: popup.url() }); await popup.close(); }
// image records: does the detail page show the picture? A TIF?
await z.goto('/archive/211');
note('archive-file', 'jpg detail', { imgs: await z.locator('.content img, main img').count(), previewBtn: await z.locator('a[href$="/preview"]').count(), downloadText: await z.locator('a[href$="/download"]').innerText() });

// Location change
await z.goto('/archive/212');
await z.fill('form[action$="/location"] #shelf', '   ');
note('archive-loc', 'whitespace shelf browser', { invalid: await invalidField(z, 'form[action$="/location"]') });
await z.click('form[action$="/location"] button'); await z.waitForLoadState('domcontentloaded');
note('archive-loc', 'whitespace shelf server', { url: z.url(), notices: await notice(z) });
await shot(z, 'arch-loc-whitespace');
await z.goto('/archive/212');
await z.fill('form[action$="/location"] #shelf', toKu('14'));
await z.fill('form[action$="/location"] #section', 'A-3');
await z.fill('form[action$="/location"] #box_no', '');
await z.fill('form[action$="/location"] #folder_no', toKu('108'));
await z.click('form[action$="/location"] button'); await z.waitForLoadState('domcontentloaded');
note('archive-loc', 'kurdish digits', { url: z.url(), notices: await notice(z), shown: await z.locator('tr:has(th:text("شوێن لەسەر ڕەف")) td').innerText() });
await shot(z, 'arch-loc-kurdish');
// forged location change on a record id that does not exist
const lz = await z.request.post(`${BASE}/archive/999999/location`, { form: { _csrf: ztok, shelf: '1', section: '1', folder_no: '1' }, maxRedirects: 0 });
note('archive-loc', 'nonexistent id', { status: lz.status(), location: lz.headers().location });
// search by the new location
const rows = await search(z, toKu('108'));
note('archive-loc', 'search new folder kurdish', { total: rows.length, mine: mine(rows) });

// Plot file
for (const q of [`${P}/7`, toKu(`${P}/7`), String(P)]) {
  await k.goto(`/plots?p=${encodeURIComponent(q)}`);
  const body = (await k.locator('.content, main').first().innerText()).replace(/\s+/g, ' ');
  note('archive-plot', `plot file ${q}`, { url: k.url(), hasDrawing: body.includes(MARK), snippet: body.slice(0, 300) });
}
await k.goto(`/plots?p=${encodeURIComponent(`${P}/7`)}`); await shot(k, 'arch-plotfile', { fullPage: true });

// Notice from the query string on the archive page
await k.goto(`/archive/210?error=${encodeURIComponent('ئەم نەخشەیە سڕایەوە. تکایە پەیوەندی بە ژمارە ٠٧٥٠١٢٣٤٥٦٧ بکە')}`);
note('archive-misc', 'error param shown', { notices: await notice(k) });

console.log('problems', k.problems, z.problems, h.problems);
await close();
