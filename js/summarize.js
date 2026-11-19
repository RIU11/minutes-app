// 要約・質問づくり
// 「部外秘ではない」かつ Gemini の準備ができていれば Gemini、それ以外は端末内AI（なければ簡易まとめ）
import { getRecord, updateRecord, kvGet } from './db.js';
import { geminiGenerate, parseJsonLoose, externalReady } from './external.js';
import { getEngine, chat } from './llm-local.js';
import { llmChoice } from './device.js';
import { simpleSummary, parseDue, keywords, templateQuestions, QCATS, candidates } from './simple-nlp.js';
import { speakerOn } from './diarize.js';
import { fmtDur, uid, todayISO } from './ui.js';

export function transcriptText(rec, { includeOff = false, withTime = false, withSpeaker = null } = {}) {
  const segs = (rec.segs || []).filter((s) => s.text && (includeOff || speakerOn(rec, s.sp)));
  const spk = new Map((rec.speakers || []).map((s) => [s.id, s]));
  const multi = withSpeaker != null ? withSpeaker : new Set(segs.map((s) => s.sp)).size > 1;
  return segs.map((s) => {
    const sp = spk.get(s.sp); const name = sp && sp.name ? `${s.sp}（${sp.name}）` : s.sp;
    return (withTime ? `[${fmtDur(s.s)}] ` : '') + (multi ? `${name}: ` : '') + s.text;
  }).join('\n');
}

export async function summaryEngine(rec) {
  if (rec.privacy === 'public') {
    const r = await externalReady();
    const pref = await kvGet('pubSum', 'external');
    if (pref === 'external' && r.gemini) return 'gemini';
  }
  const ch = await llmChoice();
  return ch.key === 'simple' ? 'simple' : 'local';
}
export function summaryEngineLabel(e) {
  return { gemini: 'Google Gemini（外部）', local: '端末内AI', simple: '簡易まとめ（AIなし）' }[e] || e;
}

function meta(rec) {
  return [`タイトル：${rec.title || '（未設定）'}`, `日付：${rec.date || ''} ${rec.time || ''}`, rec.place && `場所：${rec.place}`, rec.participants && `参加者：${rec.participants}`, rec.agenda && `議題：${rec.agenda}`].filter(Boolean).join('\n');
}

// ---------- 要約 ----------
export async function runSummary(rid, { progress = () => {}, signal } = {}) {
  const rec = await getRecord(rid);
  const text = transcriptText(rec);
  if (!text.trim()) throw new Error('まとめる文字起こしがありません（オンにした人の発言がありません）。');
  const engine = await summaryEngine(rec);
  let sum;
  if (engine === 'gemini') {
    sum = await geminiSummary(rid, rec, text, { signal, progress });
  } else if (engine === 'local') {
    try { sum = await localSummary(rec, text, { signal, progress }); } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn(e);
      sum = { ...simpleSummary(text, { base: dateOf(rec) }), engine: 'simple', model: '', fallback: '端末内AIが使えなかったため、簡易まとめにしました（' + (e.message || e) + '）' };
    }
  } else {
    progress({ ratio: 0.5, text: '大事そうな文を選んでいます' });
    sum = { ...simpleSummary(text, { base: dateOf(rec) }), engine: 'simple', model: '' };
  }
  // Gemini が宿題を見つけなかったときは、「宿題・提出・までに」などを含む文を候補として足す（取りこぼし防止）
  const extra = sum.engine === 'gemini' && !(sum.tasks || []).length ? simpleSummary(text, { base: dateOf(rec) }).tasks.slice(0, 3).map((t) => ({ ...t, guess: true })) : [];
  await updateRecord(rid, (r) => {
    r.summary = { ...sum, at: Date.now() };
    if (!r.title && sum.title) r.title = sum.title;
    const have = new Set((r.tasks || []).map((t) => norm(t.text)));
    const add = [...(sum.tasks || []), ...extra];
    for (const t of add) {
      const k = norm(t.text); if (!k || have.has(k)) continue; have.add(k);
      r.tasks = r.tasks || [];
      r.tasks.push({ id: uid('t'), text: t.text, who: t.who || '', due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : parseDue(t.text, dateOf(r)), done: false, guess: !!t.guess, from: 'summary' });
    }
    r.state = 'summarized';
  });
  progress({ ratio: 1, text: 'まとめができました' });
}
function norm(s) { return String(s || '').normalize('NFKC').replace(/[\s。、．，！？!?「」]/g, '').slice(0, 60); }
function dateOf(rec) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rec.date || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(); }

