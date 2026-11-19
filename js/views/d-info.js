// 情報・書き出しタブ（会議の情報・宿題・書き出し・音声・削除）
import { h, svg, btn, toast, confirmDialog, fmtBytes, uid, iconBtn, fmtDateJa } from '../ui.js';
import { updateRecord, deleteRecord, deleteAudio } from '../db.js';
import { toText, toMarkdown, toPdf, download, share, fileBase, taskIcs } from '../export.js';
import { compressedAudio, wholeWav } from '../audio.js';
import { dueLabel, daysLeft, askPermission } from '../notify.js';
import { detect } from '../device.js';
import { getJob } from '../jobs.js';

const expOpts = { transcript: true, includeOff: false };

export function draw(box, ctx) {
  const rec = ctx.rec;
  box.append(infoCard(ctx), tasksCard(ctx), exportCard(ctx), audioCard(ctx), dangerCard(ctx));
}

function infoCard(ctx) {
  const rec = ctx.rec;
  const f = (key, label, attrs = {}) => {
    const el = h(attrs.multiline ? 'textarea' : 'input', { type: attrs.type || 'text', rows: attrs.multiline ? (attrs.rows || 3) : null, placeholder: attrs.placeholder || '' });
    el.value = rec[key] || '';
    let t = null;
    el.addEventListener('focus', () => ctx.setEditing(true));
    el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => updateRecord(ctx.id, (r) => { r[key] = el.value; }), 400); });
    el.addEventListener('blur', () => { clearTimeout(t); updateRecord(ctx.id, (r) => { r[key] = el.value; }).then(() => { ctx.setEditing(false); }); });
    return h('label', { class: 'field' }, h('span', null, label), el);
  };
  return h('div', { class: 'card' },
    h('h2', { html: svg('info') + '<span>講義・会議の情報</span>' }),
    f('title', 'タイトル'),
    h('div', { class: 'grid2' }, f('date', '日付', { type: 'date' }), f('time', '開始時刻', { type: 'time' })),
    f('place', '場所'), f('participants', '参加者'), f('agenda', '議題・テーマ', { multiline: true }),
    f('memo', 'メモ（自由に）', { multiline: true, rows: 4 }),
  );
}

// 宿題の一覧（まとめタブでも使う）
export function taskList(ctx, { compact = false } = {}) {
  const rec = ctx.rec;
  const ul = h('ul', { class: 'tasklist' });
  for (const t of rec.tasks || []) {
    const n = daysLeft(t.due);
    const cb = h('input', { type: 'checkbox', checked: !!t.done, 'aria-label': '済んだ', onchange: (e) => updateRecord(ctx.id, (r) => { const x = r.tasks.find((q) => q.id === t.id); if (x) x.done = e.target.checked; }) });
    const meta = h('div', { class: 'tmeta' + (n != null && n < 0 && !t.done ? ' late' : '') },
      [t.who ? `担当：${t.who}` : '', t.due ? `期限：${fmtDateJa(t.due)}（${dueLabel(t.due)}）` : '期限なし', t.guess ? '自動で見つけた候補' : ''].filter(Boolean).join('　'));
    const right = h('div', { class: 'row nowrap' });
    if (!compact) {
      if (t.due) right.append(iconBtn('calendar', 'カレンダーに追加（前日の9時にお知らせ）', () => download(`${fileBase(rec)}_期限.ics`, taskIcs(rec, t))));
      right.append(iconBtn('edit', '直す', () => editTask(ctx, t)));
      right.append(iconBtn('trash', '消す', async () => { if (await confirmDialog('この宿題を消しますか？', t.text, { ok: '消す', danger: true })) updateRecord(ctx.id, (r) => { r.tasks = r.tasks.filter((q) => q.id !== t.id); }); }));
    }
    ul.append(h('li', { class: 'task' + (t.done ? ' done' : '') }, cb, h('div', null, h('div', { class: 'ttext' }, t.text), meta), right));
  }
  return ul;
}

async function editTask(ctx, t) {
  const { dialog } = await import('../ui.js');
  const text = h('textarea', { rows: 3 }); text.value = t?.text || '';
  const who = h('input', { type: 'text', placeholder: '例）自分、全員、田中さん' }); who.value = t?.who || '';
  const due = h('input', { type: 'date' }); due.value = t?.due || '';
  const v = await dialog({
    title: t ? '宿題を直す' : '宿題を足す',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, '内容'), text), h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, '担当'), who), h('label', { class: 'field' }, h('span', null, '期限'), due))),
    dismissValue: null,
    buttons: [{ label: 'やめる', value: null }, { label: '保存', value: () => ({ text: text.value.trim(), who: who.value.trim(), due: due.value }), cls: 'primary' }],
    onOpen: () => setTimeout(() => text.focus(), 50),
  });
  if (!v || !v.text) return;
  await updateRecord(ctx.id, (r) => {
    r.tasks = r.tasks || [];
    if (t) { const x = r.tasks.find((q) => q.id === t.id); if (x) { Object.assign(x, v); x.guess = false; if (x.notifiedOn) delete x.notifiedOn; } }
    else r.tasks.push({ id: uid('t'), ...v, done: false, from: 'manual' });
  });
  if (v.due && 'Notification' in window && Notification.permission === 'default') {
    const ok = await confirmDialog('期限のお知らせを受け取りますか？', 'アプリを開いたときに、期限が近い宿題をお知らせします。確実に知らせてほしいときは、カレンダーに追加してください。', { ok: '受け取る', cancel: 'あとで' });
    if (ok) await askPermission();
  }
}

