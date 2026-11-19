// 画面づくりの小さな道具
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8 21h8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  play: '<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.2A5 5 0 0 1 21.5 19"/>',
  teacher: '<circle cx="9" cy="7" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M14 4h7v8h-5"/><path d="m16 12 2 3"/>',
  spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/><path d="m15 8 2 2"/>',
  wave: '<path d="M3 12h2"/><path d="M7 8v8"/><path d="M11 5v14"/><path d="M15 9v6"/><path d="M19 11v2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  replace: '<path d="M4 7h11"/><path d="m12 4 3 3-3 3"/><path d="M20 17H9"/><path d="m12 14-3 3 3 3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6"/><path d="M9 14h6"/>',
};

export function svg(name, cls = '') {
  const p = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
export function icon(name) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.style.display = 'inline-flex';
  s.innerHTML = svg(name);
  return s;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });
}

// h('div', {class: 'x', onclick: fn}, '子', h(...))
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export function btn(label, onclick, { cls = '', ic = null, title = null, type = 'button', disabled = false } = {}) {
  const b = h('button', { type, class: 'btn ' + cls, onclick, title, disabled });
  if (ic) b.insertAdjacentHTML('beforeend', svg(ic));
  if (label) b.append(h('span', null, label));
  return b;
}
export function iconBtn(ic, title, onclick) {
  const b = h('button', { type: 'button', class: 'iconbtn', title, 'aria-label': title, onclick });
  b.innerHTML = svg(ic);
  return b;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = '', ms = 2800) {
  const box = document.getElementById('toast');
  if (!box) return;
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

// ダイアログ。buttons: [{label, value, cls}]
export function dialog({ title, body, buttons = [{ label: '閉じる', value: true, cls: 'primary' }], dismissValue = null, onOpen = null }) {
  return new Promise((resolve) => {
    const d = h('dialog', { 'aria-label': title || 'お知らせ' });
    const b = h('div', { class: 'dbody' });
    if (title) b.append(h('h2', null, title));
    if (body instanceof Node) b.append(body);
    else if (Array.isArray(body)) body.forEach((x) => b.append(x instanceof Node ? x : h('p', null, x)));
    else if (body) b.append(h('p', null, body));
    const f = h('div', { class: 'dfoot' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { d.close(); } catch (e) { /* 無視 */ } d.remove(); resolve(v); };
    for (const bt of buttons) {
      f.append(h('button', { type: 'button', class: 'btn ' + (bt.cls || ''), onclick: () => finish(typeof bt.value === 'function' ? bt.value(d) : bt.value) }, bt.label));
    }
    d.append(b, f);
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(dismissValue); });
    document.body.append(d);
    d.showModal();
    if (onOpen) onOpen(d, finish);
  });
}
export function confirmDialog(title, body, { ok = 'はい', cancel = 'やめる', danger = false, okCls = null } = {}) {
  return dialog({ title, body, dismissValue: false, buttons: [{ label: cancel, value: false }, { label: ok, value: true, cls: okCls || (danger ? 'danger fill' : 'primary') }] });
}
export function promptDialog(title, { label = '', value = '', multiline = false, placeholder = '' } = {}) {
  const input = multiline ? h('textarea', { placeholder, rows: 6 }) : h('input', { type: 'text', placeholder });
  input.value = value;
  const body = h('div', null, label ? h('label', { class: 'field' }, h('span', null, label), input) : input);
  return dialog({
    title, body, dismissValue: null,
    buttons: [{ label: 'やめる', value: null }, { label: '決定', value: () => input.value, cls: 'primary' }],
    onOpen: () => setTimeout(() => input.focus(), 50),
  });
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
export function fmtDurJa(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec}秒`;
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  return hh ? `${hh}時間${mm}分` : `${mm}分`;
}
export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function nowHM(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDateJa(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const w = '日月火水木金土'[d.getDay()];
  return `${+m[1]}年${+m[2]}月${+m[3]}日（${w}）`;
}
export function fmtStamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + 'B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(0) + 'KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + 'MB';
  return (n / 1024 ** 3).toFixed(2) + 'GB';
}

// 検索用に文字をそろえる（全角半角・カタカナひらがな・大文字小文字）
export function normalize(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, ' ');
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function speakerColor(id) {
  const i = Math.max(0, 'ABCDEFGH'.indexOf(String(id || 'A')[0]));
  return `var(--sp-${'abcdefgh'[i] || 'a'})`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); return true; } catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* 無視 */ }
    ta.remove(); toast(ok ? 'コピーしました' : 'コピーできませんでした', ok ? '' : 'err'); return ok;
  }
}
