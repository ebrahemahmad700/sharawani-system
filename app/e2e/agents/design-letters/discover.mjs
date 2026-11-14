// Find ids for the screens to compare. Only GET requests.
import { launch, ctxFor, save, settle } from './lib.mjs';

const browser = await launch();
const out = {};
const links = (page, sel) => page.$$eval(sel, as => as.map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 60) })));

// aram: rooms in the switcher
{
  const ctx = await ctxFor(browser, 'aram');
  const p = await ctx.newPage();
  await p.goto('/inbox'); await settle(p);
  out.aramRooms = await p.$$eval('.topbar-rooms option', os => os.map(o => ({ id: o.value, name: o.textContent.trim(), sel: o.selected })));
  await ctx.close();
}

for (const u of ['hemin', 'sakar', 'shilan', 'dler']) {
  const ctx = await ctxFor(browser, u);
  const p = await ctx.newPage();
  await p.goto('/inbox'); await settle(p);
  out[u + 'Inbox'] = {
    title: await p.textContent('.topbar h1'),
    rows: await p.$$eval('.card table tbody tr', trs => trs.slice(0, 8).map(tr => ({
      href: tr.querySelector('a[href^="/documents/"]')?.getAttribute('href'),
      cells: [...tr.cells].map(c => c.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)),
    }))),
    unsent: await links(p, '.attach-list a.attach-name'),
  };
  await ctx.close();
}

{
  const ctx = await ctxFor(browser, 'shilan');
  const p = await ctx.newPage();
  await p.goto('/outgoing'); await settle(p);
  out.outgoing = await p.$$eval('.card', cards => cards.map(c => ({
    h2: c.querySelector('h2')?.textContent.trim(),
    rows: [...c.querySelectorAll('tbody tr')].slice(0, 5).map(tr => ({
      href: tr.querySelector('a[href^="/documents/"]')?.getAttribute('href'),
      cells: [...tr.cells].map(x => x.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)),
    })),
  })));
  await p.goto('/registry'); await settle(p);
  out.registry = await p.$$eval('.card tbody tr', trs => trs.map(tr => ({
    href: tr.querySelector('a[href^="/documents/"]')?.getAttribute('href'),
    status: tr.cells[4]?.textContent.trim().replace(/\s+/g, ' '),
    where: tr.cells[5]?.textContent.trim(),
  })));
  await p.goto('/manifests'); await settle(p);
  out.manifests = await links(p, 'a[href^="/manifests/"]');
  await p.goto('/tray'); await settle(p);
  out.tray = await links(p, 'a[href^="/tray/"]');
  await p.goto('/plots?p=1'); await settle(p);
  out.plots = (await links(p, 'a[href^="/plots?p="]')).slice(0, 10);
  await ctx.close();
}
for (const u of ['sakar', 'hemin', 'aram']) {
  const ctx = await ctxFor(browser, u);
  const p = await ctx.newPage();
  await p.goto('/manifests'); await settle(p);
  out[u + 'Manifests'] = (await links(p, 'a[href^="/manifests/"]')).slice(0, 10);
  await p.goto('/tray'); await settle(p);
  out[u + 'Tray'] = (await links(p, 'a[href^="/tray/"]')).slice(0, 10);
  await ctx.close();
}
save('ids.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await browser.close();
