// 文字起こし（端末内 Whisper、または「部外秘ではない」記録だけ Groq / Gemini）
import { getRecord, updateRecord, kvGet } from './db.js';
import { readRange, wavBlob, blobToBase64, RATE } from './audio.js';
import { mlCall, makeDownloadTracker } from './ml-client.js';
import { whisperChoice, WHISPER } from './device.js';
import { groqTranscribe, geminiGenerate, parseJsonLoose, externalReady } from './external.js';
import { speakerOn } from './diarize.js';

function aborted(signal) { if (signal && signal.aborted) { const e = new Error('中止しました'); e.name = 'AbortError'; throw e; } }

// 無音のときに Whisper が出しがちな決まり文句や、同じことばのくり返しを消す
export function cleanText(t) {
  let s = String(t || '').replace(/[\s　]+/g, ' ').trim();
  const halluc = [
    /^(ご視聴|ご清聴)?(いただき)?(ありがとうございました|ありがとうございます)?[。！!]*\s*(チャンネル登録.*|高評価.*)$/,
    /^ご視聴(いただき)?ありがとうございました[。！!]*$/,
    /^チャンネル登録.*$/,
    /^(字幕|翻訳|提供)\s*[:：は].*$/,
    /^[[(（【]?(音楽|拍手|笑|BGM)[\])）】]?$/,
  ];
  if (halluc.some((re) => re.test(s))) return '';
  for (let i = 0; i < 3; i++) s = s.replace(/(.{1,30}?)(?:[、。,\s]*\1){3,}/g, '$1');
  // 句点がまったくない長い文は、文末らしいところ（です・ます＋漢字/カタカナ）に「。」を補う
  if (s.length > 40 && !/[。！？!?]/.test(s)) s = s.replace(/(です|ます|ました|でした|ません|ください|でしょう|ましょう)(?=[\p{Script=Han}\p{Script=Katakana}])/gu, '$1。');
  if (s.length > 20 && /(です|ます|ました|でした|ません|ください)$/.test(s)) s += '。';
  return s.trim();
}

export async function transEngine(rec) {
  if (rec.privacy === 'public') {
    const ready = await externalReady();
    const pref = await kvGet('pubTrans', 'external');
    if (pref === 'external') {
      if (ready.groq) return 'groq';
      if (ready.gemini) return 'gemini';
    }
  }
  return 'local';
}
export function engineLabel(engine, extra = '') {
  return { local: '端末内（Whisper）', groq: 'Groq（外部・Whisper large-v3）', gemini: 'Google Gemini（外部）' }[engine] + (extra ? ' ' + extra : '');
}

function targetsOf(rec) {
  const includeOff = !!(rec.trans && rec.trans.includeOff);
  return (rec.segs || []).filter((s) => s.text == null && (includeOff || speakerOn(rec, s.sp)));
}
export function pendingCount(rec) { return targetsOf(rec).length; }

export async function runTranscription(rid, { progress = () => {}, signal, includeOff } = {}) {
  let rec = await getRecord(rid);
  const engine = await transEngine(rec);
  await updateRecord(rid, (r) => {
    r.trans = { ...(r.trans || {}), engine, done: false, startedAt: Date.now() };
    if (includeOff != null) r.trans.includeOff = !!includeOff;
  });
  rec = await getRecord(rid);
  const targets = targetsOf(rec);
  const totalSec = targets.reduce((a, s) => a + (s.e - s.s), 0) || 1;
  const t0 = Date.now(); let doneSec = 0;
  const tick = (text) => {
    const el = (Date.now() - t0) / 1000;
    const rate = doneSec > 0 ? el / doneSec : 0;
    const eta = rate ? Math.max(0, (totalSec - doneSec) * rate) : null;
    progress({ ratio: Math.min(1, doneSec / totalSec), text, eta });
  };
  if (!targets.length) { await finish(rid); progress({ ratio: 1, text: '文字起こしは済んでいます' }); return; }

  if (engine === 'local') await localLoop(rid, targets, { signal, progress, tick, add: (s) => { doneSec += s; } });
  else if (engine === 'groq') await groqLoop(rid, targets, { signal, tick, add: (s) => { doneSec += s; } });
  else await geminiLoop(rid, targets, { signal, tick, add: (s) => { doneSec += s; } });
  await finish(rid);
  progress({ ratio: 1, text: '文字起こしが終わりました' });
}