const SUM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    overview: { type: 'STRING' },
    sections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { heading: { type: 'STRING' }, points: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['heading', 'points'] } },
    terms: { type: 'ARRAY', items: { type: 'OBJECT', properties: { term: { type: 'STRING' }, desc: { type: 'STRING' } }, required: ['term', 'desc'] } },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    tasks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, who: { type: 'STRING' }, due: { type: 'STRING' } }, required: ['text'] } },
    next: { type: 'STRING' },
    corrections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { wrong: { type: 'STRING' }, right: { type: 'STRING' } }, required: ['wrong', 'right'] } },
  },
  required: ['title', 'overview', 'sections', 'terms', 'decisions', 'tasks', 'next'],
};

async function geminiSummary(rid, rec, text, { signal, progress }) {
  progress({ ratio: 0.2, text: 'Gemini に送ってまとめています' });
  const prompt = `あなたは講義・会議の議事録を作る、日本語の書記です。
次の文字起こし（音声認識なので誤変換を含みます）から、見やすい議事録を作ってください。
・文字起こしに書かれている内容だけを根拠にし、推測で足さないでください。
・誤変換と思われる語は、文脈から正しい語に直して書いてください。
・title：内容がわかる短いタイトル（20字以内）
・overview：全体の要約（3〜5文）
・sections：話題ごとの見出しと要点（話された順。各3〜6個の箇条書き）
・terms：大事な用語と、その説明（3〜8個。講義での説明に沿って）
・decisions：決まったこと（なければ空の配列）
・tasks：宿題・課題・やること（text=内容、who=担当（わかれば）、due=期限を YYYY-MM-DD（わかれば。この記録の日付は ${rec.date || todayISO()}））
・next：次回の予定や予告（なければ空文字）
・corrections：文字起こしの誤変換と思われる語と、正しいと思われる語（自信があるものだけ、最大10個）

【記録の情報】
${meta(rec)}

【文字起こし】
${text}`;
  const out = await geminiGenerate(rid, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: SUM_SCHEMA },
  }, { signal });
  progress({ ratio: 0.9, text: '結果を整えています' });
  const j = parseJsonLoose(out);
  const model = (await kvGet('geminiModel')) || '';
  return {
    engine: 'gemini', model,
    title: String(j.title || '').slice(0, 40),
    overview: String(j.overview || ''),
    sections: (j.sections || []).map((s) => ({ heading: String(s.heading || ''), points: (s.points || []).map(String).filter(Boolean) })).filter((s) => s.points.length),
    terms: (j.terms || []).map((t) => ({ term: String(t.term || ''), desc: String(t.desc || '') })).filter((t) => t.term),
    decisions: (j.decisions || []).map(String).filter(Boolean),
    tasks: (j.tasks || []).map((t) => ({ text: String(t.text || ''), who: String(t.who || ''), due: String(t.due || '') })).filter((t) => t.text),
    next: String(j.next || ''),
    corrections: (j.corrections || []).filter((c) => c && c.wrong && c.right && c.wrong !== c.right).slice(0, 10),
  };
}

// 長い文を、文の切れ目で size 文字くらいずつに分ける
export function splitText(text, size) {
  const sents = String(text).split(/(?<=[。！？!?\n])/);
  const out = []; let cur = '';
  for (const s of sents) {
    if (cur && cur.length + s.length > size) { out.push(cur); cur = ''; }
    if (s.length > size) { for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); continue; }
    cur += s;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function bullets(out) {
  const lines = String(out || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const b = lines.filter((l) => /^([-・*•●]|\d+[.)．、])\s*/.test(l)).map((l) => l.replace(/^([-・*•●]|\d+[.)．、])\s*/, '').trim());
  return (b.length ? b : lines).map((l) => l.replace(/^\*\*|\*\*$/g, '')).filter((l) => l.length >= 3 && !/^(要点|まとめ|以下)/.test(l));
}
function parseTagged(out) {
  const res = {};
  const re = /【\s*(概要|要点|用語|決定事項|宿題|次回)\s*】/g;
  const marks = []; let m;
  while ((m = re.exec(out))) marks.push({ k: m[1], i: m.index, j: re.lastIndex });
  marks.forEach((mk, n) => { res[mk.k] = out.slice(mk.j, n + 1 < marks.length ? marks[n + 1].i : out.length).trim(); });
  return res;
}
const NONE = /^(なし|無し|特になし|ありません|該当なし|-|ー)[。.]?$/;
// 小さなAIが付けがちな Markdown の飾り（**太字**・## 見出し）を外す
function cleanMd(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/^#{1,6}\s.*$/gm, '').replace(/^\s*[-*]\s*$/gm, '').trim();
}
// 空でない最初の行（前につく「- 」「・」や、かぎかっこを外す）
function firstLine(s) {
  return (cleanMd(s).split('\n').map((x) => x.replace(/^[-・*]\s*/, '').replace(/^「(.*)」$/, '$1').trim()).find((x) => x && !/^(次回の予定|やること|決まったこと)[：:]?$/.test(x)) || '').replace(/^(次回の予定|やること|決まったこと)[：:]\s*/, '');
}

