// Writing the هامش on a letter. Loaded only by /documents/:id/margin.
//
// Two canvases in one frame: the letter's page underneath, drawn by PDF.js (or
// the photograph, or a white sheet with the letter's heading), and a clear one on
// top that takes the pen. Strokes are kept as points relative to the page, so the
// page can be redrawn at any width, a phone turned sideways or a tablet, and the
// ink stays where it was written.
//
// Sending draws the ink once more at a fixed resolution, adds the stamp (who, in
// what role, and when, by the server's clock), and posts it as a PNG. The server
// lays that onto the page of the PDF (src/lib/margin.mjs) and sends the letter.
//
// A pen on a tablet: pressure changes the width, and once a pen has touched the
// glass a resting palm is ignored.

import * as pdfjs from '/vendor/pdfjs/pdf.min.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

const KU = s => String(s).replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
const A4_ASPECT = 841.89 / 595.28;
const EXPORT_WIDTH = 1600;

const form = document.querySelector('[data-margin]');
if (form) start(form);

function start(form) {
  const stage = form.querySelector('[data-stage]');
  const pageCanvas = form.querySelector('[data-page-canvas]');
  const inkCanvas = form.querySelector('[data-ink-canvas]');
  const status = form.querySelector('[data-status]');
  const source = form.querySelector('#source');
  const pagesBox = form.querySelector('[data-pages]');
  const pageLabel = form.querySelector('[data-page-label]');
  const undoBtn = form.querySelector('[data-undo]');
  const clearBtn = form.querySelector('[data-clear]');
  const sendBtn = form.querySelector('[data-send]');
  const sendHint = form.querySelector('[data-send-hint]');
  const errorBox = form.querySelector('[data-error]');
  const roomsField = form.querySelector('input[name="rooms"]');
  const pageField = form.querySelector('input[name="page_no"]');

  const serverOffset = new Date(form.dataset.serverNow).getTime() - Date.now();
  const say = t => { status.textContent = t; status.hidden = !t; };

  let ink = form.querySelector('[data-ink]').dataset.ink;
  let width = 3.5;
  let strokes = [];
  let current = null;
  let penSeen = false;
  let aspect = A4_ASPECT;
  let pdf = null;
  let pageNo = 1;
  let image = null;
  let blank = false;
  let generation = 0;
  // No ink until the page underneath has been drawn: strokes are kept relative
  // to the page, and a stroke made on the empty frame before the scan arrived
  // landed somewhere else once it did.
  let ready = false;
  const chosenRooms = [];

  // --- the stamp -------------------------------------------------------------

  const stamp = document.createElement('div');
  stamp.className = 'margin-stamp-preview';
  stamp.setAttribute('aria-hidden', 'true');
  stage.appendChild(stamp);

  function stampLines() {
    const now = new Date(Date.now() + serverOffset);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value]));
    return [
      form.dataset.stampTitle,
      form.dataset.stampName,
      KU(`${parts.year}/${parts.month}/${parts.day}  ${parts.hour}:${parts.minute}`),
    ];
  }
  function paintStampPreview() {
    const [title, name, when] = stampLines();
    stamp.innerHTML = '';
    for (const [cls, text] of [['t', title], ['n', name], ['w', when]]) {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      stamp.appendChild(div);
    }
  }
  paintStampPreview();
  setInterval(paintStampPreview, 20000);

  // --- sizes -----------------------------------------------------------------

  function layout() {
    const w = Math.max(240, stage.clientWidth);
    const h = Math.round(w * aspect);
    const ratio = window.devicePixelRatio || 1;
    for (const c of [pageCanvas, inkCanvas]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.width = Math.round(w * ratio);
      c.height = Math.round(h * ratio);
    }
    stage.style.height = h + 'px';
    // The preview stamp is sized with the page, as the real one will be.
    stamp.style.fontSize = (w / 100 * 2.05) + 'px';
    return { w, h, ratio };
  }

  // --- the page underneath ---------------------------------------------------

  async function loadSource() {
    const mine = ++generation;
    ready = false;
    pdf = null; image = null; blank = false; pageNo = 1; pageField.value = '1';
    pagesBox.hidden = true;
    const opt = source.selectedOptions[0];
    const id = opt ? opt.value : '';
    const type = opt ? opt.dataset.type : '';
    say('کتابەکە دەکرێتەوە…');
    try {
      if (!id) {
        blank = true;
        aspect = A4_ASPECT;
      } else if (type === 'application/pdf') {
        const doc = await pdfjs.getDocument({
          url: `/attachments/${id}`, withCredentials: true, httpHeaders: { 'x-docsys-viewer': '1' },
          isEvalSupported: false, disableFontFace: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        }).promise;
        if (mine !== generation) return;
        pdf = doc;
        if (doc.numPages > 1) pagesBox.hidden = false;
      } else {
        image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `/attachments/${id}`;
        });
        if (mine !== generation) return;
        aspect = image.naturalHeight / image.naturalWidth;
      }
      await drawPage();
      if (mine === generation) ready = true;
      say('');
    } catch (err) {
      console.warn('[margin] could not open the scan:', err && err.message);
      say('نەتوانرا ئەم سکانە پیشان بدرێت. پەڕەی سپی هەڵبژێرە یان سکانێکی تر.');
    }
  }

  async function drawPage() {
    if (pdf) {
      const page = await pdf.getPage(pageNo);
      const natural = page.getViewport({ scale: 1 });
      aspect = natural.height / natural.width;
      const { w, ratio } = layout();
      const viewport = page.getViewport({ scale: (w / natural.width) * ratio });
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pageLabel.textContent = `پەڕەی ${KU(pageNo)} لە ${KU(pdf.numPages)}`;
    } else {
      layout();
      const ctx = pageCanvas.getContext('2d');
      if (image) {
        ctx.drawImage(image, 0, 0, pageCanvas.width, pageCanvas.height);
      } else {
        await paintBlank(ctx, pageCanvas.width, pageCanvas.height);
      }
    }
    redrawInk();
  }

  // A white sheet with the letter's heading, for a letter that has no scan.
  async function paintBlank(ctx, w, h) {
    await fontsReady();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    const u = w / 100;
    ctx.fillStyle = '#0E3A28';
    ctx.fillRect(6 * u, 14.2 * u, 88 * u, 0.35 * u);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#16241D';
    ctx.font = `600 ${3.4 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillText('شارەوانی ڕانیە', 94 * u, 8 * u);
    ctx.font = `400 ${2.2 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillStyle = '#5C6B63';
    ctx.fillText(`کتابی ژمارە ${form.dataset.letterNo}  ·  ${form.dataset.letterDate}`, 94 * u, 11.5 * u);
    ctx.fillStyle = '#16241D';
    ctx.font = `600 ${2.6 * u}px Vazirmatn, Tahoma, sans-serif`;
    wrap(ctx, `ب/ ${form.dataset.letterSubject}`, 94 * u, 19 * u, 88 * u, 3.8 * u, 3);
    ctx.font = `400 ${2.2 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillStyle = '#5C6B63';
    ctx.fillText(`لە: ${form.dataset.letterSender}`, 94 * u, 31 * u);
  }

  function wrap(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = text.split(/\s+/);
    let line = '';
    let lines = 0;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y + lines * lineHeight);
        line = word;
        if (++lines >= maxLines) return;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y + lines * lineHeight);
  }

  async function fontsReady() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.race([
        Promise.all([document.fonts.load('600 20px Vazirmatn'), document.fonts.load('400 20px Vazirmatn')]),
        new Promise(r => setTimeout(r, 1500)),
      ]);
    } catch { /* the fallback face is fine */ }
  }

  // --- the pen ---------------------------------------------------------------

  function drawStroke(ctx, s, w, h) {
    const pts = s.points;
    if (!pts.length) return;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const base = s.width * w;
    const wid = p => base * (s.pressure ? 0.45 + p * 1.1 : 1);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * w, pts[0][1] * h, wid(pts[0][2]) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Through the midpoints, so the line is a curve and not a row of corners.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const prevMid = i === 1 ? a : [(pts[i - 2][0] + a[0]) / 2, (pts[i - 2][1] + a[1]) / 2];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.lineWidth = wid((a[2] + b[2]) / 2);
      ctx.beginPath();
      ctx.moveTo(prevMid[0] * w, prevMid[1] * h);
      ctx.quadraticCurveTo(a[0] * w, a[1] * h, mid[0] * w, mid[1] * h);
      if (i === pts.length - 1) ctx.lineTo(b[0] * w, b[1] * h);
      ctx.stroke();
    }
  }

  function redrawInk() {
    const ctx = inkCanvas.getContext('2d');
    ctx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    for (const s of strokes) drawStroke(ctx, s, inkCanvas.width, inkCanvas.height);
    if (current) drawStroke(ctx, current, inkCanvas.width, inkCanvas.height);
  }

  function point(e) {
    const r = inkCanvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [x, y, p];
  }

  inkCanvas.addEventListener('pointerdown', e => {
    if (!ready) return;
    if (e.pointerType === 'pen') penSeen = true;
    else if (e.pointerType === 'touch' && penSeen) return;   // a palm resting while writing
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    inkCanvas.setPointerCapture(e.pointerId);
    const cssWidth = inkCanvas.getBoundingClientRect().width;
    current = { color: ink, width: width / cssWidth, pressure: e.pointerType === 'pen', points: [point(e)], pointerId: e.pointerId };
    redrawInk();
  });

  inkCanvas.addEventListener('pointermove', e => {
    if (!current || e.pointerId !== current.pointerId) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) current.points.push(point(ev));
    redrawInk();
  });

  function finish(e) {
    if (!current || e.pointerId !== current.pointerId) return;
    delete current.pointerId;
    strokes.push(current);
    current = null;
    redrawInk();
    refresh();
  }
  inkCanvas.addEventListener('pointerup', finish);
  inkCanvas.addEventListener('pointercancel', finish);

  // --- tools -----------------------------------------------------------------

  function choose(group, attr, set) {
    form.querySelectorAll(`[${attr}]`).forEach(b => {
      b.addEventListener('click', () => {
        form.querySelectorAll(`[${attr}]`).forEach(x => x.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        set(b.getAttribute(attr));
      });
    });
  }
  choose('ink', 'data-ink', v => { ink = v; });
  choose('width', 'data-width', v => { width = Number(v); });

  undoBtn.addEventListener('click', () => { strokes.pop(); redrawInk(); refresh(); });
  clearBtn.addEventListener('click', () => {
    if (!strokes.length || !window.confirm('هەموو نووسینەکە بسڕدرێتەوە؟')) return;
    strokes = []; redrawInk(); refresh();
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && strokes.length
        && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); strokes.pop(); redrawInk(); refresh();
    }
  });

  function leavePage(then) {
    if (strokes.length && !window.confirm('نووسینی سەر ئەم پەڕەیە دەسڕدرێتەوە. بەردەوام بیت؟')) return false;
    strokes = [];
    then();
    refresh();
    return true;
  }

  let lastSource = source.value;
  source.addEventListener('change', () => {
    if (!leavePage(loadSource)) { source.value = lastSource; return; }
    lastSource = source.value;
  });
  form.querySelectorAll('[data-page-step]').forEach(b => b.addEventListener('click', () => {
    if (!pdf) return;
    const next = pageNo + Number(b.getAttribute('data-page-step'));
    if (next < 1 || next > pdf.numPages) return;
    leavePage(() => { pageNo = next; pageField.value = String(next); drawPage(); });
  }));

  // --- rooms, in the order they were ticked ------------------------------------

  form.querySelectorAll('[data-room]').forEach(box => {
    box.addEventListener('change', () => {
      const id = box.value;
      const at = chosenRooms.indexOf(id);
      if (box.checked && at === -1) chosenRooms.push(id);
      if (!box.checked && at !== -1) chosenRooms.splice(at, 1);
      form.querySelectorAll('[data-room]').forEach(b => {
        const i = chosenRooms.indexOf(b.value);
        const badge = b.parentElement.querySelector('[data-order]');
        badge.textContent = i === -1 ? '' : KU(i + 1);
        b.disabled = i === -1 && chosenRooms.length >= 4;
      });
      roomsField.value = chosenRooms.join(',');
      refresh();
    });
  });

  function refresh() {
    // An old refusal says nothing about what is on the page now.
    errorBox.hidden = true;
    undoBtn.disabled = !strokes.length;
    clearBtn.disabled = !strokes.length;
    const ready = strokes.length > 0 && chosenRooms.length > 0;
    sendBtn.disabled = !ready;
    sendHint.textContent = ready
      ? (chosenRooms.length === 1 ? 'دەچێت بۆ یەک ژوور.' : `دەچێت بۆ ${KU(chosenRooms.length)} ژوور، یەک لە دوای یەک.`)
      : !strokes.length ? 'سەرەتا هامشەکە بنووسە.' : 'ژوورێک هەڵبژێرە.';
  }

  // --- sending -----------------------------------------------------------------

  async function exportInk() {
    const w = EXPORT_WIDTH;
    const h = Math.round(w * aspect);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (blank) await paintBlank(ctx, w, h);
    for (const s of strokes) drawStroke(ctx, s, w, h);
    await drawStamp(ctx, w, h);
    return new Promise(resolve => c.toBlob(resolve, 'image/png'));
  }

  // Bottom left, where a signature goes on a Kurdish letter.
  async function drawStamp(ctx, w, h) {
    await fontsReady();
    const u = w / 100;
    const [title, name, when] = stampLines();
    const boxW = 34 * u, boxH = 10.5 * u;
    const x = 3.5 * u, y = h - boxH - 3.5 * u;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.strokeStyle = '#1f3f9c';
    ctx.lineWidth = 0.3 * u;
    const r = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + boxW, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1f3f9c';
    ctx.font = `700 ${2.3 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillText(title, x + boxW - 1.6 * u, y + 3.3 * u);
    ctx.fillStyle = '#16241D';
    ctx.font = `600 ${2.2 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillText(name, x + boxW - 1.6 * u, y + 6.3 * u);
    ctx.font = `400 ${2 * u}px Vazirmatn, Tahoma, sans-serif`;
    ctx.fillStyle = '#5C6B63';
    ctx.fillText(when, x + boxW - 1.6 * u, y + 9.1 * u);
    ctx.restore();
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sendBtn.disabled) return;
    errorBox.hidden = true;
    sendBtn.disabled = true;
    const label = sendBtn.textContent;
    sendBtn.textContent = 'دەنێردرێت…';
    try {
      const blob = await exportInk();
      const body = new FormData();
      for (const name of ['_csrf', 'step_id', 'rooms', 'page_no', 'instruction']) {
        body.append(name, form.elements[name] ? form.elements[name].value : '');
      }
      body.append('source_attachment_id', source.value);
      body.append('ink', blob, 'ink.png');
      const res = await fetch(form.action, { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      let answer = {};
      try { answer = await res.json(); } catch { /* not JSON: an error page */ }
      if (res.ok && answer.location) {
        window.location.assign(answer.location);
        return;
      }
      sendBtn.textContent = label;
      refresh();
      errorBox.textContent = answer.error || 'نەنێردرا. دووبارە هەوڵبدەوە.';
      errorBox.hidden = false;
      return;
    } catch (err) {
      console.warn('[margin] send failed:', err && err.message);
      sendBtn.textContent = label;
      refresh();
      errorBox.textContent = 'پەیوەندی بە ڕاژەوە نەبوو. دووبارە هەوڵبدەوە.';
      errorBox.hidden = false;
    }
  });

  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(drawPage, 200); });

  refresh();
  layout();
  loadSource();
}
