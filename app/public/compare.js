// The two scans on the comparison screen (/documents/:id/compare).
//
// Different from viewer.js on purpose. The viewer draws every page of one file
// down a column, which is right when a file is all you are looking at. Here two
// files are open at once in half the width each, and the question is nearly always
// about one page against one page: the request against the answer. So each side
// draws one page at a time and has its own page buttons and its own zoom, and
// neither side touches the other.
//
// Each pane keeps its own state in a closure, which is what makes two of them on
// one screen possible at all.

import * as pdfjs from '/vendor/pdfjs/pdf.min.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

const KU = n => String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function wire(host, { onZoom, onPage = null, pages = 1 }) {
  let zoom = 1;
  let page = 1;
  const label = host.querySelector('[data-cmp-page]');
  const turn = host.querySelector('[data-cmp-turn]');
  const prev = host.querySelector('[data-cmp-prev]');
  const next = host.querySelector('[data-cmp-next]');

  function say() {
    if (!label) return;
    label.textContent = pages > 1 ? `پەڕەی ${KU(page)} لە ${KU(pages)}` : (pages === 1 ? 'یەک پەڕە' : '');
  }
  function turnState() {
    if (!turn) return;
    turn.hidden = pages < 2;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pages;
  }

  host.addEventListener('click', e => {
    const z = e.target.closest('[data-cmp-zoom]');
    if (z) {
      const step = Number(z.getAttribute('data-cmp-zoom'));
      if (step === 0) zoom = 1;
      else {
        const i = ZOOMS.indexOf(zoom);
        zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i === -1 ? 2 : i) + step))];
      }
      onZoom(zoom);
      return;
    }
    if (!onPage) return;
    if (e.target.closest('[data-cmp-prev]') && page > 1) { page -= 1; }
    else if (e.target.closest('[data-cmp-next]') && page < pages) { page += 1; }
    else return;
    say(); turnState(); onPage(page);
  });

  say(); turnState();
  return { get zoom() { return zoom; }, get page() { return page; } };
}

async function renderPdf(host) {
  const paper = host.querySelector('[data-cmp-paper]');
  const label = host.querySelector('[data-cmp-page]');
  const say = t => { if (label) label.textContent = t; };

  let doc;
  try {
    doc = await pdfjs.getDocument({
      url: host.getAttribute('data-pdf-file'),
      withCredentials: true,
      httpHeaders: { 'x-docsys-viewer': '1' },
      isEvalSupported: false,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      // Same reason as the viewer: with the PDF's own fonts loaded, letters came
      // out missing on files made on a computer rather than scanned.
      disableFontFace: true,
    }).promise;
  } catch (err) {
    console.warn('[compare] could not open the PDF:', err && err.message);
    say('نەتوانرا ئەم PDFە پیشان بدرێت. دوگمەی داگرتن بەکاربهێنە.');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'cmp-canvas';
  paper.textContent = '';
  paper.appendChild(canvas);

  let generation = 0;
  let state;

  async function draw() {
    const mine = ++generation;
    const page = await doc.getPage(state ? state.page : 1);
    if (mine !== generation) return;
    const natural = page.getViewport({ scale: 1 });
    const width = Math.max(180, paper.clientWidth - 16);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / natural.width) * (state ? state.zoom : 1) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / ratio) + 'px';
    canvas.style.height = Math.floor(viewport.height / ratio) + 'px';
    try {
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (err) {
      console.warn('[compare] page did not render:', err && err.message);
    }
  }

  state = wire(host, { pages: doc.numPages, onZoom: draw, onPage: draw });
  await draw();

  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 250); });
}

function renderImage(host) {
  const img = host.querySelector('img');
  if (!img) return;
  wire(host, { pages: 1, onZoom: zoom => {
    img.style.width = (zoom * 100) + '%';
    img.style.maxWidth = zoom > 1 ? 'none' : '100%';
  } });
}

document.querySelectorAll('[data-pdf-file]').forEach(renderPdf);
document.querySelectorAll('[data-img-file]').forEach(renderImage);
