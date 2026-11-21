// 文字起こしタブ（手直し・話者の付け替え・置き換え・再生）
import { h, svg, btn, toast, fmtDur, dialog, speakerColor, normalize, iconBtn } from '../ui.js';
import { updateRecord } from '../db.js';
import { playRange, stopPlayback } from '../audio.js';
import { speakerOn } from '../diarize.js';
import { spkChip } from './common.js';

const state = { showOff: false, find: '', rep: '' };

export function draw(box, ctx) {
  const rec = ctx.rec;
  const segs = rec.segs || [];
  if (!segs.length) {
    box.append(h('div', { class: 'card empty', html: svg('file') }, h('p', null, h('strong', null, 'まだ文字起こしがありません')), h('p', { class: 'small' }, '「処理の手順」の 1〜3 を進めてください。')));
    return;
  }
  const findIn = h('input', { type: 'search', placeholder: 'さがす言葉', value: state.find, 'aria-label': 'さがす言葉' });
  const repIn = h('input', { type: 'text', placeholder: '置きかえる言葉', value: state.rep, 'aria-label': '置きかえる言葉' });
  const hitInfo = h('span', { class: 'tiny muted' });
  const repBtn = btn('すべて置き換え', async () => {
    const f = findIn.value; const r = repIn.value;
    if (!f) { toast('さがす言葉を入れてください'); return; }
    let n = 0;
    await updateRecord(ctx.id, (x) => { for (const sg of x.segs) if (sg.text && sg.text.includes(f)) { n += sg.text.split(f).length - 1; sg.text = sg.text.split(f).join(r); sg.edited = true; } });
    toast(n ? `${n}か所を置き換えました` : '見つかりませんでした');
  }, { cls: 'small', ic: 'replace' });
  const offToggle = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: state.showOff, onchange: (e) => { state.showOff = e.target.checked; paint(); } }), h('span', null, 'オフの人の発言も表示'));
  const tools = h('details', { class: 'card tight tools', open: !!state.find },
    h('summary', null, 'さがす・置き換える'),
    h('div', { class: 'grid2', style: { marginTop: '10px' } }, findIn, repIn),
    h('div', { class: 'row between', style: { marginTop: '8px' } }, h('div', { class: 'row' }, repBtn, hitInfo), offToggle),
  );
  const hint = h('p', { class: 'secfoot', style: { margin: '-14px 16px 16px' } }, '文をタップすると直せます。話者の名前をタップすると話者を変えられます。▶ でその部分を聞けます。');
  const list = h('ul', { class: 'seglist' });
  const card = h('div', { class: 'card' }, list);
  box.append(tools, hint, card);

  let playing = null;
  const paint = () => {
    list.innerHTML = '';
    const f = findIn.value.trim();
    const nf = normalize(f);
    let hits = 0, shown = 0;
    for (const sg of rec.segs || []) {
      const on = speakerOn(rec, sg.sp);
      if (!on && !state.showOff) continue;
      shown++;
      const hit = f && sg.text && normalize(sg.text).includes(nf);
      if (hit) hits++;
      const playB = iconBtn('play', 'この部分を聞く', null);
      playB.addEventListener('click', async () => {
        if (playing === sg.id) { stopPlayback(); return; }
        try {
          playing = sg.id; playB.innerHTML = svg('stop');
          await playRange(ctx.id, sg.s, sg.e, () => { if (playing === sg.id) playing = null; playB.innerHTML = svg('play'); });
        } catch (e) { playing = null; playB.innerHTML = svg('play'); toast('再生できませんでした（音声が削除されているかもしれません）', 'err'); }
      });
      const text = h('div', { class: 'stext' + (sg.text == null ? ' pending' : ''), tabindex: '0', role: 'textbox', 'aria-label': '発言の文字（タップで直す）' }, sg.text == null ? (on ? '（まだ文字起こししていません）' : '（オフの人なので文字起こししていません）') : (sg.text || '（聞き取れる言葉がありませんでした）'));
      const startEdit = () => {
        if (text.hasAttribute('contenteditable') || sg.text == null) return;
        ctx.setEditing(true);
        try { text.contentEditable = 'plaintext-only'; } catch (e) { text.contentEditable = 'true'; }
        if (text.contentEditable !== 'plaintext-only') text.contentEditable = 'true';
        text.setAttribute('contenteditable', text.contentEditable);
        text.textContent = sg.text || '';
        text.focus();
        const done = async (save) => {
          text.removeEventListener('blur', onBlur); text.removeEventListener('keydown', onKey);
          text.removeAttribute('contenteditable');
          const v = text.textContent.replace(/\s+$/g, '').replace(/^\s+/, '');
          ctx.setEditing(false);
          if (save && v !== (sg.text || '')) {
            await updateRecord(ctx.id, (r) => { const x = r.segs.find((q) => q.id === sg.id); if (x) { x.text = v; x.edited = true; } });
            toast('直しました');
          } else text.textContent = sg.text || '（聞き取れる言葉がありませんでした）';
        };
        const onBlur = () => done(true);
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); text.blur(); } };
        text.addEventListener('blur', onBlur); text.addEventListener('keydown', onKey);
      };
      text.addEventListener('click', startEdit);
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !text.hasAttribute('contenteditable')) { e.preventDefault(); startEdit(); } });
      const chip = spkChip(rec, sg.sp, () => changeSpeaker(ctx, sg));
      list.append(h('li', { class: 'seg' + (on ? '' : ' off') + (hit ? ' hit' : '') },
        h('div', { class: 'shead' }, playB, h('span', null, fmtDur(sg.s)), chip, sg.edited ? h('span', { class: 'edited', title: '手で直しました' }, '✎ 直した') : null, sg.src && sg.src !== 'local' ? h('span', { class: 'tiny' }, sg.src === 'groq' ? 'Groq' : 'Gemini') : null),
        text));
    }
    if (!shown) list.append(h('li', { class: 'muted small', style: { padding: '12px 0' } }, 'オンの人の発言がありません。「話者」タブで残す人をオンにしてください。'));
    hitInfo.textContent = f ? `${hits}か所` : '';
  };
  findIn.addEventListener('input', () => { state.find = findIn.value; paint(); });
  repIn.addEventListener('input', () => { state.rep = repIn.value; });
  paint();
}

