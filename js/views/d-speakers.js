// 話者タブ（声を聞く・名前をつける・オン/オフ・まとめる・分け直す）
import { h, svg, btn, toast, fmtDurJa, speakerColor, confirmDialog, iconBtn } from '../ui.js';
import { updateRecord } from '../db.js';
import { playRange, stopPlayback } from '../audio.js';
import { applyClustering, DEFAULT_THRESHOLD } from '../diarize.js';
import { getJob } from '../jobs.js';
import { switchEl } from './common.js';

export function draw(box, ctx) {
  const rec = ctx.rec;
  const spk = rec.speakers || [];
  if (!rec.diar || !rec.diar.done || !spk.length) {
    box.append(h('div', { class: 'card empty', html: svg('users') }, h('p', null, h('strong', null, 'まだ話者を分けていません')), h('p', { class: 'small' }, '「処理の手順」の「話者を分ける」を押してください。')));
    return;
  }
  const total = spk.reduce((a, s) => a + (s.dur || 0), 0) || 1;
  const card = h('div', { class: 'card' },
    h('h2', { html: svg('users') + '<span>話者</span>' }),
    h('p', { class: 'small muted' }, '▶ で声を聞いて、だれかを確かめてください。オフにした人の発言は、まとめ・質問・書き出しに入りません（外部サービスにも送りません）。'),
  );
  let playing = null;
  for (const s of spk) {
    const name = h('input', { type: 'text', value: s.name || '', placeholder: `話者${s.id} の名前（例：先生）`, 'aria-label': `話者${s.id} の名前` });
    let nt = null;
    name.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => updateRecord(ctx.id, (r) => { const x = r.speakers.find((q) => q.id === s.id); if (x) x.name = name.value.trim(); }), 400); });
    name.addEventListener('focus', () => ctx.setEditing(true));
    name.addEventListener('blur', () => { ctx.setEditing(false); });
    const play = iconBtn('play', `話者${s.id} の声を聞く`, null);
    play.addEventListener('click', async () => {
      if (playing === s.id) { stopPlayback(); return; }
      const sm = s.sample || [0, 5];
      try { playing = s.id; play.innerHTML = svg('stop'); await playRange(ctx.id, sm[0], sm[1], () => { if (playing === s.id) playing = null; play.innerHTML = svg('play'); }); } catch (e) { playing = null; play.innerHTML = svg('play'); toast('再生できませんでした', 'err'); }
    });
    const sw = switchEl(!!s.on, async (v) => {
      await updateRecord(ctx.id, (r) => { const x = r.speakers.find((q) => q.id === s.id); if (x) x.on = v; });
      toast(v ? `話者${s.id} をオン（残す）にしました` : `話者${s.id} をオフ（外す）にしました`);
    }, s.on ? '残す' : '外す');
    const others = spk.filter((o) => o.id !== s.id);
    const merge = others.length ? h('select', { 'aria-label': `話者${s.id} をほかの人とまとめる`, style: { minHeight: '34px', padding: '4px 8px', fontSize: '.85rem', width: 'auto' } },
      h('option', { value: '' }, 'ほかの人とまとめる…'), others.map((o) => h('option', { value: o.id }, `${o.id}${o.name ? '（' + o.name + '）' : ''} と同じ人`))) : null;
    if (merge) merge.addEventListener('change', async () => {
      const to = merge.value; if (!to) return;
      if (!(await confirmDialog(`話者${s.id} を ${to} とまとめますか？`, `話者${s.id} の発言は、すべて話者${to} の発言になります。`, { ok: 'まとめる' }))) { merge.value = ''; return; }
      await updateRecord(ctx.id, (r) => {
        for (const sg of r.segs || []) if (sg.sp === s.id) { sg.sp = to; sg.spFixed = true; }
        const a = r.speakers.find((q) => q.id === to), b = r.speakers.find((q) => q.id === s.id);
        if (a && b) a.dur = +((a.dur || 0) + (b.dur || 0)).toFixed(1);
        r.speakers = r.speakers.filter((q) => q.id !== s.id);
      });
      toast('まとめました');
    });
    const pct = Math.round(((s.dur || 0) / total) * 100);
    card.append(h('div', { class: 'spkrow' },
      h('div', { class: 'dot', style: { background: speakerColor(s.id) } }, s.id),
      h('div', { class: 'grow' }, name,
        h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, `話した長さ：${fmtDurJa(s.dur)}（${pct}%）` + (s.main ? (s.mainBy === 'anchor' ? '・録音中の印から「先生」と判断' : '・いちばん長く話している人') : '')),
        h('div', { class: 'spkbar' }, h('div', { style: { width: pct + '%', background: speakerColor(s.id) } })),
        merge ? h('div', { style: { marginTop: '6px' } }, merge) : null),
      h('div', { class: 'stack', style: { textAlign: 'right' } }, play, sw),
    ));
  }
  box.append(card);

  // 分け直し
  const k = h('select', { 'aria-label': '人数' }, h('option', { value: '' }, '自動で決める'), [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, `${n}人`)));
  k.value = rec.diar.k ? String(rec.diar.k) : '';
  const thr = h('input', { type: 'range', min: '0.40', max: '0.85', step: '0.01', value: String(rec.diar.threshold ?? DEFAULT_THRESHOLD), 'aria-label': '分け方の細かさ', style: { width: '100%' } });
  const thrLbl = h('span', { class: 'tiny muted' });
  const showThr = () => { const v = +thr.value; thrLbl.textContent = v < 0.55 ? '細かく分ける（人数が増えやすい）' : v > 0.7 ? 'おおまかに分ける（人数が減りやすい）' : 'ふつう'; };
  thr.addEventListener('input', showThr); showThr();
  const hasText = (rec.segs || []).some((x) => x.text != null);
  box.append(h('div', { class: 'card' },
    h('h2', null, '分け方を変える'),
    rec.diar.single ? h('p', { class: 'small muted' }, 'いまは「話者を分けない」で処理しています。分けたいときは、「処理の手順」の「もう一度分ける」を押してください。') : h('div', null,
      h('label', { class: 'field' }, h('span', null, '人数'), k),
      h('label', { class: 'field' }, h('span', null, '分け方の細かさ（人数が「自動」のとき）'), thr, thrLbl),
      h('p', { class: 'tiny muted' }, hasText ? '文字起こしした文はそのままで、話者だけ付け直します（手で変えた発言はそのまま）。' : '保存してある声の特徴を使うので、すぐ終わります。'),
      btn('この設定で分け直す', async () => {
        if (getJob(ctx.id)) { toast('いま処理中です'); return; }
        try {
          await applyClustering(ctx.id, { threshold: +thr.value, k: k.value ? +k.value : null });
          toast('分け直しました');
        } catch (e) { toast('分け直せませんでした：' + e.message, 'err'); }
      }, { cls: 'primary', ic: 'refresh' })),
  ));
}
