// In-page measurement: computed styles of every component, grouped by role.
// Runs inside the browser via page.evaluate(measurePage). Read-only.

export function measurePage() {
  const round = n => Math.round(n * 10) / 10;
  const csOf = el => getComputedStyle(el);
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = csOf(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (el.closest('.sr-only, [hidden], .nav-toggle-input')) return false;
    // clipped away (file-native inputs)
    if (cs.clipPath && cs.clipPath.includes('inset(50%')) return false;
    return true;
  };
  const region = el => el.closest('.sidebar') ? 'sidebar'
    : el.closest('.topbar') ? 'topbar'
    : el.closest('.login-card, .login-page') ? 'login'
    : el.closest('main') ? 'content' : 'other';
  const short = el => {
    if (!el || el.nodeType !== 1) return '';
    let s = el.tagName.toLowerCase();
    const cls = [...el.classList].filter(c => c.length < 30).slice(0, 4);
    if (cls.length) s += '.' + cls.join('.');
    const t = el.getAttribute('type');
    if (t && /^(input|button)/.test(s)) s += `[type=${t}]`;
    return s;
  };
  const path = el => {
    const parts = []; let e = el;
    for (let i = 0; i < 4 && e && !['MAIN', 'BODY', 'HTML'].includes(e.tagName); i++) { parts.unshift(short(e)); e = e.parentElement; }
    return parts.join(' > ');
  };
  const txt = el => ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '') + '').trim().replace(/\s+/g, ' ').slice(0, 36);
  const c4 = (a, b, c, d) => (a === c && b === d) ? (a === b ? a : `${a} ${b}`) : `${a} ${b} ${c} ${d}`;
  const get = (el, p) => {
    const cs = csOf(el);
    switch (p) {
      case 'height': return round(el.getBoundingClientRect().height) + 'px';
      case 'width': return round(el.getBoundingClientRect().width) + 'px';
      case 'padding': return c4(cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft);
      case 'margin': return c4(cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft);
      case 'radius': return c4(cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius);
      case 'border': {
        const side = s => cs[`border${s}Width`] === '0px' || cs[`border${s}Style`] === 'none' ? 'none' : `${cs[`border${s}Width`]} ${cs[`border${s}Style`]} ${cs[`border${s}Color`]}`;
        return c4(side('Top'), side('Right'), side('Bottom'), side('Left'));
      }
      case 'border-bottom': return cs.borderBottomStyle === 'none' || cs.borderBottomWidth === '0px' ? 'none' : `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`;
      case 'font-family': return cs.fontFamily.split(',')[0].replace(/"/g, '').trim();
      default: return cs.getPropertyValue(p);
    }
  };

  // role -> sig -> { n, sample }
  const groups = {};
  const add = (group, role, el, props) => {
    const v = {};
    for (const p of props) v[p] = get(el, p);
    const g = (groups[group] ??= {});
    const r = (g[role] ??= {});
    const sig = JSON.stringify(v);
    if (!r[sig]) r[sig] = { v, n: 0, samples: [] };
    r[sig].n++;
    if (r[sig].samples.length < 2) r[sig].samples.push({ path: path(el), text: txt(el) });
  };
  const all = sel => [...document.querySelectorAll(sel)].filter(visible);

  // --- headings
  for (const el of all('h1, h2, h3, h4')) {
    const t = el.tagName.toLowerCase();
    const ctx = el.closest('.topbar') ? 'topbar' : el.closest('.login-card') ? 'login'
      : el.closest('.card') ? (el.parentElement.classList.contains('card') && el.parentElement.firstElementChild === el ? 'card-first' : 'in-card') : 'content';
    add('headings', `${t}@${ctx}`, el, ['font-size', 'font-weight', 'font-family', 'line-height', 'margin', 'color']);
  }

  // --- buttons
  const VARIANTS = ['secondary', 'gold', 'danger', 'danger-outline', 'small'];
  const SPECIAL = ['bell', 'sound-toggle', 'logout-btn', 'file-choose', 'remove', 'toast-close', 'nav-toggle', 'inline-field'];
  for (const el of all('.btn, button, input[type=submit], input[type=button], input[type=reset]')) {
    const cl = el.classList;
    const isBtn = cl.contains('btn');
    const variant = VARIANTS.filter(c => cl.contains(c)).map(c => '.' + c).join('');
    const special = SPECIAL.filter(c => cl.contains(c));
    const tag = el.tagName.toLowerCase();
    const reg = region(el);
    const ctx = reg !== 'content' ? reg : el.closest('td') ? 'td' : 'content';
    const icon = !(el.innerText || el.value || '').trim() && el.querySelector('svg') ? ':icon' : '';
    const role = `${tag}${isBtn ? '.btn' + variant : ':not(.btn)'}${special.length ? '{' + special.join(',') + '}' : ''}${icon}@${ctx}`;
    add('buttons', role, el, ['height', 'font-size', 'font-weight', 'line-height', 'padding', 'radius', 'background-color', 'color', 'border', 'font-family']);
  }

  // --- pills and pill-like things that are not .pill
  for (const el of all('.pill')) {
    const variant = [...el.classList].filter(c => c !== 'pill').join('.') || '(none)';
    add('pills', `.pill.${variant}`, el, ['height', 'font-size', 'font-weight', 'padding', 'radius', 'background-color', 'color', 'line-height']);
  }
  for (const el of all('main span, main a, main div, main strong, main small, main em, main b')) {
    if (el.matches('.pill, .btn, .count, .bell-count, .avatar, .brand-seal, .stat, .card, .notice')) continue;
    const cs = csOf(el);
    const rad = parseFloat(cs.borderTopLeftRadius);
    const r = el.getBoundingClientRect();
    if (rad >= 12 && r.height < 36 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.height >= 14) {
      add('pillLike', short(el), el, ['height', 'font-size', 'font-weight', 'padding', 'radius', 'background-color', 'color']);
    }
  }

  // --- cards and card-like boxes
  for (const el of all('.card')) {
    const variant = [...el.classList].filter(c => c !== 'card').join('.');
    add('cards', `.card${variant ? '.' + variant : ''}`, el, ['padding', 'radius', 'border', 'box-shadow', 'margin', 'background-color']);
  }
  for (const el of all('main div, main section, main fieldset, main details, main aside, main li, main form, main ul, main p')) {
    if (el.matches('.card, .notice')) continue;
    const cs = csOf(el);
    const bw = parseFloat(cs.borderTopWidth);
    const rad = parseFloat(cs.borderTopLeftRadius);
    const r = el.getBoundingClientRect();
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
    if (r.height >= 36 && rad >= 4 && (bw >= 1 && cs.borderTopStyle !== 'none' || bg)) {
      add('boxLike', short(el), el, ['padding', 'radius', 'border', 'box-shadow', 'margin', 'background-color']);
    }
  }

  // --- fields
  for (const el of all('input, select, textarea')) {
    const type = (el.getAttribute('type') || (el.tagName === 'INPUT' ? '(none)' : '')).toLowerCase();
    if (['hidden', 'file'].includes(type)) continue;
    const tag = el.tagName.toLowerCase();
    if (['checkbox', 'radio'].includes(type)) {
      add('checks', `input[type=${type}]@${region(el)}`, el, ['width', 'height', 'accent-color', 'margin']);
      continue;
    }
    if (['submit', 'button', 'reset'].includes(type)) continue;
    const special = ['inline-field', 'filter-field', 'w-sm', 'w-md'].filter(c => el.classList.contains(c));
    const reg = region(el);
    const ctx = reg !== 'content' ? reg : el.closest('td') ? 'td' : el.closest('.row') ? 'row' : 'content';
    const role = `${tag}${type ? `[type=${type}]` : ''}${special.length ? '.' + special.join('.') : ''}@${ctx}`;
    add('fields', role, el, ['height', 'font-size', 'padding', 'border', 'radius', 'background-color', 'color', 'line-height', 'font-family']);
  }

  // --- labels
  for (const el of all('label')) {
    if (el.matches('.btn, .nav-toggle, .nav-backdrop')) continue;
    const wraps = el.querySelector('input[type=checkbox], input[type=radio]') ? '(wraps-check)' : el.querySelector('input, select, textarea') ? '(wraps-field)' : '';
    const ctx = el.closest('.field') ? 'field' : el.closest('td') ? 'td' : region(el);
    add('labels', `label${wraps}@${ctx}`, el, ['font-size', 'font-weight', 'color', 'margin', 'display', 'line-height']);
  }

  // --- tables
  for (const el of all('th')) {
    const kv = el.closest('table.kv') ? '.kv' : '';
    const sec = el.closest('thead') ? 'thead' : 'tbody';
    add('tables', `table${kv} th@${sec}`, el, ['font-size', 'font-weight', 'padding', 'background-color', 'color', 'border-bottom', 'line-height']);
  }
  for (const el of all('td')) {
    const kv = el.closest('table.kv') ? '.kv' : '';
    add('tables', `table${kv} td`, el, ['font-size', 'padding', 'color', 'border-bottom', 'line-height']);
  }
  for (const el of all('table')) {
    add('tables', `table${el.classList.contains('kv') ? '.kv' : ''}`, el, ['font-size', 'margin', 'border']);
  }

  // --- text states
  for (const el of all('.notice')) {
    const variant = [...el.classList].filter(c => c !== 'notice').join('.') || '(none)';
    add('notices', `.notice.${variant}`, el, ['padding', 'radius', 'font-size', 'background-color', 'color', 'margin', 'border']);
  }
  for (const el of all('.empty')) add('text', `.empty@${el.closest('.card') ? 'card' : 'other'}`, el, ['padding', 'font-size', 'color', 'text-align']);
  for (const el of all('.hint')) add('text', `${el.tagName.toLowerCase()}.hint@${el.closest('.field') ? 'field' : 'other'}`, el, ['font-size', 'color', 'margin']);
  for (const el of all('.muted')) add('text', `${el.tagName.toLowerCase()}.muted`, el, ['font-size', 'color']);
  for (const el of all('small')) add('text', `small${el.className ? '.' + el.className.split(' ')[0] : ''}@${region(el)}`, el, ['font-size', 'color']);
  for (const el of all('.stat')) add('text', '.stat', el, ['padding', 'radius', 'border', 'background-color', 'box-shadow']);
  for (const el of all('.stat .n')) add('text', '.stat .n', el, ['font-size', 'font-weight', 'color']);
  for (const el of all('.stat .k')) add('text', '.stat .k', el, ['font-size', 'color']);
  for (const el of all('main p')) add('text', `p@${el.closest('.card') ? 'card' : 'other'}`, el, ['font-size', 'margin', 'color', 'line-height']);
  for (const el of all('main a:not(.btn)')) add('links', `a@${el.closest('td') ? 'td' : 'content'}`, el, ['color', 'font-weight', 'text-decoration-line']);

  // --- font sizes, colours, radii over every element with its own text
  const fontSizes = {}; const colors = {}; const backgrounds = {}; const borderColors = {}; const radii = {};
  const bump = (m, k, role) => { const e = (m[k] ??= { n: 0, roles: {} }); e.n++; e.roles[role] = (e.roles[role] || 0) + 1; };
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'path', 'OPTION'].includes(el.tagName) || el.closest('svg')) continue;
    if (!visible(el)) continue;
    const cs = csOf(el);
    const reg = region(el);
    const role = `${short(el)}@${reg}`;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (ownText || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      bump(fontSizes, cs.fontSize, role);
      if (ownText) bump(colors, cs.color, role);
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bump(backgrounds, cs.backgroundColor, role);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs[`border${s}Style`] !== 'none' && parseFloat(cs[`border${s}Width`]) > 0) { bump(borderColors, cs[`border${s}Color`], role); break; }
    }
    if (parseFloat(cs.borderTopLeftRadius) > 0 || parseFloat(cs.borderTopRightRadius) > 0) bump(radii, cs.borderTopLeftRadius === '0px' ? cs.borderTopRightRadius : cs.borderTopLeftRadius, role);
  }

  // --- inline styles present in the live DOM (server-rendered or set by scripts)
  const inlineDom = [];
  for (const el of document.querySelectorAll('[style]')) {
    if (el.closest('svg')) continue;
    inlineDom.push({ style: el.getAttribute('style'), el: path(el), visible: visible(el), region: region(el) });
  }

  // --- Latin digits in visible text
  const latin = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent;
    if (!/[0-9]/.test(t)) continue;
    const p = node.parentElement;
    if (!p || p.closest('script, style, noscript, svg, .mono, [dir="ltr"], code, pre, textarea')) continue;
    if (p.tagName !== 'OPTION' && !visible(p)) continue;
    latin.push({ text: t.trim().replace(/\s+/g, ' ').slice(0, 90), el: path(p), region: region(p) });
  }
  const latinAttr = [];
  for (const el of document.querySelectorAll('[placeholder], input[type=submit][value], input[type=button][value]')) {
    const v = el.getAttribute('placeholder') || el.getAttribute('value') || '';
    if (/[0-9]/.test(v) && visible(el)) latinAttr.push({ attr: v.slice(0, 90), el: path(el) });
  }

  return {
    title: document.title,
    h1: (document.querySelector('.topbar h1, h1')?.innerText || '').trim().slice(0, 60),
    shell: !!document.querySelector('.shell'),
    groups, fontSizes, colors, backgrounds, borderColors, radii, inlineDom, latin, latinAttr,
    docWidth: document.documentElement.scrollWidth,
  };
}
