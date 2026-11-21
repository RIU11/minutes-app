// 一覧（ホーム）
import { h, svg, fmtDur, fmtDateJa, normalize, toast, todayISO, nowHM } from '../ui.js';
import { listRecords, onChange, putRecord, newRecord, updateRecord, kvGet } from '../db.js';
import { dueTasks, dueLabel } from '../notify.js';
import { decodeFileTo16k, storeFloatAsChunks } from '../audio.js';
import { privacyBadge, stateBadge } from './common.js';

export async function render(view) {
  const search = h('input', { type: 'search', placeholder: 'タイトル・内容・人の名前でさがす', 'aria-label': '記録をさがす' });
  try { search.value = sessionStorage.getItem('home-q') || ''; } catch (e) { /* 無視 */ }
  const fileIn = h('input', { type: 'file', accept: 'audio/*,video/*,.m4a,.mp3,.wav,.webm,.ogg,.aac,.mp4,.mov', class: 'hide' });
  const importBtn = h('button', { type: 'button', class: 'btn', html: '<span>音声ファイルを読み込む</span>', onclick: () => fileIn.click() });
  const hero = h('div', { class: 'hero' },
    h('a', { class: 'btn rec big', href: '#/rec' }, '録音をはじめる'),
    importBtn,
  );
  const dueBox = h('div');
  const listBox = h('div');
  view.append(h('h1', { class: 'pagetitle' }, '議事録'), h('div', { class: 'searchbox', html: svg('search') }, search), hero, fileIn, dueBox, listBox);

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    importBtn.disabled = true;
    const label = importBtn.querySelector('span');
    try {
      label.textContent = '読み込み中…';
      const f32 = await decodeFileTo16k(f, (p, t) => { label.textContent = t; });
      if (f32.length < 16000) throw new Error('音声が短すぎます');
      const r = newRecord({ title: f.name.replace(/\.[^.]+$/, ''), source: 'file', fileName: f.name, state: 'recording' });
      if (f.lastModified) { const d = new Date(f.lastModified); r.date = todayISO(d); r.time = nowHM(d); }
      await putRecord(r);
      label.textContent = '保存中…';
      const res = await storeFloatAsChunks(r.id, f32);
      await updateRecord(r.id, (x) => { x.audio = { ...x.audio, ...res }; x.state = 'recorded'; });
      toast('読み込みました');
        if ((await kvGet('autoStart', true)) !== false) { try { sessionStorage.setItem('minutes-autostart', r.id); } catch (e) { /* 無視 */ } }
      location.hash = '#/r/' + r.id;
    } catch (e) {
      console.error(e);
      toast('読み込めませんでした：' + (e.message || 'この形式に対応していないか、長すぎます（長い音声はパソコンで読み込んでください）'), 'err', 5000);
    } finally { importBtn.disabled = false; label.textContent = '音声ファイルを読み込む'; }
  });

  let all = [];
  const draw = () => {
    const q = normalize(search.value.trim());
    try { sessionStorage.setItem('home-q', search.value); } catch (e) { /* 無視 */ }
    const items = q ? all.filter((r) => hay(r).includes(q)) : all;
    listBox.innerHTML = '';
    if (!all.length) {
      listBox.append(h('div', { class: 'empty card', html: svg('mic') },
        h('p', null, h('strong', null, 'まだ記録がありません')),
        h('p', { class: 'small' }, '「録音をはじめる」で講義や会議を録音すると、文字起こし・話者の分け・要約・質問の提案までできます。'),
        h('p', { class: 'small' }, '録音・文字起こし・要約は、すべてこの端末の中に保存されます。'),
      ));
      return;
    }
    if (!items.length) { listBox.append(h('p', { class: 'muted center' }, '見つかりませんでした')); return; }
    listBox.append(h('div', { class: 'sechead' }, q ? `${items.length}件` : 'すべての記録'));
    const ul = h('ul', { class: 'reclist' });
    for (const r of items) {
      const snip = (r.summary && r.summary.overview) || (r.segs || []).filter((s) => s.text).slice(0, 3).map((s) => s.text).join(' ') || r.agenda || '';
      ul.append(h('li', null, h('a', { class: 'recitem', href: '#/r/' + r.id },
        h('div', { class: 't' }, r.title || '（タイトルなし）'),
        h('div', { class: 'meta' }, h('span', null, fmtDateJa(r.date) + (r.time ? ' ' + r.time : '')), r.audio && r.audio.duration ? h('span', null, fmtDur(r.audio.duration)) : null, privacyBadge(r), stateBadge(r)),
        snip ? h('div', { class: 'snip' }, snip) : null,
      )));
    }
    listBox.append(ul);
  };
  const hay = (r) => normalize([r.title, r.place, r.participants, r.agenda, r.memo, (r.speakers || []).map((s) => s.name).join(' '),
    r.summary ? [r.summary.overview, ...(r.summary.sections || []).flatMap((s) => [s.heading, ...s.points]), ...(r.summary.terms || []).map((t) => t.term)].join(' ') : '',
    (r.segs || []).map((s) => s.text || '').join(' '), (r.tasks || []).map((t) => t.text).join(' ')].join(' '));

  const drawDue = async () => {
    const list = await dueTasks(3);
    dueBox.innerHTML = '';
    if (!list.length) return;
    const ul = h('ul', { class: 'duelist' });
    for (const { rec, task, days } of list.slice(0, 6)) {
      ul.append(h('li', null, h('span', { class: 'badge ' + (days < 0 ? 'unset' : days <= 1 ? 'unset' : 'info'), style: days < 0 ? { color: 'var(--danger)' } : null }, dueLabel(task.due)),
        h('a', { href: `#/r/${rec.id}/info`, class: 'grow' }, task.text), h('span', { class: 'tiny muted' }, rec.title || '')));
    }
    dueBox.append(h('div', { class: 'sechead' }, '期限が近い宿題'), h('div', { class: 'card tight' }, ul));
  };

  const reload = async () => { all = await listRecords(); all = all.filter((r) => r.state !== 'failed'); draw(); drawDue(); };
  search.addEventListener('input', draw);
  const off = onChange(() => { clearTimeout(t); t = setTimeout(reload, 200); });
  let t = null;
  await reload();
  return () => { off(); clearTimeout(t); };
}
