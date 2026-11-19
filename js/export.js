// 書き出し（テキスト・Markdown・PDF・カレンダー・バックアップ）
import { fmtDur, fmtDateJa, todayISO } from './ui.js';
import { speakerOn } from './diarize.js';
import { listRecords, putRecord, getRecord } from './db.js';

const PRIV = { confidential: '部外秘（端末の中だけで処理）', public: '部外秘ではない（外部サービスで処理可）', unset: '未選択' };

export function fileBase(rec) {
  const t = (rec.title || '議事録').replace(/[\\/:*?"<>|\n\r\t]/g, '').slice(0, 40).trim() || '議事録';
  return `${rec.date || todayISO()}_${t}`;
}

// 書き出す内容を「ブロック」にする（テキスト・Markdown・PDF で共通）
export function blocks(rec, { transcript = true, includeOff = false, summary = true } = {}) {
  const B = [];
  B.push({ t: 'title', text: rec.title || '（タイトルなし）' });
  const rows = [['日時', `${fmtDateJa(rec.date)} ${rec.time || ''}`.trim()]];
  if (rec.place) rows.push(['場所', rec.place]);
  if (rec.participants) rows.push(['参加者', rec.participants]);
  if (rec.agenda) rows.push(['議題', rec.agenda]);
  if (rec.audio && rec.audio.duration) rows.push(['録音', fmtDur(rec.audio.duration)]);
  rows.push(['扱い', PRIV[rec.privacy] || PRIV.unset]);
  B.push({ t: 'meta', rows });
  const s = rec.summary;
  if (summary && s) {
    if (s.overview) { B.push({ t: 'h', text: '概要' }); B.push({ t: 'p', text: s.overview }); }
    for (const sec of s.sections || []) { B.push({ t: 'h', text: sec.heading || '要点' }); for (const p of sec.points || []) B.push({ t: 'li', text: p }); }
    if ((s.terms || []).length) { B.push({ t: 'h', text: '大事な用語' }); for (const x of s.terms) B.push({ t: 'li', text: x.desc ? `${x.term}：${x.desc}` : x.term }); }
    if ((s.decisions || []).length) { B.push({ t: 'h', text: '決まったこと' }); for (const d of s.decisions) B.push({ t: 'li', text: d }); }
  }
  if ((rec.tasks || []).length) {
    B.push({ t: 'h', text: '宿題・やること' });
    for (const k of rec.tasks) B.push({ t: 'li', text: `${k.done ? '［済］' : '［ ］'}${k.text}${k.who ? `（担当：${k.who}）` : ''}${k.due ? `（期限：${fmtDateJa(k.due)}）` : ''}` });
  }
  if (summary && s && s.next) { B.push({ t: 'h', text: '次回' }); B.push({ t: 'p', text: s.next }); }
  if (rec.memo) { B.push({ t: 'h', text: 'メモ' }); B.push({ t: 'p', text: rec.memo }); }
  if (transcript) {
    const spk = new Map((rec.speakers || []).map((x) => [x.id, x]));
    const segs = (rec.segs || []).filter((x) => x.text && (includeOff || speakerOn(rec, x.sp)));
    if (segs.length) {
      B.push({ t: 'h', text: includeOff ? '文字起こし（全員）' : '文字起こし' });
      for (const x of segs) { const sp = spk.get(x.sp); B.push({ t: 'seg', time: fmtDur(x.s), who: sp && sp.name ? `${x.sp}（${sp.name}）` : x.sp, text: x.text }); }
    }
  }
  return B;
}

export function toText(rec, opts) {
  const out = [];
  for (const b of blocks(rec, opts)) {
    if (b.t === 'title') out.push(`■ ${b.text}`);
    else if (b.t === 'meta') { b.rows.forEach(([k, v]) => out.push(`${k}：${v}`)); out.push('─'.repeat(24)); }
    else if (b.t === 'h') out.push('', `【${b.text}】`);
    else if (b.t === 'p') out.push(b.text);
    else if (b.t === 'li') out.push(`・${b.text}`);
    else if (b.t === 'seg') out.push(`[${b.time}] ${b.who}：${b.text}`);
  }
  return out.join('\n') + '\n';
}

export function toMarkdown(rec, opts) {
  const out = [];
  const escMd = (s) => String(s).replace(/([*_`#\[\]<>])/g, '\\$1');
  for (const b of blocks(rec, opts)) {
    if (b.t === 'title') out.push(`# ${escMd(b.text)}`, '');
    else if (b.t === 'meta') { out.push('| 項目 | 内容 |', '| --- | --- |'); b.rows.forEach(([k, v]) => out.push(`| ${k} | ${escMd(v).replace(/\|/g, '｜')} |`)); }
    else if (b.t === 'h') out.push('', `## ${escMd(b.text)}`, '');
    else if (b.t === 'p') out.push(escMd(b.text), '');
    else if (b.t === 'li') out.push(`- ${escMd(b.text)}`);
    else if (b.t === 'seg') out.push(`- **[${b.time}] ${escMd(b.who)}**：${escMd(b.text)}`);
  }
  return out.join('\n') + '\n';
}

// ---------- PDF（日本語フォントを埋め込む） ----------
let libsP = null;
function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('PDFの部品を読み込めませんでした')); document.head.append(s); });
}
function pdfLibs() {
  if (!libsP) {
    libsP = (async () => {
      if (!window.PDFLib) await loadScript('vendor/pdf-lib.min.js');
      if (!window.fontkit) await loadScript('vendor/fontkit.umd.min.js');
      const r = await fetch('fonts/MPLUS1p-Regular.ttf');
      if (!r.ok) throw new Error('フォントを読み込めませんでした');
      return { PDFLib: window.PDFLib, fontkit: window.fontkit, reg: await r.arrayBuffer() };
    })().catch((e) => { libsP = null; throw e; });
  }
  return libsP;
}