function tasksCard(ctx) {
  return h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 }, html: svg('check') + '<span>宿題・やること</span>' }), btn('足す', () => editTask(ctx, null), { cls: 'small', ic: 'edit' })),
    (ctx.rec.tasks || []).length ? taskList(ctx) : h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'まだありません。まとめをつくると、宿題らしいものを自動で入れます。'),
    h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, '📅 を押すとカレンダーに追加できます（期限の前日9時にお知らせ）。アプリを開いたときにも、期限が近いものをお知らせします。'),
  );
}

function exportCard(ctx) {
  const rec = ctx.rec;
  const opt = (key, label) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: expOpts[key], onchange: (e) => { expOpts[key] = e.target.checked; } }), h('span', null, label));
  const doExport = async (kind) => {
    try {
      const o = { transcript: expOpts.transcript, includeOff: expOpts.includeOff };
      let blob, name;
      if (kind === 'txt') { blob = new Blob(['﻿' + toText(rec, o)], { type: 'text/plain;charset=utf-8' }); name = fileBase(rec) + '.txt'; }
      else if (kind === 'md') { blob = new Blob([toMarkdown(rec, o)], { type: 'text/markdown;charset=utf-8' }); name = fileBase(rec) + '.md'; }
      else { toast('PDFをつくっています…'); blob = await toPdf(rec, o); name = fileBase(rec) + '.pdf'; }
      const d = await detect();
      if (d.mobile && (await share(name, blob))) return;
      download(name, blob);
      toast('保存しました：' + name);
    } catch (e) { console.error(e); toast('書き出せませんでした：' + e.message, 'err', 5000); }
  };
  return h('div', { class: 'card' },
    h('h2', { html: svg('download') + '<span>書き出す（ダウンロード）</span>' }),
    h('div', { class: 'stack', style: { marginBottom: '10px' } }, opt('transcript', '文字起こしも入れる'), opt('includeOff', 'オフにした人の発言も入れる')),
    h('div', { class: 'row' }, btn('テキスト (.txt)', () => doExport('txt'), { ic: 'file' }), btn('Markdown (.md)', () => doExport('md'), { ic: 'file' }), btn('PDF', () => doExport('pdf'), { cls: 'primary', ic: 'download' })),
    rec.privacy === 'confidential' ? h('p', { class: 'tiny muted', style: { marginTop: '8px' } }, '部外秘の記録です。書き出したファイルの取りあつかいに気をつけてください。') : null,
  );
}

function audioCard(ctx) {
  const rec = ctx.rec;
  const a = rec.audio || {};
  const has = a.chunks > 0;
  const size = has ? a.samples * 2 + (a.compressed ? a.duration * 4000 : 0) : 0;
  return h('div', { class: 'card' },
    h('h2', { html: svg('wave') + '<span>音声</span>' }),
    has ? h('p', { class: 'small' }, `保存している音声：約${fmtBytes(size)}（この端末の中）`) : h('p', { class: 'small muted' }, '音声は削除されています（文字は残っています）。'),
    has ? h('div', { class: 'row' },
      btn('音声を書き出す', async () => {
        try {
          let blob = await compressedAudio(rec); let ext = '';
          if (blob) ext = /mp4|m4a|aac/.test(blob.type) ? '.m4a' : /ogg/.test(blob.type) ? '.ogg' : '.webm';
          else { blob = await wholeWav(rec); ext = '.wav'; }
          download(fileBase(rec) + ext, blob);
        } catch (e) { toast('書き出せませんでした：' + e.message, 'err'); }
      }, { ic: 'download' }),
      btn('音声を削除して容量を空ける', async () => {
        if (getJob(ctx.id)) { toast('処理中は削除できません'); return; }
        if (!(await confirmDialog('音声を削除しますか？', '文字起こし・まとめは残ります。音声の再生・文字起こしのやり直し・話者の分け直しはできなくなります。', { ok: '削除する', danger: true }))) return;
        await deleteAudio(ctx.id);
        await updateRecord(ctx.id, (r) => { r.audio = { ...r.audio, chunks: 0, samples: 0, compressed: null, removed: true }; });
        toast('音声を削除しました');
      }, { cls: 'danger', ic: 'trash' })) : null,
  );
}

function dangerCard(ctx) {
  return h('div', { class: 'card' },
    btn('この記録を削除する', async () => {
      if (getJob(ctx.id)) { toast('処理中は削除できません'); return; }
      if (!(await confirmDialog('この記録を削除しますか？', '音声・文字起こし・まとめ・質問がすべて消えます。元に戻せません。', { ok: '削除する', danger: true }))) return;
      await deleteRecord(ctx.id);
      toast('削除しました');
      location.hash = '#/';
    }, { cls: 'danger block', ic: 'trash' }));
}