async function localSummary(rec, text, { signal, progress }) {
  const ctx = await getEngine((p) => progress({ ratio: p.ratio * 0.25, text: `端末内AIを準備しています… ${Math.round(p.ratio * 100)}%（初回は約1.5〜2.5GBのダウンロード）` }));
  if (!ctx) throw new Error('端末内AIが選ばれていません');
  const chunks = splitText(text, 1300);
  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    progress({ ratio: 0.25 + 0.55 * (i / chunks.length), text: `端末の中でまとめています（${i + 1}/${chunks.length}）` });
    const out = await chat(ctx, `以下は講義・会議の文字起こしの一部（${i + 1}/${chunks.length}）です。音声認識なので誤変換を含みます。
この部分で話された大事な内容を、日本語の箇条書きで3〜5個にまとめてください。
各行は「- 」で始め、1行は60字以内。書かれていないことは足さないでください。

文字起こし：
${chunks[i]}`, { maxTokens: 320, signal });
    notes.push(bullets(out).slice(0, 6));
  }
  let joined = notes.flat().map((x) => '- ' + x).join('\n');
  let guard = 0;
  while (joined.length > 2200 && guard++ < 4) {
    const parts = splitText(joined, 1800); const next = [];
    for (const p of parts) {
      const out = await chat(ctx, `次の箇条書きメモを、重なりを除いて大事なものだけ残し、箇条書き5〜8個にまとめ直してください。各行は「- 」で始めてください。\n\n${p}`, { maxTokens: 360, signal });
      next.push(...bullets(out));
    }
    joined = next.map((x) => '- ' + x).join('\n');
  }
  // 小さなAIには、ひとつずつ頼む（一度にたくさん頼むと形が崩れやすい）
  progress({ ratio: 0.82, text: '議事録の形に整えています（概要・要点）' });
  const final = cleanMd(await chat(ctx, `次の「要点メモ」をもとに、講義・会議の議事録を日本語で書いてください。必ず次の形式で書き、メモにないことは書かないでください。

【概要】全体を2〜3文で
【要点】
- 箇条書きで3〜8個

${meta(rec)}

要点メモ：
${joined}`, { maxTokens: 700, signal }));
  const t = parseTagged(final);
  const pts = bullets(t['要点'] || '');
  progress({ ratio: 0.88, text: '大事な用語をまとめています' });
  const termOut = cleanMd(await chat(ctx, `次のメモに出てくる大事な用語を3〜6個えらび、1行に1つ「用語：かんたんな説明」の形で書いてください。各行は「- 」で始めてください。\n\nメモ：\n${joined}`, { maxTokens: 360, signal }));
  const terms = bullets(termOut).map((l) => { const m = /^(.+?)[：:]\s*(.+)$/.exec(l); return m ? { term: m[1].trim(), desc: m[2].trim() } : { term: l, desc: '' }; }).filter((x) => x.term && !NONE.test(x.term) && x.term.length <= 30);
  // 宿題・決まったこと・次回は、それらしい文を先に探してから、AIに短く言いかえてもらう
  const cand = candidates(text);
  const tasks = [];
  for (const s of cand.tasks) {
    progress({ ratio: 0.92, text: '宿題を整理しています' });
    const short = firstLine(await chat(ctx, `次の発言を、やることがわかる短い文（40字以内）に言いかえてください。言いかえた文だけを書いてください。\n\n発言：${s}`, { maxTokens: 80, signal }));
    tasks.push({ text: short && short.length <= 60 && !NONE.test(short) ? short : s, who: '', due: parseDue(s, dateOf(rec)), source: s });
  }
  const dec = [];
  for (const s of cand.decisions.slice(0, 4)) {
    const short = firstLine(await chat(ctx, `次の発言で決まったことを、短い文（40字以内）で書いてください。決まったことがなければ「なし」とだけ書いてください。\n\n発言：${s}`, { maxTokens: 80, signal }));
    if (short && !NONE.test(short)) dec.push(short);
  }
  // 「次回は〜」の文はそのままで意味がわかるので、AIを通さずに使う（小さなAIは「なし」と答えがち）
  const nxt = cand.next.join('');
  const overview = (t['概要'] || '').replace(/\n+/g, '').trim() || notes.flat().slice(0, 2).join('');
  let title = '';
  if (!rec.title) {
    title = firstLine(await chat(ctx, `次の内容に、短いタイトル（15字以内）をつけてください。タイトルだけを書いてください。\n\n${overview}\n${pts.slice(0, 5).join('\n')}`, { maxTokens: 40, signal }))
      .replace(/^(タイトル)[：:]\s*/, '').replace(/^[「『"]|[」』"]$/g, '').slice(0, 30);
  }
  const sections = [];
  if (pts.length) sections.push({ heading: '要点', points: pts });
  // 話の流れ（区切りごとのメモ）も残す
  if (notes.length > 1) sections.push({ heading: '話の流れ', points: notes.map((n, i) => `${i + 1}. ${n[0] || ''}`).filter((x) => x.length > 4) });
  if (!sections.length) sections.push({ heading: '要点', points: notes.flat().slice(0, 10) });
  return { engine: 'local', model: ctx.choice.label, title, overview, sections, terms, decisions: dec, tasks, next: nxt };
}