const CLOSE = '、。，．・：；？！ー」』）】〕〉》”’ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々…‥,.!?):;]}%';
function wrap(text, font, size, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const toks = para.match(/[A-Za-z0-9_@#$%&+\-=/.,:;'"!?()[\]]+|\s+|[\s\S]/gu) || [''];
    let line = '', w = 0;
    const width = (s) => { try { return font.widthOfTextAtSize(s, size); } catch (e) { return size * s.length; } };
    for (const tk of toks) {
      const tw = width(tk);
      if (w + tw <= maxW || !line) {
        if (tw > maxW && !line) { // 長すぎる英数字は文字ごとに切る
          for (const ch of tk) { const cw = width(ch); if (w + cw > maxW && line) { lines.push(line); line = ''; w = 0; } line += ch; w += cw; }
        } else { line += tk; w += tw; }
      } else if (tk.length === 1 && CLOSE.includes(tk)) { line += tk; w += tw; } // 行頭に句読点を置かない
      else if (/^\s+$/.test(tk)) { lines.push(line); line = ''; w = 0; }
      else { lines.push(line); line = tk.replace(/^\s+/, ''); w = width(line); }
    }
    lines.push(line);
  }
  return lines;
}

export async function toPdf(rec, opts) {
  const { PDFLib, fontkit, reg } = await pdfLibs();
  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // 文字だけを抜き出す埋め込み（subset）は、このフォントだと字が欠けるので、まるごと埋め込む
  const fR = await doc.embedFont(reg, { subset: false });
  const fB = fR; // 太字は少しずらして重ねて描く
  doc.setTitle(rec.title || '議事録'); doc.setCreator('議事録アプリ'); doc.setProducer('議事録アプリ'); doc.setLanguage('ja');
  const W = 595.28, H = 841.89, M = 48, CW = W - M * 2;
  const ink = rgb(0.1, 0.12, 0.15), gray = rgb(0.38, 0.42, 0.47), acc = rgb(0.11, 0.36, 0.56), line = rgb(0.85, 0.88, 0.91), soft = rgb(0.93, 0.96, 0.99);
  let page = null, y = 0;
  const pages = [];
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  const need = (h) => { if (!page || y - h < M + 20) newPage(); };
  const text = (s, x, yy, f, size, color, bold = false) => {
    page.drawText(s, { x, y: yy, size, font: f, color });
    if (bold) page.drawText(s, { x: x + size * 0.03, y: yy, size, font: f, color });
  };
  newPage();
  for (const b of blocks(rec, opts)) {
    if (b.t === 'title') {
      const ls = wrap(b.text, fB, 19, CW);
      for (const l of ls) { need(28); text(l, M, y - 19, fB, 19, ink, true); y -= 27; }
      y -= 4;
    } else if (b.t === 'meta') {
      const rows = b.rows.map(([k, v]) => [k, wrap(v, fR, 9.5, CW - 92).slice(0, 6)]);
      const rowsH = rows.reduce((a, r) => a + r[1].length * 14 + 3, 0) + 14;
      need(rowsH);
      page.drawRectangle({ x: M, y: y - rowsH, width: CW, height: rowsH, color: soft, borderColor: line, borderWidth: 0.8 });
      let yy = y - 18;
      for (const [k, ls] of rows) {
        text(k, M + 12, yy, fB, 9.5, gray, true);
        ls.forEach((l, i) => { text(l, M + 78, yy - i * 14, fR, 9.5, ink); });
        yy -= ls.length * 14 + 3;
      }
      y -= rowsH + 10;
    } else if (b.t === 'h') {
      need(40);
      y -= 10;
      page.drawRectangle({ x: M, y: y - 17, width: 4, height: 17, color: acc });
      text(b.text, M + 12, y - 14, fB, 13, acc, true);
      y -= 24;
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + CW, y: y + 2 }, thickness: 0.6, color: line });
      y -= 6;
    } else if (b.t === 'p' || b.t === 'li') {
      const ind = b.t === 'li' ? 14 : 0;
      const ls = wrap(b.text, fR, 10.5, CW - ind);
      ls.forEach((l, i) => {
        need(17);
        if (i === 0 && b.t === 'li') text('・', M, y - 11, fR, 10.5, acc);
        text(l, M + ind, y - 11, fR, 10.5, ink); y -= 16.5;
      });
      y -= 3;
    } else if (b.t === 'seg') {
      need(30);
      text(`${b.time}  ${b.who}`, M, y - 9, fB, 8.5, gray, true); y -= 13;
      for (const l of wrap(b.text, fR, 10, CW - 8)) { need(16); text(l, M + 8, y - 10, fR, 10, ink); y -= 15.5; }
      y -= 4;
    }
  }
  const title = (rec.title || '議事録').slice(0, 40);
  pages.forEach((p, i) => {
    const s = `${title}　${i + 1} / ${pages.length}`;
    const w = fR.widthOfTextAtSize(s, 8);
    p.drawText(s, { x: (W - w) / 2, y: 24, size: 8, font: fR, color: gray });
  });
  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- 保存（ダウンロード） ----------
