// 画面で共通に使う部品
import { h, svg, speakerColor } from '../ui.js';

export function privacyBadge(r) {
  if (r.privacy === 'confidential') return h('span', { class: 'badge lock', title: '部外秘（ロック中）', html: svg('lock') + '<span>部外秘</span>' });
  if (r.privacy === 'public') return h('span', { class: 'badge pub', title: '部外秘ではない（外部サービスで処理できる）', html: svg('globe') + '<span>外部OK</span>' });
  return h('span', { class: 'badge unset', title: '部外秘かどうか、まだ選んでいません' }, '扱い未選択');
}
export function stateBadge(r) {
  const map = {
    recording: ['録音中', 'unset'], paused: ['中断中（続きを録音できます）', 'unset'], recorded: ['未処理', 'gray'], diarized: ['話者を分けた', 'info'], transcribed: ['文字起こし済み', 'info'],
    summarized: ['まとめ済み', 'ok'], empty: ['音声なし', 'gray'], failed: ['失敗', 'gray'],
  };
  const [t, c] = map[r.state] || ['', 'gray'];
  return t ? h('span', { class: 'badge ' + c }, t) : null;
}
export function spkChip(rec, id, onclick) {
  const s = (rec.speakers || []).find((x) => x.id === id);
  const name = s && s.name ? `${id} ${s.name}` : id;
  const b = h(onclick ? 'button' : 'span', { type: onclick ? 'button' : null, class: 'spk', style: { color: speakerColor(id) }, title: onclick ? '話者を変える' : null, onclick });
  b.append(h('i', null, h('b', null, id)), h('span', { style: { color: 'var(--text)' } }, s && s.name ? s.name : '話者' + id));
  b.setAttribute('aria-label', name);
  return b;
}
export function progressBar(ratio, indet = false) {
  const bar = h('div', { class: 'progress' + (indet ? ' indet' : '') }, h('div'));
  if (!indet) bar.firstChild.style.width = Math.round((ratio || 0) * 100) + '%';
  return bar;
}
export function switchEl(checked, onchange, label) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), label ? h('span', null, label) : null);
}