async function finish(rid) {
  await updateRecord(rid, (r) => {
    const left = targetsOf(r).length;
    r.trans = { ...(r.trans || {}), done: left === 0, finishedAt: Date.now() };
    if (left === 0 && (r.state === 'diarized' || r.state === 'recorded' || r.state === 'processing')) r.state = 'transcribed';
  });
}

async function saveText(rid, id, text, src) {
  await updateRecord(rid, (r) => {
    const x = r.segs.find((q) => q.id === id);
    if (x && x.text == null) { x.text = cleanText(text); x.src = src; }
  });
}

// ---------- 端末内 ----------
async function localLoop(rid, targets, { signal, progress, tick, add }) {
  let cfg = await whisperChoice();
  const load = async (c) => {
    progress({ ratio: 0, text: `文字起こしのAI（${c.label}）を準備しています。初回はダウンロードに時間がかかります` });
    await mlCall('load', { which: 'asr', asr: c }, {
      onProgress: makeDownloadTracker((t) => progress({ ratio: 0, text: `文字起こしのAIをダウンロード中… ${Math.round(t.ratio * 100)}%（${(t.total / 1e6).toFixed(0)}MB）` })),
    });
  };
  try { await load(cfg); } catch (e) {
    if (cfg.device !== 'webgpu') throw e;
    // WebGPU で動かないときは、CPU（WASM）の標準モデルでやり直す
    const m = WHISPER[cfg.key === 'turbo' ? 'small' : cfg.key];
    cfg = { key: cfg.key === 'turbo' ? 'small' : cfg.key, model: m.id, device: 'wasm', dtype: m.dtype.wasm, label: `${m.label}（CPU）` };
    await load(cfg);
  }
  await updateRecord(rid, (r) => { r.trans.model = cfg.model.split('/')[1] + ' / ' + cfg.device; });
  let first = true;
  for (const sg of targets) {
    aborted(signal);
    const audio = await readRange(rid, sg.s, sg.e);
    let res;
    try {
      res = await mlCall('asr', { audio, asr: cfg }, { transfer: [audio.buffer] });
    } catch (e) {
      if (!(first && cfg.device === 'webgpu')) throw e;
      const m = WHISPER.small;
      cfg = { key: 'small', model: m.id, device: 'wasm', dtype: m.dtype.wasm, label: '標準（CPU）' };
      await load(cfg);
      const again = await readRange(rid, sg.s, sg.e);
      res = await mlCall('asr', { audio: again, asr: cfg }, { transfer: [again.buffer] });
    }
    first = false;
    await saveText(rid, sg.id, res.text, 'local');
    add(sg.e - sg.s);
    tick('端末の中で文字起こししています');
  }
}

