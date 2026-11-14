// Placing the arrival or dispatch mark on a scan (/attachments/:id/stamp).
//
// The clerk sees the page and a small mark lying on it, drags the mark where the
// rubber stamp would go, and presses the button. Nothing is sent until then.
//
// What goes to the server is one transparent PNG the size of the page with only
// the mark drawn on it, exactly where it sits on screen. The server lays that
// sheet over the page (lib/margin.mjs), which is the same path the handwritten
// instruction takes. Drawing here rather than on the server is not a shortcut:
// Kurdish letters are only joined correctly by a text engine, and the browser has
// one.
//
// The mark on screen and the mark in the file are the same object measured twice:
// its position and size are read as fractions of the page, so what the clerk put
// in the corner lands in the corner, at any zoom and on any paper size.

import * as pdfjs from '/vendor/pdfjs/pdf.min.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

const KU = n => String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
const EXPORT_WIDTH = 1600;

const form = document.querySelector('[data-stamp]');
if (form) start(form);

function start(form) {
  const stage = form.querySelector('[data-stage]');
  const canvas = form.querySelector('[data-page-canvas]');
  const mark = form.querySelector('[data-mark]');
  const wordEl = form.querySelector('[data-mark-word]');
  const noEl = form.querySelector('[data-mark-no]');
  const subEl = form.querySelector('[data-mark-sub]');
  const pageField = form.querySelector('[data-page-field]');
  const kindField = form.querySelector('[data-kind-field]');
  const pageLabel = form.querySelector('[data-page-label]');
  const turn = form.querySelector('[data-turn]');
  const sendBtn = form.querySelector('[data-send]');
  const sendHint = form.querySelector('[data-send-hint]');
  const errorBox = form.querySelector('[data-error]');

  const d = form.dataset;
  const COLOURS = { incoming: '#1f3f9c', outgoing: '#15503A' };

  // Where the mark sits and how big it is, as fractions of the page. The default
  // is the top left corner, which is where the free space on a Kurdish letter is.
  let pos = { x: 0.06, y: 0.05 };
  let scale = 0.75;                 // one of the three size buttons
  let pageNo = 1;
  let pages = 1;
  let aspect = 1.414;               // height ÷ width, until the page is read
  let doc = null;
  let ready = false;

  // --- what the mark says ----------------------------------------------------

  function kind() { return kindField.value === 'outgoing' ? 'outgoing' : 'incoming'; }

  function lines() {
    const out = kind() === 'outgoing';
    const no = out ? d.outgoing : d.incoming;
    const when = out ? (d.outgoingDate || '') : (d.incomingDate || '');
    const tail = out ? (d.verify ? `کۆد ${d.verify}` : '') : (d.barcode ? KU(d.barcode) : '');
    return {
      word: out ? 'دەرچوو' : 'هاتوو',
      no: no || '',
      sub: [when, tail].filter(Boolean).join(' · '),
    };
  }

  function paint() {
    const l = lines();
    wordEl.textContent = l.word;
    noEl.textContent = l.no;
    subEl.textContent = l.sub;
    mark.style.setProperty('--stamp-ink', COLOURS[kind()]);
  }

  // --- sizes and placement ---------------------------------------------------

  function layout() {
    const w = Math.max(220, stage.clientWidth);
    const h = Math.round(w * aspect);
    stage.style.height = h + 'px';
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    // The mark is sized in the page's own units, so it keeps its proportion when
    // the window changes and when it is drawn into the file.
    mark.style.width = (w * 0.30 * scale) + 'px';
    mark.style.fontSize = (w / 100 * 2.1 * scale) + 'px';
    place();
    return { w, h, ratio };
  }

  function place() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const mw = mark.offsetWidth;
    const mh = mark.offsetHeight;
    // Never off the paper: the mark has to be on the page it claims to be on.
    pos.x = Math.min(Math.max(pos.x, 0), Math.max(0, 1 - mw / w));
    pos.y = Math.min(Math.max(pos.y, 0), Math.max(0, 1 - mh / h));
    mark.style.left = (pos.x * w) + 'px';
    mark.style.top = (pos.y * h) + 'px';
  }

  // --- dragging --------------------------------------------------------------

  let drag = null;
  mark.addEventListener('pointerdown', e => {
    const r = mark.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    mark.setPointerCapture(e.pointerId);
    mark.classList.add('moving');
    e.preventDefault();
  });
  mark.addEventListener('pointermove', e => {
    if (!drag) return;
    const s = stage.getBoundingClientRect();
    pos.x = (e.clientX - drag.dx - s.left) / s.width;
    pos.y = (e.clientY - drag.dy - s.top) / s.height;
    place();
  });
  const endDrag = () => { drag = null; mark.classList.remove('moving'); };
  mark.addEventListener('pointerup', endDrag);
  mark.addEventListener('pointercancel', endDrag);

  mark.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.002 : 0.01;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by) return;
    pos.x += by[0];
    pos.y += by[1];
    place();
    e.preventDefault();
  });

  // --- the controls ----------------------------------------------------------

  form.addEventListener('click', e => {
    const size = e.target.closest('[data-size]');
    if (size) {
      scale = Number(size.getAttribute('data-size'));
      for (const b of form.querySelectorAll('[data-size]')) b.classList.toggle('chosen', b === size);
      layout();
      return;
    }
    if (e.target.closest('[data-prev]') && pageNo > 1) { pageNo -= 1; draw(); }
    else if (e.target.closest('[data-next]') && pageNo < pages) { pageNo += 1; draw(); }
  });

  for (const radio of form.querySelectorAll('input[name="kind_choice"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      kindField.value = radio.value;
      paint();
      layout();
    });
  }

  // --- the page underneath ---------------------------------------------------

  async function openFile() {
    if (d.type === 'pdf') {
      doc = await pdfjs.getDocument({
        url: d.file,
        withCredentials: true,
        httpHeaders: { 'x-docsys-viewer': '1' },
        isEvalSupported: false,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        disableFontFace: true,
      }).promise;
      pages = doc.numPages;
      const first = await doc.getPage(1);
      const v = first.getViewport({ scale: 1 });
      aspect = v.height / v.width;
    } else {
      doc = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = d.file;
      });
      aspect = doc.naturalHeight / doc.naturalWidth;
      pages = 1;
    }
  }

  async function draw() {
    const { w, h, ratio } = layout();
    pageField.value = String(pageNo);
    if (pageLabel) pageLabel.textContent = pages > 1 ? `پەڕەی ${KU(pageNo)} لە ${KU(pages)}` : 'یەک پەڕە';
    if (turn) turn.hidden = pages < 2;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (d.type === 'pdf') {
      const page = await doc.getPage(pageNo);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (w / natural.width) * ratio });
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else {
      ctx.drawImage(doc, 0, 0, w * ratio, h * ratio);
    }
  }

  // --- drawing the mark into the file ---------------------------------------

  async function fontsReady() {
    try { await document.fonts.ready; } catch { /* a browser without the API draws anyway */ }
  }

  async function exportMark() {
    await fontsReady();
    const w = EXPORT_WIDTH;
    const h = Math.round(w * aspect);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    // The same rectangle as on screen, measured as fractions of the stage.
    const s = stage.getBoundingClientRect();
    const r = mark.getBoundingClientRect();
    const k = w / s.width;                       // screen pixels → file pixels
    const x = (r.left - s.left) * k;
    const y = (r.top - s.top) * k;
    const boxW = r.width * k;
    const boxH = r.height * k;
    const ink = COLOURS[kind()];
    const l = lines();
    const u = boxW / 100;                        // one unit of the mark's own width

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.86)';
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, 1.6 * u);
    const rad = 3 * u;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, rad);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, rad);
    ctx.arcTo(x, y + boxH, x, y, rad);
    ctx.arcTo(x, y, x + boxW, y, rad);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const right = x + boxW - 5 * u;
    ctx.fillStyle = ink;
    ctx.font = `700 ${boxH * 0.26}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillText(l.word, right, y + boxH * 0.33);
    ctx.font = `700 ${boxH * 0.24}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillStyle = '#16241D';
    ctx.fillText(l.no, right, y + boxH * 0.62);
    if (l.sub) {
      ctx.font = `400 ${boxH * 0.17}px Vazirmatn, Tahoma, sans-serif`;
      ctx.fillStyle = '#5C6B63';
      ctx.fillText(l.sub, right, y + boxH * 0.87);
    }
    ctx.restore();

    return new Promise(resolve => c.toBlob(resolve, 'image/png'));
  }

  // --- sending ---------------------------------------------------------------

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sendBtn.disabled) return;
    errorBox.hidden = true;
    sendBtn.disabled = true;
    const label = sendBtn.textContent;
    sendBtn.textContent = 'مۆر دەدرێت…';
    try {
      const png = await exportMark();
      const body = new FormData();
      body.append('_csrf', form.querySelector('input[name="_csrf"]').value);
      body.append('kind', kind());
      body.append('page_no', String(pageNo));
      body.append('ink', png, 'stamp.png');
      const res = await fetch(form.action, { method: 'POST', body, headers: { accept: 'application/json' } });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.location) { window.location.href = out.location; return; }
      throw new Error(out.error || 'مۆرکردن سەرنەکەوت. دووبارە هەوڵبدەوە.');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = label;
    }
  });

  // --- start -----------------------------------------------------------------

  (async () => {
    paint();
    layout();
    try {
      await openFile();
      await draw();
      ready = true;
      sendBtn.disabled = false;
      sendHint.textContent = 'مۆرەکە لە شوێنی خۆی دابنێ، ئینجا مۆرکردن.';
      for (const b of form.querySelectorAll('[data-size]')) {
        if (Number(b.getAttribute('data-size')) === scale) b.classList.add('chosen');
      }
    } catch (err) {
      console.warn('[stamp] could not open the scan:', err && err.message);
      sendHint.textContent = '';
      errorBox.textContent = 'ئەم سکانە نەکرایەوە. فایلەکە لە پەڕەی کتابەوە بپشکنە.';
      errorBox.hidden = false;
    }
  })();

  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (ready) draw(); }, 250);
  });
}