export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function share(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  return false;
}

// ---------- カレンダー（.ics） ----------
function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
export function taskIcs(rec, task) {
  const d = (task.due || '').replace(/-/g, '');
  const n = new Date(+task.due.slice(0, 4), +task.due.slice(5, 7) - 1, +task.due.slice(8, 10) + 1);
  const d2 = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//minutes-app//JA', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${task.id}@minutes-app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
    `SUMMARY:${icsEsc('【期限】' + task.text.slice(0, 60))}`,
    `DESCRIPTION:${icsEsc(`${rec.title || '議事録'}（${rec.date}）\n${task.text}${task.who ? '\n担当：' + task.who : ''}`)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15H', `DESCRIPTION:${icsEsc('明日が期限：' + task.text.slice(0, 40))}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
}

// ---------- バックアップ（音声とAPIキーは入れない） ----------
export async function backupBlob() {
  const recs = await listRecords();
  const data = { app: 'minutes-app', version: 1, exportedAt: new Date().toISOString(), records: recs };
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}
export async function restoreBackup(file) {
  const j = JSON.parse(await file.text());
  if (!j || j.app !== 'minutes-app' || !Array.isArray(j.records)) throw new Error('このアプリのバックアップではありません');
  let added = 0, updated = 0, kept = 0;
  for (const r of j.records) {
    if (!r || !r.id) continue;
    const cur = await getRecord(r.id);
    const rec = { ...r, state: r.state === 'recording' ? 'recorded' : r.state };
    rec.audio = { ...(r.audio || {}), chunks: 0, samples: 0, compressed: null, removed: true, duration: (r.audio && r.audio.duration) || 0 };
    if (cur) {
      if ((cur.updatedAt || 0) >= (r.updatedAt || 0)) { kept++; continue; }
      if (cur.privacy === 'confidential') rec.privacy = 'confidential';
      rec.audio = cur.audio; updated++;
    } else added++;
    await putRecord(rec);
  }
  return { added, updated, kept };
}
