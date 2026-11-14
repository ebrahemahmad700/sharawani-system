const { chromium } = require('C:/Users/Ibrahim/Desktop/sharawani_system/app/e2e/node_modules/playwright');
const { pathToFileURL } = require('url');

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext()).newPage();
  await p.goto(pathToFileURL(process.argv[2]).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  await p.pdf({
    path: process.argv[3],
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8pt;color:#5C6B63;padding:0 14mm;font-family:Tahoma;display:flex;justify-content:space-between"><span>Rania Municipality &mdash; document system</span><span class="pageNumber"></span></div>',
  });
  await b.close();
  console.log('pdf written');
})().catch(e => { console.error(e); process.exit(1); });
