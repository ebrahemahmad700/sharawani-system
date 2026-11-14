import { launch, signIn, registerLetter, get, post, tag, short } from './lib.mjs';

const browser = await launch();
const log = (...a) => console.log(a.join(' '));
const M = tag();
const IMG = `<img src=x onerror="alert(1)">`;
const SVG = `"><svg onload=alert(2)>`;
const TPL = `{{7*7}}`;
const PAY = `${IMG}${SVG}${TPL}`;

// Check a rendered page: is the payload present RAW (executable markup) or escaped?
function verdict(html) {
  const rawImg = html.includes('<img src=x onerror');
  const rawSvg = html.includes('<svg onload=alert');
  const escImg = html.includes('&lt;img src=x onerror');
  const tplEvaluated = html.includes('49') && !html.includes(TPL);   // heuristic: 7*7 rendered as 49
  return `raw_img=${rawImg} raw_svg=${rawSvg} escaped=${escImg} tmpl_49=${tplEvaluated}`;
}

const shilan = await signIn(browser, 'shilan');
const bafrin = await signIn(browser, 'bafrin');
const it     = await signIn(browser, 'itadmin');

log('===== 5. STORED XSS across fields =====');

// (a) note body on own doc
const { id } = await registerLetter(shilan.page, { subject: `xss ${M}`, sender: `s ${M}` });
await post(shilan, `/documents/${id}/notes`, { _csrf: shilan.csrf, body: `NOTE ${PAY} ${M}` });
let h = await (await get(shilan, `/documents/${id}`)).text();
log('  note body on doc page      :', verdict(h.slice(h.indexOf('NOTE'), h.indexOf('NOTE')+200) || h));

// (b) reply body -> outgoing_summary, on doc page + reply/print
await post(shilan, `/documents/${id}/reply`, { _csrf: shilan.csrf, recipient: `R ${M}`, body: `REPLY ${PAY} ${M}` });
h = await (await get(shilan, `/documents/${id}`)).text();
log('  reply summary on doc page  :', verdict(h.slice(Math.max(0,h.indexOf('REPLY')-20), h.indexOf('REPLY')+200) || h));
const rp = await get(shilan, `/documents/${id}/reply/print`);
const rpt = rp.status() === 200 ? await rp.text() : '';
log('  reply/print status', rp.status(), ':', rpt ? verdict(rpt.slice(Math.max(0,rpt.indexOf('REPLY')-20), rpt.indexOf('REPLY')+200)) : '(no body)');

// (c) company name + note
const nc = await post(shilan, '/companies/new', { _csrf: shilan.csrf, name: `CO ${PAY} ${M}`, note: `N ${PAY}`, address: PAY });
const cid = /\/companies\/(\d+)/.exec(nc.headers?.()['location'] || '')?.[1];
if (cid) { h = await (await get(shilan, `/companies/${cid}`)).text(); log('  company name/note page     :', verdict(h)); }
else log('  company create =>', nc.status?.(), nc.headers?.()['location']);

// (d) leave note (start >= 30 days ahead per rules)
const d = new Date(Date.now() + 45*86400000).toISOString().slice(0,10);
const d2 = new Date(Date.now() + 46*86400000).toISOString().slice(0,10);
await post(shilan, '/leave/new', { _csrf: shilan.csrf, leave_type:'annual', start_date:d, end_date:d2, note:`LEAVE ${PAY} ${M}` });
h = await (await get(shilan, '/leave')).text();
log('  leave note on /leave       :', h.includes(M) ? verdict(h.slice(h.indexOf('LEAVE'), h.indexOf('LEAVE')+200)) : '(note not shown to self)');