// ---------- 質問の提案 ----------
const Q_SCHEMA = { type: 'ARRAY', items: { type: 'OBJECT', properties: { q: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['q', 'why'] } };

export async function runQuestions(rid, { cat = 'deep', free = '', count = 5, progress = () => {}, signal } = {}) {
  const rec = await getRecord(rid);
  const text = transcriptText(rec);
  if (!text.trim()) throw new Error('質問を考えるための文字起こしがありません。');
  const engine = await summaryEngine(rec);
  const c = QCATS.find((x) => x.id === cat);
  const want = [c ? `系統：${c.label}（${c.hint}）` : '', free ? `希望：${free}` : ''].filter(Boolean).join('\n') || '系統：理解を深める';
  let items = [];
  let used = engine;
  if (engine === 'gemini') {
    progress({ ratio: 0.3, text: 'Gemini に質問を考えてもらっています' });
    const body = text.length > 60000 ? text.slice(0, 60000) : text;
    const out = await geminiGenerate(rid, {
      contents: [{ role: 'user', parts: [{ text: `あなたは、講義や会議の参加者が「どんな質問をすればよいか」を一緒に考えるアシスタントです。
次の内容について、指定された系統に合う質問を${count}個考えてください。
・内容に出てきた具体的な言葉を使い、そのまま声に出して聞ける自然な日本語にしてください。
・q：質問文、why：その質問をするとよい理由（1文）

${want}

${meta(rec)}
${rec.summary && rec.summary.overview ? '要約：' + rec.summary.overview + '\n' : ''}
【文字起こし】
${body}` }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json', responseSchema: Q_SCHEMA },
    }, { signal });
    const j = parseJsonLoose(out);
    items = (Array.isArray(j) ? j : []).map((x) => ({ q: String(x.q || ''), why: String(x.why || '') })).filter((x) => x.q);
  } else if (engine === 'local') {
    try {
      const ctx = await getEngine((p) => progress({ ratio: p.ratio * 0.4, text: `端末内AIを準備しています… ${Math.round(p.ratio * 100)}%` }));
      const s = rec.summary;
      const context = s ? [s.overview, ...(s.sections || []).flatMap((x) => x.points)].join('\n').slice(0, 1800) : splitText(text, 1800)[0];
      progress({ ratio: 0.5, text: '端末の中で質問を考えています' });
      const out = await chat(ctx, `次の講義・会議の内容について、参加者がする質問を${count}個、日本語で考えてください。
${want}
・内容に出てきた具体的な言葉を使ってください。
・各行は「- 」で始め、質問文だけを書いてください。

内容：
${context}`, { maxTokens: 400, temperature: 0.7, signal });
      items = bullets(cleanMd(out)).filter((l) => l.length > 5).slice(0, count).map((q) => ({ q, why: '' }));
    } catch (e) { if (e.name === 'AbortError') throw e; items = []; }
    if (!items.length) { items = templateQuestions(cat, keywords(text), free); used = 'simple'; }
  } else {
    items = templateQuestions(cat, keywords(text), free);
  }
  if (!items.length) throw new Error('質問を作れませんでした。');
  const entry = { id: uid('q'), cat, free, items, engine: used, at: Date.now() };
  await updateRecord(rid, (r) => { r.questions = [entry, ...(r.questions || [])].slice(0, 30); });
  progress({ ratio: 1, text: '質問ができました' });
  return entry;
}
export { QCATS };
