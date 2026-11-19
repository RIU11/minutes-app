// まとめタブ
import { h, svg, btn, toast, confirmDialog, fmtStamp } from '../ui.js';
import { updateRecord } from '../db.js';
import { summaryEngineLabel } from '../summarize.js';
import { taskList } from './d-info.js';

export function draw(box, ctx) {
  const rec = ctx.rec;
  const s = rec.summary;
  const hasText = (rec.segs || []).some((x) => x.text);
  if (!s) {
    box.append(h('div', { class: 'card empty', html: svg('spark') },
      h('p', null, h('strong', null, 'まだまとめがありません')),
      hasText ? h('p', { class: 'small' }, '文字起こしから、概要・要点・用語・決まったこと・宿題をまとめます。') : h('p', { class: 'small' }, '先に「処理の手順」で、話者を分けて文字起こしをしてください。'),
      hasText ? btn('まとめをつくる', () => ctx.startSummary(), { cls: 'primary', ic: 'spark' }) : null,
    ));
    return;
  }
  const card = h('div', { class: 'card summary' });
  if (s.fallback) card.append(h('div', { class: 'notice warn small' }, s.fallback));
  if (s.overview) card.append(h('h3', null, '概要'), h('div', { class: 'overview' }, s.overview));
  for (const sec of s.sections || []) {
    card.append(h('h3', null, sec.heading || '要点'), h('ul', null, (sec.points || []).map((p) => h('li', null, p))));
  }
  if ((s.terms || []).length) {
    const dl = h('dl');
    for (const t of s.terms) { dl.append(h('dt', null, t.term)); if (t.desc) dl.append(h('dd', null, t.desc)); }
    card.append(h('h3', null, '大事な用語'), dl);
  }
  if ((s.decisions || []).length) card.append(h('h3', null, '決まったこと'), h('ul', null, s.decisions.map((d) => h('li', null, d))));
  card.append(h('h3', null, '宿題・やること'));
  if ((rec.tasks || []).length) card.append(taskList(ctx, { compact: true }));
  else card.append(h('p', { class: 'small muted' }, 'ありません（「情報・書き出し」で追加できます）'));
  if (s.next) card.append(h('h3', null, '次回'), h('p', null, s.next));

  // 文字起こしの直し候補（Gemini のときだけ出る）
  const cors = (s.corrections || []).filter((c) => !c.applied);
  if (cors.length) {
    const ul = h('ul', { class: 'tasklist' });
    for (const c of cors) {
      const count = (rec.segs || []).reduce((n, sg) => n + (sg.text ? sg.text.split(c.wrong).length - 1 : 0), 0);
      ul.append(h('li', { class: 'row between', style: { padding: '6px 0', borderTop: '1px solid var(--line)' } },
        h('span', null, h('s', { class: 'muted' }, c.wrong), ' → ', h('strong', null, c.right), h('span', { class: 'tiny muted' }, `（${count}か所）`)),
        count ? btn('置き換える', async () => {
          await updateRecord(ctx.id, (r) => {
            for (const sg of r.segs || []) if (sg.text && sg.text.includes(c.wrong)) { sg.text = sg.text.split(c.wrong).join(c.right); sg.edited = true; }
            const x = (r.summary.corrections || []).find((y) => y.wrong === c.wrong && y.right === c.right); if (x) x.applied = true;
          });
          toast(`${count}か所を置き換えました`);
        }, { cls: 'small' }) : null));
    }
    card.append(h('h3', null, '文字起こしの直し候補'), h('p', { class: 'tiny muted' }, 'AIが「聞き間違いかも」と思った言葉です。正しければ置き換えてください。'), ul);
  }
  card.append(h('div', { class: 'engine-note' }, `まとめ：${summaryEngineLabel(s.engine)}${s.model ? '・' + s.model : ''}${s.at ? '・' + fmtStamp(s.at) : ''}${s.edited ? '・手で直しました' : ''}`));
  card.append(h('div', { class: 'row', style: { marginTop: '12px' } },
    btn('まとめを直す', () => edit(box, ctx), { cls: 'small', ic: 'edit' }),
    btn('つくり直す', async () => { if (await confirmDialog('まとめをつくり直しますか？', '今のまとめ（手で直した部分も）は新しいものに置きかわります。', { ok: 'つくり直す' })) ctx.startSummary(); }, { cls: 'small', ic: 'refresh' }),
    btn('書き出す', () => ctx.setTab('info'), { cls: 'small', ic: 'download' }),
  ));
  box.append(card);
}

// まとめを手で直す
function edit(box, ctx) {
  const s = ctx.rec.summary;
  ctx.setEditing(true);
  box.innerHTML = '';
  const ta = (v, rows = 4) => { const t = h('textarea', { rows }); t.value = v || ''; return t; };
  const ov = ta(s.overview, 4);
  const secs = (s.sections || []).map((x) => ({ head: h('input', { type: 'text', value: x.heading }), body: ta((x.points || []).join('\n'), Math.min(12, (x.points || []).length + 1)) }));
  const secBox = h('div');
  const drawSecs = () => {
    secBox.innerHTML = '';
    secs.forEach((x, i) => secBox.append(h('div', { class: 'card tight', style: { background: 'var(--surface-2)' } },
      h('label', { class: 'field' }, h('span', null, `見出し ${i + 1}`), x.head),
      h('label', { class: 'field' }, h('span', null, '要点（1行に1つ）'), x.body),
      btn('この見出しを消す', () => { secs.splice(i, 1); drawSecs(); }, { cls: 'small danger' }))));
  };
  drawSecs();
  const terms = ta((s.terms || []).map((t) => (t.desc ? `${t.term}：${t.desc}` : t.term)).join('\n'), 5);
  const dec = ta((s.decisions || []).join('\n'), 3);
  const next = ta(s.next, 2);
  const save = async () => {
    const lines = (t) => t.value.split('\n').map((x) => x.trim()).filter(Boolean);
    await updateRecord(ctx.id, (r) => {
      r.summary = {
        ...r.summary, edited: true,
        overview: ov.value.trim(),
        sections: secs.map((x) => ({ heading: x.head.value.trim() || '要点', points: lines(x.body) })).filter((x) => x.points.length),
        terms: lines(terms).map((l) => { const m = /^(.+?)[：:]\s*(.*)$/.exec(l); return m ? { term: m[1].trim(), desc: m[2].trim() } : { term: l, desc: '' }; }),
        decisions: lines(dec), next: next.value.trim(),
      };
    });
    ctx.setEditing(false); toast('保存しました'); ctx.refresh();
  };
  box.append(h('div', { class: 'card' },
    h('h2', null, 'まとめを直す'),
    h('label', { class: 'field' }, h('span', null, '概要'), ov),
    secBox,
    btn('見出しを足す', () => { secs.push({ head: h('input', { type: 'text', value: '' }), body: ta('', 3) }); drawSecs(); }, { cls: 'small' }),
    h('hr', { class: 'sep' }),
    h('label', { class: 'field' }, h('span', null, '大事な用語（1行に「用語：説明」）'), terms),
    h('label', { class: 'field' }, h('span', null, '決まったこと（1行に1つ）'), dec),
    h('label', { class: 'field' }, h('span', null, '次回'), next),
    h('div', { class: 'row' }, btn('保存する', save, { cls: 'primary' }), btn('やめる', () => { ctx.setEditing(false); ctx.refresh(); })),
  ));
}