// (e) doc-type name (shilan is EDITOR). Parse a valid base_kind from the form.
const dtForm = await (await get(shilan, '/admin/doc-types')).text();
const bk = /name="base_kind"[\s\S]*?<option value="([^"]+)"/.exec(dtForm)?.[1] || 'other';
const code = ('SEC' + M).replace(/[^A-Z0-9_]/gi,'').toUpperCase().slice(0,16);
const dt = await post(shilan, '/admin/doc-types', { _csrf: shilan.csrf, code, name:`DT ${PAY} ${M}`, base_kind: bk, default_due_days:'3' });
h = await (await get(shilan, '/admin/doc-types')).text();
log('  doc-type name page (bk='+bk+') =>', dt.status?.(), ':', h.includes(M) ? verdict(h.slice(h.indexOf('DT '), h.indexOf('DT ')+200)) : '(not created / not shown)');

// (f) room name (itadmin creates), shown on /admin/rooms
const rc = await post(it, '/admin/rooms', { _csrf: it.csrf, name:`RM ${PAY} ${M}`, code:('R'+M).replace(/[^A-Z0-9_]/gi,'').toUpperCase().slice(0,16), default_due_days:'3' });
h = await (await get(it, '/admin/rooms')).text();
log('  room name on /admin/rooms  =>', rc.status?.(), ':', h.includes(M) ? verdict(h.slice(h.indexOf('RM '), h.indexOf('RM ')+200)) : '(not created / not shown)');

log('\n===== 5b. RAW template body (AUTHORS) rendered on /fills/:id/print =====');
{
  const tname = `TPLX ${M}`;
  const body = `HELLO ${IMG}<script>window.__x=1</script> {{who}}`;
  const cr = await post(bafrin, '/templates/new', { _csrf: bafrin.csrf, name: tname, category:`cat ${M}`, fields:'who | Who | text', body });
  const tid = /\/templates\/(\d+)/.exec(cr.headers?.()['location'] || '')?.[1];
  log('  template create =>', cr.status?.(), 'tid', tid);
  if (tid) {
    const fr = await post(bafrin, `/templates/${tid}`, { _csrf: bafrin.csrf, who: `X ${M}` });
    const fid = /\/fills\/(\d+)/.exec(fr.headers?.()['location'] || '')?.[1];
    if (fid) {
      const pr = await get(bafrin, `/fills/${fid}/print`);
      const body2 = await pr.text();
      const csp = pr.headers()['content-security-policy'] ? 'present' : 'MISSING';
      log('  /fills/'+fid+'/print: raw <img?', body2.includes('<img src=x onerror'),
          ' raw <script>?', body2.includes('<script>window.__x=1'),
          ' filled value escaped?', body2.includes('X '+M), ' CSP header:', csp);
    }
  }
}

log('\n===== 5c. Reflected ?ok= / ?error= =====');
for (const [who, s, path] of [
  ['shilan', shilan, `/documents/${id}?error=${encodeURIComponent(PAY)}`],
  ['itadmin', it, `/admin/rooms?error=${encodeURIComponent(PAY)}`],
  ['shilan', shilan, `/documents/${id}?ok=${encodeURIComponent(PAY)}`],
]) {
  const r = await get(s, path);
  const t = await r.text();
  log(`  ${path.split('?')[0]} ?${path.split('?')[1].split('=')[0]}= :`, verdict(t.slice(t.indexOf('notice'), t.indexOf('notice')+300)));
}

log('\n===== 5d. chase "back" open redirect =====');
for (const back of ['https://evil.example/x', '//evil.example', '/my-day', 'javascript:alert(1)']) {
  const r = await post(shilan, `/documents/${id}/chase`, { _csrf: shilan.csrf, back, note: 'x' });
  log(`  back=${JSON.stringify(back).padEnd(24)} => ${r.status?.()} Location: ${r.headers?.()['location']}`);
}

// cleanup: deactivate the room I created (no routing steps yet)
const roomsHtml = await (await get(it, '/admin/rooms')).text();
const near = roomsHtml.slice(roomsHtml.indexOf('RM '), roomsHtml.indexOf('RM ')+3000);
const rid = /\/admin\/rooms\/(\d+)\/deactivate/.exec(near)?.[1];
if (rid) { const dr = await post(it, `/admin/rooms/${rid}/deactivate`, { _csrf: it.csrf }); log('\n  cleanup: deactivated my test room', rid, '=>', dr.status?.()); }

await browser.close();
log('\n----DONE----');