// ---------- Groq（数分ぶんをまとめて送る。オフの人の声は送らない） ----------
async function groqLoop(rid, targets, { signal, tick, add }) {
  const MAX = 8 * 60, GAP = 0.8;
  const batches = []; let cur = [], len = 0;
  for (const sg of targets) {
    const d = sg.e - sg.s;
    if (cur.length && len + d + GAP > MAX) { batches.push(cur); cur = []; len = 0; }
    cur.push(sg); len += d + GAP;
  }
  if (cur.length) batches.push(cur);
  for (const batch of batches) {
    aborted(signal);
    const parts = []; const map = []; let off = 0;
    for (const sg of batch) {
      const a = await readRange(rid, sg.s, sg.e);
      parts.push(a); map.push({ id: sg.id, a: off, b: off + a.length / RATE, texts: [] });
      off += a.length / RATE;
      const sil = new Float32Array(Math.round(GAP * RATE)); parts.push(sil); off += GAP;
    }
    const total = parts.reduce((x, p) => x + p.length, 0);
    const cat = new Float32Array(total); let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
    tick('Groq に送って文字起こししています');
    const res = await groqTranscribe(rid, wavBlob(cat), { signal });
    const segs = res.segments && res.segments.length ? res.segments : [{ start: 0, end: off, text: res.text || '' }];
    for (const s of segs) {
      const mid = (s.start + s.end) / 2;
      let m = map.find((x) => mid >= x.a && mid <= x.b + GAP);
      if (!m) m = map.reduce((best, x) => (Math.abs((x.a + x.b) / 2 - mid) < Math.abs((best.a + best.b) / 2 - mid) ? x : best), map[0]);
      if (s.text) m.texts.push(s.text.trim());
    }
    await updateRecord(rid, (r) => {
      for (const m of map) { const x = r.segs.find((q) => q.id === m.id); if (x && x.text == null) { x.text = cleanText(m.texts.join('')); x.src = 'groq'; } }
      r.trans.model = 'groq ' + ((res && res.model) || 'whisper-large-v3');
    });
    add(batch.reduce((x, sg) => x + sg.e - sg.s, 0));
    tick('Groq で文字起こししています');
  }
}

// ---------- Gemini（短い音声を何個か一緒に送る） ----------
async function geminiLoop(rid, targets, { signal, tick, add }) {
  const MAXN = 8, MAXS = 200;
  const batches = []; let cur = [], len = 0;
  for (const sg of targets) {
    const d = sg.e - sg.s;
    if (cur.length && (cur.length >= MAXN || len + d > MAXS)) { batches.push(cur); cur = []; len = 0; }
    cur.push(sg); len += d;
  }
  if (cur.length) batches.push(cur);
  const ask = async (items) => {
    const parts = [{ text: `次の${items.length}個の音声（日本語の講義・会議）を、それぞれ正確に文字起こししてください。\n・話したとおりに書き、要約しないでください。\n・「えー」「あのー」などの言いよどみは省いてかまいません。\n・聞き取れない部分は「（聞き取れず）」と書いてください。\n・話し声がない音声は空の文字列にしてください。\n結果は、音声の順番どおりに${items.length}個の文字列のJSON配列で返してください。` }];
    for (let i = 0; i < items.length; i++) {
      const a = await readRange(rid, items[i].s, items[i].e);
      parts.push({ text: `音声${i + 1}:` });
      parts.push({ inline_data: { mime_type: 'audio/wav', data: await blobToBase64(wavBlob(a)) } });
    }
    const text = await geminiGenerate(rid, {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } } },
    }, { signal });
    return parseJsonLoose(text);
  };
  for (const batch of batches) {
    aborted(signal);
    tick('Gemini に送って文字起こししています');
    let arr = null;
    try { arr = await ask(batch); } catch (e) { if (e.name === 'AbortError' || e.name === 'ExternalBlockedError') throw e; arr = null; }
    if (!Array.isArray(arr) || arr.length !== batch.length) {
      arr = [];
      for (const sg of batch) { aborted(signal); const one = await ask([sg]); arr.push(Array.isArray(one) ? one.join('') : String(one || '')); }
    }
    await updateRecord(rid, (r) => {
      batch.forEach((sg, i) => { const x = r.segs.find((q) => q.id === sg.id); if (x && x.text == null) { x.text = cleanText(String(arr[i] || '')); x.src = 'gemini'; } });
      r.trans.model = 'gemini';
    });
    add(batch.reduce((x, sg) => x + sg.e - sg.s, 0));
    tick('Gemini で文字起こししています');
  }
}
