// Creates the long and odd content the design pass needs. Every name carries MARK.
import { launch, ctxFor, saveJson, loadJson, mark as freshMark } from './lib.mjs';
import { inkPdf } from '../../tests/helpers.mjs';

const MARK = loadJson('data.json')?.mark ?? freshMark;
const data = loadJson('data.json', { mark: MARK });
data.mark = MARK;
const save = () => saveJson('data.json', data);

const browser = await launch();
const pages = {};
async function as(user) {
  if (pages[user]) return pages[user];
  const ctx = await ctxFor(browser, user);
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('/my-day').catch(() => {});
  pages[user] = p;
  return p;
}

async function post(p, url, fields) {
  return p.evaluate(async ({ url, fields }) => {
    const b = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach(x => b.append(k, x)); else b.append(k, v);
    }
    b.append('_csrf', document.body.dataset.csrf);
    const r = await fetch(url, { method: 'POST', body: b, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    return { status: r.status, url: r.url };
  }, { url, fields });
}

const words = 'داواکاری مۆڵەتی بیناسازی بۆ پارچەی ژمارە ٢٤٧/٥ لە گەڕەکی سەرچنار لەلایەن خاوەن موڵکەوە بە مەبەستی دروستکردنی خانووی نیشتەجێبوون و دوکانی بازرگانی لەسەر شەقامی سەرەکی بە پشتبەستن بە نەخشەی پەسەندکراوی ئەندازیاری و ڕەزامەندی لیژنەی پلاندانان'.split(' ');
const longText = n => { let s = ''; let i = 0; while (s.length < n) s += (s ? ' ' : '') + words[i++ % words.length]; return s.slice(0, n).trim(); };

async function register(p, { subject, sender, contact = '', plot = '', hood = '', shelf = '', section = '', folder = '', company = null, priority = 'normal' }) {
  await p.goto('/registry/new');
  await p.fill('#subject', subject);
  await p.fill('#sender_name', sender);
  if (contact) await p.fill('#sender_contact', contact);
  if (plot) await p.fill('#plot_no', plot);
  if (hood) await p.fill('#neighbourhood', hood);
  if (shelf) await p.fill('#physical_shelf', shelf);
  if (section) await p.fill('#physical_section', section);
  if (folder) await p.fill('#physical_folder', folder);
  if (company) await p.selectOption('#company_id', String(company));
  await p.selectOption('#priority', priority);
  await p.click('form[data-similar-form] > .row button[type=submit]');
  await p.waitForLoadState('domcontentloaded');
  if (!/\/documents\/\d+/.test(p.url()) && await p.locator('input[name="confirm_similar"]').count()) {
    await p.click('form[data-similar-form] > .row button[type=submit]');
  }
  await p.waitForURL(/\/documents\/\d+/, { timeout: 20000 });
  return Number(/\/documents\/(\d+)/.exec(p.url())[1]);
}

const step = process.argv[2] || 'all';
const shilan = await as('shilan');

// Room ids from the send form.
if (!data.rooms) {
  await shilan.goto('/registry/new');
  const anyDoc = await register(shilan, { subject: `${MARK} نموونەی ژوورەکان`, sender: `${MARK} نێردەر` });
  await shilan.goto(`/documents/${anyDoc}`);
  data.rooms = await shilan.$$eval('#to_room option', os => os.filter(o => o.value).map(o => ({ id: Number(o.value), name: o.textContent.trim() })));
  data.docs = { roomsProbe: anyDoc };
  save();
}
const room = re => data.rooms.find(r => re.test(r.name))?.id;
console.log(data.rooms.map(r => `${r.id}:${r.name}`).join(' | '));

if (!data.company) {
  await shilan.goto('/companies/new');
  const fill = async (n, v) => { if (await shilan.locator(`[name="${n}"]`).count()) await shilan.fill(`[name="${n}"]`, v); };
  await fill('name', `${MARK} کۆمپانیای ئاسۆی نوێ بۆ بیناسازی و بازرگانی گشتی و وەبەرهێنانی خانووبەرە و ڕێگاوبان و پردەکان سنووردار`);
  await fill('legal_name', `${MARK} Asoy Nwe General Construction, Trading, Real-Estate Investment, Roads and Bridges Company Limited (LLC)`);
  await fill('registration_no', `REG-${MARK}-2026-000123456789`);
  await fill('tax_no', 'TAX-IQ-KRG-0000987654321');
  await fill('representative', 'ئەندازیار محەمەد عەبدولڕەحمان ئەحمەد مستەفا حەمە ئەمین کەریم ڕەسووڵ');
  await fill('phone', '+964 750 123 4567 / +964 770 987 6543');
  await fill('email', `procurement.department.${MARK.toLowerCase()}@asoy-nwe-construction-company.example.com`);
  await fill('capital', '٢٥٠٬٠٠٠٬٠٠٠ دینار');
  await fill('address', longText(290));
  await fill('note', longText(900));
  await shilan.click('.content form[action="/companies/new"] button[type=submit]');
  await shilan.waitForLoadState('domcontentloaded');
  data.company = Number(/\/companies\/(\d+)/.exec(shilan.url())?.[1]) || shilan.url();
  save();
  console.log('company', data.company, shilan.url());
}

if (!data.docs.registered) {
  data.docs.registered = await register(shilan, {
    subject: `${MARK} ${longText(400 - MARK.length - 1)}`,
    sender: `${MARK} ${longText(200 - MARK.length - 1)}`,
    contact: '0750 123 4567 — rania.citizen.long.email.address@example.com',
    plot: '2٤7/5', hood: 'گەڕەکی سەرچناری نوێی ڕۆژهەڵاتی نزیک باخچەی گشتی و قوتابخانەی ئامادەیی کوڕانی ڕانیە',
    shelf: 'ب٣', section: 'C-12', folder: '٤٥/2026',
    company: typeof data.company === 'number' ? data.company : null, priority: 'very_urgent',
  });
  save();
}

if (!data.docs.flow) {
  data.docs.flow = await register(shilan, {
    subject: `${MARK} داواکاری بە ژمارەی سەرچاوە REF-2026-000123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-ڕانیە بۆ پشکنین`,
    sender: `${MARK} Rania_Construction_Company_International_Branch_Office_No_7`,
    contact: 'info@rania-construction-international.example.com', priority: 'urgent',
  });
  const r = await post(shilan, `/documents/${data.docs.flow}/route`, { mode: 'single', to_room_id: room(/یاسا/), note: longText(480) });
  console.log('flow route', r);
  save();
}

if (!data.docs.ready) {
  data.docs.ready = await register(shilan, { subject: `${MARK} ئامادەی داخستن — وەڵامی یاسایی`, sender: `${MARK} هاووڵاتی` });
  console.log(await post(shilan, `/documents/${data.docs.ready}/route`, { mode: 'single', to_room_id: room(/یاسا/), note: 'تکایە بیروڕای یاسایی بنووسن.' }));
  const hemin = await as('hemin');
  await hemin.goto(`/documents/${data.docs.ready}`);
  console.log(await post(hemin, `/documents/${data.docs.ready}/complete`, { action: 'opinion', reply_note: longText(600) }));
  save();
}

if (!data.docs.closed) {
  data.docs.closed = await register(shilan, { subject: `${MARK} داخراو — داواکاری مۆڵەتی بیناسازی`, sender: `${MARK} هاووڵاتی دووەم`, plot: '247/5' });
  console.log(await post(shilan, `/documents/${data.docs.closed}/route`, { mode: 'single', to_room_id: room(/یاسا/) }));
  const hemin = await as('hemin');
  await hemin.goto(`/documents/${data.docs.closed}`);
  console.log(await post(hemin, `/documents/${data.docs.closed}/complete`, { action: 'approved', reply_note: 'ڕەزامەندی دەدرێت.' }));
  console.log(await post(shilan, `/documents/${data.docs.closed}/close`, {
    recipient: `${MARK} بەڕێز محەمەد عەبدولڕەحمان ئەحمەد — خاوەنی پارچەی 247/5 لە گەڕەکی سەرچنار، ڕانیە`,
    summary: `${longText(700)}\n\nهێڵی دووەم: ژمارەی سەرچاوە REF-2026-000123456789.`, channel: 'whatsapp',
  }));
  save();
}

if (!data.docs.cancelled) {
  data.docs.cancelled = await register(shilan, { subject: `${MARK} هەڵوەشێنراوە — دووجار تۆمارکرا`, sender: `${MARK} هاووڵاتی سێیەم` });
  console.log(await post(shilan, `/documents/${data.docs.cancelled}/cancel`, { reason: `دووجار تۆمارکرا. ${longText(500)}` }));
  save();
}

if (!data.docs.eight) {
  data.docs.eight = await register(shilan, { subject: `${MARK} ڕێڕەوی هەشت ژوور و تێبینی زۆر`, sender: `${MARK} لیژنەی پلاندانان`, plot: '1234/56-ب' });
  const ids = [/یاسا/, /گرێبەست/, /زەوی/, /ژمێریاری/, /کارگێڕی/, /بنەڕەتی.*٨|\(٨\)/, /بنەڕەتی.*٩|\(٩\)/, /سەرۆک/].map(room).filter(Boolean);
  console.log('eight rooms', ids);
  console.log(await post(shilan, `/documents/${data.docs.eight}/route`, { mode: 'sequence', seq_room: ids, return_to_assigner: '1', note: 'بە ڕیزبەندی بە هەموو ژوورەکاندا بڕوات.' }));
  save();
}

if (!data.notesDone) {
  for (let i = 1; i <= 24; i++) {
    const body = i % 5 === 0 ? longText(1500) : i % 7 === 0 ? `پەیوەندی کرا بە 0750 123 4567 و ئیمەیڵی citizen.${i}@example.com — ژمارەی کتاب ه/2026/${500 + i}` : `تێبینی ژمارە ${i}: ${longText(60 + i * 8)}`;
    await post(shilan, `/documents/${data.docs.eight}/notes`, { body });
  }
  data.notesDone = true; save();
}

if (!data.attachDone) {
  await shilan.goto(`/documents/${data.docs.eight}`);
  const name = 'ڕاپۆرتی_پشکنینی_پارچەی_1234_56_گەڕەکی_سەرچنار_بۆ_لیژنەی_یاسایی_و_گرێبەستەکان_وەشانی_کۆتایی_2026-09-13_v17_FINAL_signed_scanned_copy_high_resolution.pdf';
  const form = shilan.locator('form.attach-upload');
  await form.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer: inkPdf() });
  await form.locator('button[type=submit]').click();
  await shilan.waitForLoadState('domcontentloaded');
  console.log('attach', shilan.url());
  data.attachDone = true; save();
}

// Complete the first three steps of the eight-room letter.
if (!data.eightSteps) {
  for (const u of ['hemin', 'dler', 'hersh']) {
    const p = await as(u);
    await p.goto(`/documents/${data.docs.eight}`);
    const r = await post(p, `/documents/${data.docs.eight}/complete`, { action: u === 'dler' ? 'rejected' : 'opinion', reply_note: `${u}: ${longText(250)}` });
    console.log('complete', u, r);
  }
  data.eightSteps = true; save();
}

console.log(JSON.stringify(data.docs));
await browser.close();
