// 記録の画面（処理の手順・部外秘の選択・各タブ）
import { h, svg, fmtDur, fmtDateJa, toast, dialog, confirmDialog, btn } from '../ui.js';
import { getRecord, updateRecord, onChange } from '../db.js';
import { startJob, getJob, onJobs, cancelJob, lastJobResult, clearJobResult } from '../jobs.js';
import { runDiarization } from '../diarize.js';
import { runTranscription, transEngine, engineLabel, pendingCount } from '../transcribe.js';
import { runSummary, summaryEngine, summaryEngineLabel } from '../summarize.js';
import { externalReady } from '../external.js';
import { whisperChoice, llmChoice } from '../device.js';
import { mlCall } from '../ml-client.js';
import { unloadEngine } from '../llm-local.js';
import { privacyBadge, progressBar } from './common.js';
import * as TSum from './d-summary.js';
import * as TTrans from './d-trans.js';
import * as TSpk from './d-speakers.js';
import * as TQ from './d-questions.js';
import * as TInfo from './d-info.js';

const TABS = [
  ['summary', 'まとめ', TSum], ['trans', '文字起こし', TTrans], ['speakers', '話者', TSpk], ['questions', '質問', TQ], ['info', '情報・書き出し', TInfo],
];

export async function render(view, [id, tab]) {
  let rec = await getRecord(id);
  if (!rec) { view.append(h('div', { class: 'notice err' }, h('strong', null, '記録が見つかりません'), h('a', { href: '#/' }, '一覧へもどる'))); return; }
  const ui = { tab: TABS.some((t) => t[0] === tab) ? tab : 'summary', editing: false, procOpen: null, opts: { includeOff: false, autoSum: true, single: false } };

  const head = h('div', { class: 'dhead' });
  const privBox = h('div');
  const procBox = h('div');
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { role: 'tabpanel' });
  view.append(head, privBox, procBox, tabsEl, body);

  const ctx = {
    id, get rec() { return rec; }, ui,
    setEditing: (v) => { ui.editing = v; },
    setTab: (t) => { ui.tab = t; history.replaceState(null, '', `#/r/${id}/${t}`); drawTabs(); drawBody(); window.scrollTo({ top: 0 }); },
    refresh: async () => { rec = await getRecord(id); drawAll(); },
    startSummary: () => doSummary(),
    startTranscribe: () => doTranscribe(),
    ensurePrivacy: () => ensurePrivacy(),
  };

  // ---------- 見出し ----------
  function drawHead() {
    head.innerHTML = '';
    head.append(
      h('h1', null, rec.title || '（タイトルなし）'),
      h('div', { class: 'meta' }, h('span', null, fmtDateJa(rec.date) + (rec.time ? ' ' + rec.time : '')), rec.audio && rec.audio.duration ? h('span', null, '録音 ' + fmtDur(rec.audio.duration)) : null, rec.place ? h('span', null, rec.place) : null, privacyBadge(rec)),
    );
    if (rec.recovered) head.append(h('div', { class: 'notice warn small', style: { marginTop: '10px' } }, '途中で止まった録音を、保存されたところまで復元しました。'));
  }

  // ---------- 部外秘かどうか ----------
  async function choosePrivacy(kind) {
    if (kind === 'confidential') {
      const ok = await confirmDialog('部外秘にしますか？', [
        '部外秘にすると、この記録はロックされ、これから先ずっと外部サービスには送れなくなります（元に戻せません）。',
        '文字起こし・要約・質問づくりは、すべてこの端末の中で行います。',
      ], { ok: '部外秘にしてロック', okCls: 'lock' });
      if (!ok) return false;
      await updateRecord(id, (r) => { r.privacy = 'confidential'; r.privacyAt = Date.now(); });
      toast('部外秘にしました（ロック）');
      return true;
    }
    if (rec.privacy === 'confidential') { toast('部外秘の記録は変更できません', 'err'); return false; }
    const ready = await externalReady();
    const ok = await confirmDialog('部外秘ではない、にしますか？', [
      'オンにした人の声（音声）と文字起こしが、外部の無料サービス（Google Gemini・Groq）に送られ、より正確に処理されます。オフにした人の声は送りません。',
      '無料のサービスでは、送った内容がサービスの改善に使われることがあります。社外秘・個人情報を含む場合は「部外秘」を選んでください。',
      ready.gemini || ready.groq ? 'あとから「部外秘」に変えることもできます（そのときはロックされます）。' : '※ 外部サービスの準備（APIキー）がまだです。準備するまでは端末の中で処理します。',
    ], { ok: '部外秘ではない', okCls: 'pub' });
    if (!ok) return false;
    await updateRecord(id, (r) => { r.privacy = 'public'; r.privacyAt = Date.now(); });
    toast('部外秘ではない、にしました');
    return true;
  }
  async function ensurePrivacy() {
    rec = await getRecord(id);
    if (rec.privacy !== 'unset') return true;
    const v = await dialog({
      title: 'この録音の扱いを選んでください',
      body: [h('p', null, '文字起こし・要約の前に選びます。'), h('p', { class: 'small muted' }, '「部外秘」を選ぶとロックされ、外部サービスには二度と送れなくなります。')],
      dismissValue: null,
      buttons: [{ label: 'やめる', value: null }, { label: '部外秘ではない', value: 'public', cls: 'pub' }, { label: '部外秘（端末内のみ）', value: 'confidential', cls: 'lock' }],
    });
    if (!v) return false;
    return choosePrivacy(v);
  }
  let privSeq = 0;
  async function drawPriv() {
    const my = ++privSeq;
    const ready0 = rec.privacy === 'public' ? await externalReady() : null;
    if (my !== privSeq) return;
    privBox.innerHTML = '';
    if (rec.privacy === 'confidential') {
      privBox.append(h('div', { class: 'notice lock' }, h('strong', { html: svg('lock') + ' 部外秘（ロック中）' }), h('span', { class: 'small' }, 'この記録は端末の中だけで処理します。外部サービスには送れません。この設定は変えられません。')));
    } else if (rec.privacy === 'public') {
      const ready = ready0;
      const box = h('div', { class: 'notice pub' }, h('strong', { html: svg('globe') + ' 部外秘ではない' }),
        h('span', { class: 'small' }, ready.gemini || ready.groq ? '外部サービスで、より正確に処理します。送るのはオンにした人の声と文字だけです。' : '外部サービスの準備（APIキー）がまだなので、いまは端末の中で処理します。'),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          !(ready.gemini || ready.groq) ? h('a', { class: 'btn small primary', href: '#/setup' }, '外部サービスを準備する') : null,
          btn('部外秘に変える（元に戻せません）', () => choosePrivacy('confidential'), { cls: 'small' })),
      );
      privBox.append(box);
    } else {
      privBox.append(h('div', { class: 'notice warn' },
        h('strong', null, 'この録音の扱いを選んでください'),
        h('p', { class: 'small', style: { margin: '2px 0 10px' } }, '社外秘・個人情報を含むかもしれないときは「部外秘」を選びます。部外秘にするとロックされ、外部サービスには二度と送れません。選ぶまでは、端末の中だけで処理します。'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn lock', html: svg('lock') + '<span>部外秘（端末内のみ）</span>', onclick: () => choosePrivacy('confidential') }),
          h('button', { type: 'button', class: 'btn pub', html: svg('globe') + '<span>部外秘ではない（外部で高精度）</span>', onclick: () => choosePrivacy('public') })),
      ));
    }
  }

  // ---------- 処理の手順 ----------
  function run(kind, fn) {
    if (getJob(id)) { toast('いま処理中です'); return; }
    clearJobResult(id);
    startJob(id, kind, fn).then(() => { toast('終わりました'); }).catch((e) => {
      if (e && e.name === 'AbortError') toast('中止しました');
      else { console.error(e); toast((e && e.message) || 'エラーが起きました', 'err', 6000); }
    });
    drawProc();
  }
  const freeModels = async () => { try { await mlCall('dispose', { which: 'asr' }); } catch (e) { /* 無視 */ } };
  async function doDiarize() {
    if (rec.segs && rec.segs.some((s) => s.text != null)) {
      const ok = await confirmDialog('話者を分け直しますか？', '文字起こし・手直しした内容は消えて、文字起こしもやり直しになります。（人数やしきい値だけ変えるなら「話者」タブの「分け直す」が速く、文字は消えません）', { ok: '分け直す', danger: true });
      if (!ok) return;
      await updateRecord(id, (r) => { r.segs = []; r.summary = r.summary; r.trans = null; });
    }
    run('diar', ({ signal, progress }) => runDiarization(id, { signal, progress, single: ui.opts.single }));
  }
  async function doTranscribe() {
    if (!(await ensurePrivacy())) return;
    run('trans', async ({ signal, progress }) => {
      await runTranscription(id, { signal, progress, includeOff: ui.opts.includeOff });
      if (ui.opts.autoSum) {
        const r = await getRecord(id);
        if (pendingCount(r) === 0) { await freeModels(); await runSummary(id, { signal, progress: (p) => progress({ ...p, text: 'まとめ：' + (p.text || '') }) }); }
      }
    });
  }
  async function doSummary() {
    if (!(await ensurePrivacy())) return;
    run('sum', async ({ signal, progress }) => { await freeModels(); await runSummary(id, { signal, progress }); });
  }
  async function doAll() {
    if (!(await ensurePrivacy())) return;
    run('all', async ({ signal, progress }) => {
      const step = (n, label) => (p) => progress({ ratio: p.ratio, eta: p.eta, text: `${n}/3 ${label}：${p.text || ''}` });
      let r = await getRecord(id);
      if (!r.diar || !r.diar.done) await runDiarization(id, { signal, progress: step(1, '話者を分ける'), single: ui.opts.single });
      await runTranscription(id, { signal, progress: step(2, '文字起こし'), includeOff: ui.opts.includeOff });
      r = await getRecord(id);
      if (pendingCount(r) === 0) { await freeModels(); await runSummary(id, { signal, progress: step(3, 'まとめ') }); }
    });
  }

  let engineInfo = null;
  async function loadEngineInfo() {
    const [te, se, wc, lc] = await Promise.all([transEngine(rec), summaryEngine(rec), whisperChoice(), llmChoice()]);
    engineInfo = {
      trans: te === 'local' ? engineLabel('local', `・${wc.label}`) : engineLabel(te),
      sum: se === 'local' ? `端末内AI（${lc.label}）` : summaryEngineLabel(se),
    };
  }

  let procSeq = 0;
  async function drawProc() {
    const my = ++procSeq;
    await loadEngineInfo();
    if (my !== procSeq) return;
    procBox.innerHTML = '';
    const job = getJob(id);
    const last = lastJobResult(id);
    const diarDone = !!(rec.diar && rec.diar.done);
    const hasText = (rec.segs || []).some((s) => s.text != null);
    const pending = diarDone ? pendingCount(rec) : 0;
    const transDone = diarDone && hasText && pending === 0;
    const sumDone = !!rec.summary;
    const allDone = diarDone && transDone && sumDone;
    if (ui.procOpen == null) ui.procOpen = !allDone;
    if (ui.wasAllDone === false && allDone && !job) ui.procOpen = false; // 処理が終わったら、たたむ
    ui.wasAllDone = allDone;
    const noAudio = !rec.audio || !rec.audio.chunks;

    const card = h('div', { class: 'card' });
    const top = h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, allDone ? '✓ 処理が終わっています' : '処理の手順'));
    if (allDone && !job) top.append(btn(ui.procOpen ? '閉じる' : 'ひらく', () => { ui.procOpen = !ui.procOpen; drawProc(); }, { cls: 'small ghost' }));
    card.append(top);

    if (job) {
      const eta = job.eta != null ? `（のこり 約${fmtDur(job.eta)}）` : '';
      card.append(h('div', { style: { margin: '12px 0 6px', fontWeight: 600 } }, job.text + eta), progressBar(job.ratio, !job.ratio),
        h('div', { class: 'row', style: { marginTop: '10px' } }, btn('中止する', () => cancelJob(id), { cls: 'small danger' }),
          h('span', { class: 'tiny muted' }, 'ほかの画面に移っても処理は続きます。この画面（タブ）は閉じないでください。')));
    } else if (last && !last.ok && last.error && last.error.name !== 'AbortError') {
      card.append(h('div', { class: 'notice err small', style: { margin: '10px 0 0' } }, h('strong', null, 'うまくいきませんでした'), String(last.error.message || last.error)));
    }
    if (noAudio && !hasText) { card.append(h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'この記録には音声がありません。')); procBox.append(card); return; }
    if (!ui.procOpen && !job) { card.append(h('p', { class: 'tiny muted', style: { margin: '4px 0 0' } }, `文字起こし：${(rec.trans && rec.trans.model) || ''}　まとめ：${rec.summary ? summaryEngineLabel(rec.summary.engine) : ''}`)); procBox.append(card); return; }

    const busy = !!job;
    const steps = h('ol', { class: 'steps', style: { marginTop: '14px' } });
    // 1 話者
    const s1 = h('li', { class: diarDone ? 'done' : 'now' }, h('h3', null, '話者を分ける'));
    if (diarDone) s1.append(h('p', { class: 'small muted' }, `${rec.speakers.length}人に分けました。` + (rec.diar.single ? '（分けずにひとりとして扱っています）' : '')));
    else s1.append(h('p', { class: 'small muted' }, '声の違いで A・B・C… に分けます（端末の中で処理）。いちばん長く話している人、または録音中に印をつけた人が A（先生）になります。'));
    const single = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: ui.opts.single, onchange: (e) => { ui.opts.single = e.target.checked; } }), h('span', null, '話者を分けない（ひとりとして扱う・速い）'));
    if (!diarDone || ui.procOpen) s1.append(single, h('div', { class: 'row' },
      noAudio ? null : btn(diarDone ? 'もう一度分ける' : '話者を分ける', doDiarize, { cls: diarDone ? 'small' : 'primary', disabled: busy, ic: 'users' }),
      !diarDone && !noAudio ? btn('全部まとめて進める', doAll, { cls: '', disabled: busy, ic: 'spark' }) : null));
    steps.append(s1);
    // 2 残す人
    const onList = (rec.speakers || []).filter((s) => s.on).map((s) => s.id + (s.name ? `（${s.name}）` : ''));
    const s2 = h('li', { class: diarDone ? (onList.length ? 'done' : 'now') : '' }, h('h3', null, '残す人を選ぶ'));
    if (diarDone) s2.append(h('p', { class: 'small' }, onList.length ? `オン：${onList.join('、')}` : 'オンの人がいません'), btn('話者を確かめる・名前をつける', () => ctx.setTab('speakers'), { cls: 'small', ic: 'users' }));
    else s2.append(h('p', { class: 'small muted' }, '分けたあと、それぞれの声を聞いて、残す人（オン）と関係ない人（オフ）を選べます。'));
    steps.append(s2);
    // 3 文字起こし
    const s3 = h('li', { class: transDone ? 'done' : diarDone ? 'now' : '' }, h('h3', null, '文字起こし'));
    s3.append(h('p', { class: 'small muted' }, `方法：${engineInfo.trans}`));
    if (diarDone) {
      s3.append(h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: ui.opts.includeOff, onchange: (e) => { ui.opts.includeOff = e.target.checked; } }), h('span', null, 'オフにした人の発言も文字起こしする（時間がかかります）')));
      s3.append(h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: ui.opts.autoSum, onchange: (e) => { ui.opts.autoSum = e.target.checked; } }), h('span', null, '終わったら、続けてまとめをつくる')));
      if (!transDone) s3.append(btn(hasText ? `残り ${pending} か所を文字起こし` : '文字起こしをはじめる', doTranscribe, { cls: 'primary', disabled: busy || !onList.length, ic: 'file' }));
      else s3.append(h('p', { class: 'small' }, `済み（${(rec.trans && rec.trans.model) || ''}）`));
    }
    steps.append(s3);
    // 4 まとめ
    const s4 = h('li', { class: sumDone ? 'done' : transDone ? 'now' : '' }, h('h3', null, 'まとめ・質問'));
    s4.append(h('p', { class: 'small muted' }, `方法：${engineInfo.sum}`));
    if (hasText) s4.append(btn(sumDone ? 'まとめをつくり直す' : 'まとめをつくる', doSummary, { cls: sumDone ? 'small' : 'primary', disabled: busy, ic: 'spark' }));
    steps.append(s4);
    card.append(steps);
    procBox.append(card);
  }

  // ---------- タブ ----------
  function drawTabs() {
    tabsEl.innerHTML = '';
    for (const [k, label] of TABS) {
      tabsEl.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.tab === k), onclick: () => ctx.setTab(k) }, label));
    }
  }
  function drawBody() {
    if (ui.editing) return;
    body.innerHTML = '';
    const mod = (TABS.find((t) => t[0] === ui.tab) || TABS[0])[2];
    try { mod.draw(body, ctx); } catch (e) { console.error(e); body.append(h('div', { class: 'notice err' }, String(e.message || e))); }
  }
  function drawAll() { drawHead(); drawPriv(); drawProc(); drawTabs(); drawBody(); }
  drawAll();

  let t = null;
  const offDb = onChange((cid) => { if (cid !== id) return; clearTimeout(t); t = setTimeout(async () => { rec = await getRecord(id); if (!rec) { location.hash = '#/'; return; } drawHead(); drawPriv(); drawProc(); drawBody(); }, 250); });
  let pt = null;
  const offJobs = onJobs((rid) => { if (rid !== id) return; if (pt) return; pt = setTimeout(() => { pt = null; drawProc(); }, 300); });
  return () => { offDb(); offJobs(); clearTimeout(t); clearTimeout(pt); };
}
