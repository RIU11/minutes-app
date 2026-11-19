// 質問タブ（系統を選んで質問を考えてもらう）
import { h, svg, btn, toast, copyText, iconBtn, fmtStamp } from '../ui.js';
import { updateRecord } from '../db.js';
import { runQuestions, QCATS, summaryEngine, summaryEngineLabel } from '../summarize.js';
import { startJob, getJob } from '../jobs.js';

const state = { cat: 'deep', free: '', count: 5 };

export function draw(box, ctx) {
  const rec = ctx.rec;
  const hasText = (rec.segs || []).some((x) => x.text);
  if (!hasText) {
    box.append(h('div', { class: 'card empty', html: svg('question') }, h('p', null, h('strong', null, '質問を考えるには、先に文字起こしが必要です')), h('p', { class: 'small' }, '「処理の手順」の 1〜3 を進めてください。')));
    return;
  }
  const chips = h('div', { class: 'row', role: 'group', 'aria-label': '質問の系統' });
  const paintChips = () => {
    chips.innerHTML = '';
    for (const c of QCATS) chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.cat === c.id), title: c.hint, onclick: () => { state.cat = c.id; paintChips(); hint.textContent = c.hint; } }, c.label));
  };
  const hint = h('p', { class: 'tiny muted', style: { margin: '6px 0 0' } }, (QCATS.find((c) => c.id === state.cat) || QCATS[0]).hint);
  paintChips();
  const free = h('textarea', { rows: 2, placeholder: '例）先生に授業のあとで聞きたい／グループで話し合うための問い／もっと基礎的なこと' });
  free.value = state.free;
  free.addEventListener('input', () => { state.free = free.value; });
  const count = h('select', { 'aria-label': '質問の数', style: { width: 'auto' } }, [3, 5, 8].map((n) => h('option', { value: String(n) }, `${n}個`)));
  count.value = String(state.count);
  count.addEventListener('change', () => { state.count = +count.value; });
  const engineNote = h('span', { class: 'tiny muted' });
  summaryEngine(rec).then((e) => { engineNote.textContent = '考える方法：' + summaryEngineLabel(e); });
  const go = btn('質問を考える', async () => {
    if (getJob(ctx.id)) { toast('いま処理中です'); return; }
    if (!(await ctx.ensurePrivacy())) return;
    go.disabled = true; go.querySelector('span').textContent = '考えています…';
    try {
      await startJob(ctx.id, 'q', ({ signal, progress }) => runQuestions(ctx.id, { cat: state.cat, free: state.free.trim(), count: state.count, signal, progress }));
      toast('質問ができました');
    } catch (e) { if (e.name !== 'AbortError') toast(e.message || 'うまくいきませんでした', 'err', 5000); } finally { go.disabled = false; go.querySelector('span').textContent = '質問を考える'; }
  }, { cls: 'primary', ic: 'question' });

  box.append(h('div', { class: 'card' },
    h('h2', { html: svg('question') + '<span>どんな質問をしたいですか？</span>' }),
    chips, hint,
    h('label', { class: 'field', style: { marginTop: '12px' } }, h('span', null, '希望を自由に書く（なくてもOK）'), free),
    h('div', { class: 'row' }, go, count, engineNote),
  ));

  const list = rec.questions || [];
  if (!list.length) { box.append(h('p', { class: 'muted small center' }, 'まだ質問はありません。系統を選んで「質問を考える」を押してください。')); return; }
  for (const q of list) {
    const c = QCATS.find((x) => x.id === q.cat);
    const all = q.items.map((x, i) => `Q${i + 1}. ${x.q}`).join('\n');
    const ul = h('ol', { class: 'qlist' });
    for (const it of q.items) {
      const cp = iconBtn('copy', 'この質問をコピー', () => copyText(it.q)); cp.classList.add('copy');
      ul.append(h('li', null, it.q, it.why ? h('span', { class: 'why' }, it.why) : null, cp));
    }
    box.append(h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', null, h('span', { class: 'badge info' }, c ? c.label : '質問'), q.free ? h('span', { class: 'tiny muted', style: { marginLeft: '6px' } }, '希望：' + q.free) : null),
        h('div', { class: 'row' }, btn('全部コピー', () => copyText(all), { cls: 'small ghost', ic: 'copy' }), iconBtn('trash', 'この質問を消す', async () => { await updateRecord(ctx.id, (r) => { r.questions = (r.questions || []).filter((x) => x.id !== q.id); }); }))),
      ul,
      h('div', { class: 'engine-note' }, `${summaryEngineLabel(q.engine)}・${fmtStamp(q.at)}`),
    ));
  }
}
