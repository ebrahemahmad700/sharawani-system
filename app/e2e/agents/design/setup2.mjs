// Second batch of odd content: template, fill, tray scan, archive map, leave, manifest.
import { launch, ctxFor, saveJson, loadJson } from './lib.mjs';
import { inkPdf } from '../../tests/helpers.mjs';

const data = loadJson('data.json');
const MARK = data.mark;
const save = () => saveJson('data.json', data);
const browser = await launch();
const pages = {};
async function as(user) {
  if (pages[user]) return pages[user];
  const ctx = await ctxFor(browser, user);
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('/my-day');
  pages[user] = p;
  return p;
}
const words = 'داواکاری مۆڵەتی بیناسازی بۆ پارچەی ژمارە ٢٤٧/٥ لە گەڕەکی سەرچنار لەلایەن خاوەن موڵکەوە بە مەبەستی دروستکردنی خانووی نیشتەجێبوون و دوکانی بازرگانی'.split(' ');
const longText = n => { let s = ''; let i = 0; while (s.length < n) s += (s ? ' ' : '') + words[i++ % words.length]; return s.slice(0, n).trim(); };

if (!data.template) {
  const p = await as('aram');
  await p.goto('/templates/new');
  const labels = ['ناوی تەواوی کارمەند بە پێی ناسنامەی نیشتمانی', 'ژمارەی ڕۆژەکانی مۆڵەت', 'لە بەرواری', 'بۆ بەرواری', 'هۆکاری مۆڵەت بە وردی و بە تەواوی', 'ژووری کار', 'ناوی جێگر لە ماوەی مۆڵەتدا', 'ژمارەی مۆبایل', 'ناونیشانی ماڵ لە ماوەی مۆڵەتدا', 'تێبینی بەڕێوەبەر', 'ژمارەی فەرمان', 'ساڵی خزمەت', 'پلەی وەزیفی', 'بڕی مووچە', 'ڕەزامەندی لیژنە'];
  const types = ['text', 'number', 'date', 'date', 'textarea', 'text', 'text', 'text', 'textarea', 'textarea', 'text', 'number', 'text', 'number', 'text'];
  const fields = labels.map((l, i) => `f${i + 1} | ${l} | ${types[i]}`).join('\n');
  const body = labels.map((l, i) => `${l}: {{f${i + 1}}}`).join('\n');
  await p.fill('#name', `${MARK} فۆرمی داواکاری مۆڵەتی درێژخایەنی کارمەندانی شارەوانی بە هەموو زانیارییەکانەوە`);
  await p.fill('#category', 'داواکاری مۆڵەت');
  await p.fill('#description', longText(250));
  await p.fill('#fields', fields);
  await p.fill('#body', `بەڕێز سەرۆکی شارەوانی ڕانیە\n\n${body}\n\nلەگەڵ ڕێزدا.`);
  await p.click('.content form[action="/templates/new"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  data.template = Number(/\/templates\/(\d+)/.exec(p.url())?.[1]) || p.url();
  console.log('template', data.template); save();
}

if (!data.fill && typeof data.template === 'number') {
  const p = await as('shilan');
  await p.goto(`/templates/${data.template}`);
  const inputs = await p.$$('.content form[action^="/templates/"] [name^="f"]');
  for (const el of inputs) {
    const type = await el.getAttribute('type');
    const tag = await el.evaluate(e => e.tagName);
    if (type === 'date') await el.fill('2026-11-01');
    else if (type === 'number') await el.fill('45');
    else if (tag === 'TEXTAREA') await el.fill(longText(300));
    else await el.fill('ئەندازیار محەمەد عەبدولڕەحمان ئەحمەد مستەفا');
  }
  await p.fill('#reference', 'ه/2026/674');
  await p.click('.content form[action^="/templates/"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  data.fill = p.url(); console.log('fill', p.url()); save();
}

if (!data.tray) {
  const p = await as('shilan');
  await p.goto('/tray');
  const name = `سکانی_${MARK}_داواکاری_مۆڵەتی_بیناسازی_پارچەی_247_5_گەڕەکی_سەرچنار_2026-09-13_scan_0001_FEEDER_duplex_600dpi.pdf`;
  await p.setInputFiles('#file', { name, mimeType: 'application/pdf', buffer: inkPdf() });
  await p.click('.content form[action="/tray/upload"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  console.log('tray upload', p.url());
  const href = await p.locator(`tr:has-text("${MARK}") a[href^="/tray/"]`).first().getAttribute('href').catch(() => null);
  data.tray = href; console.log('tray', href); save();
}

if (!data.archive) {
  const p = await as('karwan');
  await p.goto('/archive/new');
  await p.setInputFiles('#file', { name: `نەخشەی_${MARK}_پارچەی_1234_56_گەڕەکی_سەرچنار_وەشانی_کۆتایی_AutoCAD_2018_layout_A1.pdf`, mimeType: 'application/pdf', buffer: inkPdf() });
  await p.fill('#plot_no', '1234/56');
  await p.fill('#block', 'B-17/ک');
  await p.fill('#neighbourhood', 'گەڕەکی سەرچناری نوێی ڕۆژهەڵاتی نزیک باخچەی گشتی');
  await p.fill('#title', `${MARK} ${longText(280)}`);
  await p.fill('#year', '2019');
  await p.fill('#owner_names', 'محەمەد عەبدولڕەحمان ئەحمەد، فاتیمە عومەر حەسەن، ئەحمەد محەمەد عەبدولڕەحمان، شیرین محەمەد عەبدولڕەحمان، هاوکار محەمەد عەبدولڕەحمان');
  await p.fill('#shelf', 'ب٣');
  await p.fill('#section', 'C-12');
  await p.fill('#box_no', '٤٥');
  await p.fill('#folder_no', '2026/0045');
  await p.click('.content form[action="/archive/new"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  data.archive = p.url(); console.log('archive', p.url()); save();
}

if (!data.leave) {
  const p = await as('sakar');
  await p.goto('/leave');
  const d = n => { const x = new Date(Date.now() + n * 86400000); return x.toISOString().slice(0, 10); };
  await p.fill('#start_date', d(60));
  await p.fill('#end_date', d(75));
  await p.fill('#note', `${MARK} ${longText(280)}`);
  await p.click('.content form[action="/leave/new"] button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  data.leave = p.url(); console.log('leave', p.url()); save();
}

if (!data.manifest) {
  const p = await as('shilan');
  await p.goto('/manifests');
  const form = p.locator(`form[action="/manifests/new"]:has(a[href="/documents/${data.docs.flow}"])`).first();
  if (await form.count()) {
    // Only my own letters go on the list.
    for (const cb of await form.locator('input[name=document_id]').all()) {
      const v = await cb.getAttribute('value');
      if (![data.docs.flow, data.docs.eight].map(String).includes(v)) await cb.uncheck();
    }
    await form.locator('input[name=courier]').fill(`${MARK} کاک ئەحمەد محەمەد عەبدولڕەحمانی گەیەنەری نووسینگەی هات و دەرچوو`);
    await form.locator('input[name=note]').fill(longText(400));
    await form.locator('button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    data.manifest = p.url(); console.log('manifest', p.url()); save();
  } else console.log('no manifest form for flow letter');
}
await browser.close();