async function changeSpeaker(ctx, sg) {
  const rec = ctx.rec;
  const body = h('div', { class: 'stack' });
  const v = await dialog({
    title: 'この発言の話者', body: [h('p', { class: 'small muted' }, `${fmtDur(sg.s)} からの発言を、だれの発言にするか選んでください。`), body],
    dismissValue: null,
    buttons: [{ label: 'やめる', value: null }],
    onOpen: (d, close) => {
      for (const s of rec.speakers || []) {
        body.append(h('button', { type: 'button', class: 'btn block', style: { justifyContent: 'flex-start', color: speakerColor(s.id) }, onclick: () => close({ id: s.id }) }, `${s.id}　${s.name || '話者' + s.id}${s.on ? '' : '（オフ）'}`));
      }
      const nextId = 'ABCDEFGH'.split('').find((x) => !(rec.speakers || []).some((s) => s.id === x));
      if (nextId) body.append(h('button', { type: 'button', class: 'btn block', style: { justifyContent: 'flex-start' }, onclick: () => close({ id: nextId, isNew: true }) }, `＋ 新しい話者（${nextId}）にする`));
    },
  });
  if (!v || v.id === sg.sp) return;
  await updateRecord(ctx.id, (r) => {
    const x = r.segs.find((q) => q.id === sg.id); if (x) { x.sp = v.id; x.spFixed = true; }
    if (v.isNew && !r.speakers.some((s) => s.id === v.id)) r.speakers.push({ id: v.id, name: '', on: true, dur: +(sg.e - sg.s).toFixed(1), sample: [sg.s, Math.min(sg.e, sg.s + 8)] });
  });
  toast(`話者を ${v.id} にしました`);
}
