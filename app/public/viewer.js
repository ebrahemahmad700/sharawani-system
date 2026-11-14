// Drawing a PDF or a picture inside the page.
//
// Loaded only by the attachment viewer (/attachments/:id/view). A module script,
// because PDF.js is one, and it is loaded from this server like everything else.
//
// Why not just link to the PDF: a desktop browser shows it, a phone downloads it,
// and an installed copy of the application on a phone shows nothing at all. This
// draws every page onto a canvas, which every browser in the building can do.
//
// Rendering happens page by page, top to bottom, so the first page is readable
// while a thirty-page contract is still coming in.

import * as pdfjs from '/vendor/pdfjs/pdf.min.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

const KU = n => String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));

// Zoom is a multiple of "the page fills the column". 1 is the default and what
// the middle button returns to.
let zoom = 1;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function wireZoom(onChange) {
  const bar = document.querySelector('[data-viewer-zoom]');
  if (!bar) return;
  bar.hidden = false;
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    const step = Number(b.getAttribute('data-zoom'));
    if (step === 0) zoom = 1;
    else {
      const i = ZOOMS.indexOf(zoom);
      zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i === -1 ? 2 : i) + step))];
    }
    onChange();
  });
}

async function renderPdf(host) {
  const status = host.querySelector('[data-pdf-status]');
  const say = t => { if (status) status.textContent = t; };

  let doc;
  try {
    doc = await pdfjs.getDocument({
      url: host.getAttribute('data-pdf-src'),
      withCredentials: true,
      httpHeaders: { 'x-docsys-viewer': '1' },
      // The content security policy forbids eval, and PDF.js works without it.
      isEvalSupported: false,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      // Draw each letter as a path instead of loading the PDF's fonts into the
      // page. With fonts loaded, a PDF made on a computer (not a scan) came out
      // with letters missing and words run together: "This page was produced"
      // was drawn "Th s pagew as produced". Found by the browser audit of 13
      // September; with this one option the same file draws exactly.
      disableFontFace: true,
    }).promise;
  } catch (err) {
    console.warn('[viewer] could not open the PDF:', err && err.message);
    say('نەتوانرا ئەم PDFە پیشان بدرێت. دوگمەی «داگرتن» بەکاربهێنە.');
    return;
  }

  const pages = document.createElement('div');
  pages.className = 'pdf-pages';
  host.appendChild(pages);

  let generation = 0;

  async function draw() {
    const mine = ++generation;
    pages.textContent = '';
    say(doc.numPages === 1 ? 'یەک پەڕە' : `${KU(doc.numPages)} پەڕە`);

    for (let n = 1; n <= doc.numPages; n++) {
      if (mine !== generation) return;              // zoom pressed again mid-render
      const page = await doc.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const width = Math.max(200, host.clientWidth - 2);
      const cssScale = (width / natural.width) * zoom;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * ratio });

      const figure = document.createElement('figure');
      figure.className = 'pdf-page';
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / ratio) + 'px';
      canvas.style.height = Math.floor(viewport.height / ratio) + 'px';
      figure.appendChild(canvas);
      if (doc.numPages > 1) {
        const cap = document.createElement('figcaption');
        cap.textContent = `پەڕەی ${KU(n)} لە ${KU(doc.numPages)}`;
        figure.appendChild(cap);
      }
      pages.appendChild(figure);

      try {
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch (err) {
        console.warn('[viewer] page', n, 'did not render:', err && err.message);
      }
    }
  }

  wireZoom(draw);
  await draw();

  // Turning a phone round changes the column width; redraw to fit it.
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 250); });
}

function wireImage(host) {
  const img = host.querySelector('img');
  if (!img) return;
  wireZoom(() => { img.style.width = (zoom * 100) + '%'; img.style.maxWidth = zoom > 1 ? 'none' : '100%'; });
}

document.querySelectorAll('[data-pdf-src]').forEach(renderPdf);
document.querySelectorAll('[data-img-view]').forEach(wireImage);
