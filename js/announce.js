// 更新のお知らせ（開いたときに表示。「今後表示しない」で次から出さない）
import { esc } from './ui.js';

const KEY = 'minutes_announceSeen';
function seen() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
function setSeen(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* 無視 */ } }

function show(e) {
  const d = document.createElement('div');
  d.id = 'announce';
  d.innerHTML = '<div class="lbox" role="dialog" aria-modal="true" aria-label="お知らせ"><div class="shead"><h3>' + esc(e.title || 'お知らせ') +
    '</h3><button type="button" data-an="close" aria-label="閉じる">✕</button></div>' +
    (e.body || []).map((t) => '<p>' + esc(typeof t === 'string' ? t : (t && t.text) || '') + '</p>').join('') +
    '<label><input type="checkbox" id="an-dontshow"> 今後表示しない</label>' +
    '<button class="btn primary block" type="button" data-an="close">閉じる</button></div>';
  document.body.appendChild(d);
  d.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-an="close"]')) {
      if (d.querySelector('#an-dontshow').checked) setSeen(e.id);
      d.remove();
    }
  });
}

export function checkAnnounce() {
  fetch('announce-data.json', { cache: 'no-store' }).then((r) => r.json()).then((list) => {
    const e = Array.isArray(list) ? list[0] : null;
    if (!e || !e.id) return;
    if (seen() !== e.id) show(e);
  }).catch(() => { /* オフラインなどは無視 */ });
}
