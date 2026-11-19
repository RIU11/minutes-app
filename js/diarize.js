// 話者を分ける（端末内のみ）
// 1) 10秒ごとに「話している区間」と「その窓の中で何人目か」を調べる（pyannote）
// 2) 窓×人ごとに声の特徴（WeSpeaker）を出す
// 3) 似た声をまとめて A・B・C… と名前をつける（先生＝いちばん話している人、または録音中に押した印）
import { mlCall, makeDownloadTracker } from './ml-client.js';
import { readChunk, readRange, RATE, CHUNK_SEC } from './audio.js';
import { getRecord, updateRecord, putEmb, getEmb } from './db.js';
import { linkage, cut, centroids, cosineDist } from './cluster.js';
import { uid } from './ui.js';

const SEG_BATCH = 6;
const EMB_BATCH = 8;
const MIN_RUN = 0.2;
const MERGE_GAP = 0.3;
const MIN_EMB = 0.6;
const MAX_SEG = 28;
const JOIN_GAP = 1.2;
export const DEFAULT_THRESHOLD = 0.62;
const LETTERS = 'ABCDEFGH';

function aborted(signal) { if (signal && signal.aborted) { const e = new Error('中止しました'); e.name = 'AbortError'; throw e; } }

function smoothWindow(segs, winStart, winLen) {
  const out = [];
  for (const s of segs) {
    const l = s.id >= 4 ? -1 : s.id; // 4〜6 は2人が重なっている
    const st = winStart + Math.max(0, s.start), en = winStart + Math.min(s.end, winLen);
    if (en <= st) continue;
    const last = out[out.length - 1];
    if (last && last.l === l && st - last.e <= MERGE_GAP) { last.e = en; continue; }
    out.push({ s: st, e: en, l });
  }
  return out.filter((r) => r.e - r.s >= MIN_RUN);
}

export async function runDiarization(rid, { progress = () => {}, signal, single = false } = {}) {
  const rec = await getRecord(rid);
  if (!rec || !rec.audio.chunks) throw new Error('音声がありません');
  const nWin = rec.audio.chunks;

  // 1) 区切り
  progress({ stage: 'load', ratio: 0, text: '声の区切りを見つけるAIを準備しています（初回は少し時間がかかります）' });
  await mlCall('load', { which: 'seg' }, { onProgress: makeDownloadTracker((t) => progress({ stage: 'load', ratio: t.ratio * 0.05, text: `声の区切りのAIを準備中… ${Math.round(t.ratio * 100)}%` })) });
  const runs = [];
  for (let w = 0; w < nWin; w += SEG_BATCH) {
    aborted(signal);
    const windows = [];
    for (let k = w; k < Math.min(nWin, w + SEG_BATCH); k++) windows.push(await readChunk(rid, k));
    const lens = windows.map((x) => x.length / RATE);
    const res = await mlCall('seg', { windows }, { transfer: windows.map((x) => x.buffer) });
    res.forEach((segs, j) => {
      const wi = w + j;
      for (const r of smoothWindow(segs, wi * CHUNK_SEC, lens[j])) { r.w = wi; runs.push(r); }
    });
    progress({ stage: 'seg', ratio: 0.05 + 0.4 * Math.min(1, (w + SEG_BATCH) / nWin), text: `話している区間を探しています… ${Math.min(100, Math.round(((w + SEG_BATCH) / nWin) * 100))}%` });
  }
  if (!runs.length) throw new Error('話し声が見つかりませんでした。音が小さすぎるか、無音の録音かもしれません。');

  // 2) 窓×人ごとにまとめる
  const unitMap = new Map();
  runs.forEach((r, idx) => {
    if (r.l <= 0) { r.u = -1; return; }
    const key = r.w + ':' + r.l;
    let u = unitMap.get(key);
    if (!u) { u = { w: r.w, l: r.l, runs: [], dur: 0 }; unitMap.set(key, u); }
    u.runs.push(idx); u.dur += r.e - r.s;
  });
  const units = [...unitMap.values()].filter((u) => u.dur >= MIN_EMB);
  const unitIndex = new Map(units.map((u, i) => [u.w + ':' + u.l, i]));
  runs.forEach((r) => { if (r.l > 0) { const i = unitIndex.get(r.w + ':' + r.l); r.u = i == null ? -1 : i; } });

  // 3) 声の特徴
  let vecs = [];
  if (!single && units.length > 1) {
    progress({ stage: 'load2', ratio: 0.45, text: '声の特徴を調べるAIを準備しています' });
    await mlCall('load', { which: 'emb' }, { onProgress: makeDownloadTracker((t) => progress({ stage: 'load2', ratio: 0.45 + t.ratio * 0.05, text: `声の特徴のAIを準備中… ${Math.round(t.ratio * 100)}%` })) });
    for (let i = 0; i < units.length; i += EMB_BATCH) {
      aborted(signal);
      const audios = [];
      for (const u of units.slice(i, i + EMB_BATCH)) {
        const parts = [];
        for (const ri of u.runs) parts.push(await readRange(rid, runs[ri].s, runs[ri].e));
        const total = parts.reduce((a, p) => a + p.length, 0);
        const cat = new Float32Array(total); let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
        audios.push(cat);
      }
      const res = await mlCall('emb', { audios }, { transfer: audios.map((x) => x.buffer) });
      vecs.push(...res);
      progress({ stage: 'emb', ratio: 0.5 + 0.45 * Math.min(1, (i + EMB_BATCH) / units.length), text: `声の特徴を調べています… ${Math.min(100, Math.round(((i + EMB_BATCH) / units.length) * 100))}%` });
    }
  }
  const dim = vecs[0] ? vecs[0].length : 0;
  const flat = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  await putEmb(rid, { dim, vecs: flat, unitDur: units.map((u) => u.dur) });

  const cleanRuns = runs.map((r) => ({ s: +r.s.toFixed(3), e: +r.e.toFixed(3), w: r.w, l: r.l, u: r.u }));
  await updateRecord(rid, (r) => {
    r.diar = { runs: cleanRuns, single: !!single || units.length <= 1, threshold: DEFAULT_THRESHOLD, k: null, done: false, at: Date.now() };
  });
  progress({ stage: 'cluster', ratio: 0.97, text: '似た声をまとめています' });
  await applyClustering(rid, {});
  progress({ stage: 'done', ratio: 1, text: '話者を分けました' });
}

// 分け直し（しきい値や人数を変えたとき）。声の特徴は保存してあるので速い。
export async function applyClustering(rid, { threshold, k } = {}) {
  const rec = await getRecord(rid);
  const emb = await getEmb(rid);
  const runs = rec.diar.runs.map((r) => ({ ...r }));
  const thr = threshold != null ? threshold : (rec.diar.threshold ?? DEFAULT_THRESHOLD);
  const kk = k !== undefined ? k : rec.diar.k;

  let unitLabels = null, count = 1;
  const nUnits = emb && emb.dim ? emb.vecs.length / emb.dim : 0;
  if (!rec.diar.single && nUnits > 1) {
    const vecs = []; for (let i = 0; i < nUnits; i++) vecs.push(emb.vecs.subarray(i * emb.dim, (i + 1) * emb.dim));
    const L = linkage(vecs, emb.unitDur);
    let res = cut(L, kk ? { k: kk } : { threshold: thr });
    unitLabels = Array.from(res.labels); count = res.count;
    // ごく短いグループ（合計1.5秒未満）は近いグループに入れる（人数を決めたときは除く）
    if (!kk && count > 1) {
      for (let pass = 0; pass < 3; pass++) {
        const durs = new Array(count).fill(0);
        unitLabels.forEach((l, i) => { durs[l] += emb.unitDur[i]; });
        const cs = centroids(vecs, unitLabels, count);
        const big = durs.map((d, i) => (d >= 1.5 ? i : -1)).filter((i) => i >= 0);
        if (!big.length || big.length === count) break;
        unitLabels = unitLabels.map((l) => {
          if (durs[l] >= 1.5) return l;
          let best = big[0], bd = Infinity;
          for (const b of big) { const d = cosineDist(cs[l], cs[b]); if (d < bd) { bd = d; best = b; } }
          return best;
        });
        const remap = new Map(); unitLabels = unitLabels.map((l) => { if (!remap.has(l)) remap.set(l, remap.size); return remap.get(l); }); count = remap.size;
      }
    }
    // 多すぎるときは8人までにまとめる
    if (count > LETTERS.length) { res = cut(L, { k: LETTERS.length }); unitLabels = Array.from(res.labels); count = res.count; }
  }

  // それぞれの区間に番号をつける
  for (const r of runs) r.c = unitLabels && r.u >= 0 ? unitLabels[r.u] : (unitLabels ? -1 : 0);
  // 番号がない区間（短い・重なり）は、同じ窓の同じ人 → 時間が近い区間 の順で決める
  const sorted = runs.map((r, i) => i).sort((a, b) => runs[a].s - runs[b].s);
  const byWL = new Map();
  for (const r of runs) if (r.c >= 0 && r.l > 0) byWL.set(r.w + ':' + r.l, r.c);
  for (const r of runs) if (r.c < 0 && r.l > 0 && byWL.has(r.w + ':' + r.l)) r.c = byWL.get(r.w + ':' + r.l);
  for (let si = 0; si < sorted.length; si++) {
    const r = runs[sorted[si]]; if (r.c >= 0) continue;
    let best = -1, bd = Infinity;
    for (let d = 1; d < sorted.length; d++) {
      const a = sorted[si - d], b = sorted[si + d];
      if (a != null && runs[a].c >= 0) { const g = r.s - runs[a].e; if (g < bd) { bd = g; best = runs[a].c; } }
      if (b != null && runs[b].c >= 0) { const g = runs[b].s - r.e; if (g < bd) { bd = g; best = runs[b].c; } }
      if (best >= 0 && d > 3) break;
    }
    r.c = best >= 0 ? best : 0;
  }

  // 人ごとの長さ
  const nC = Math.max(1, ...runs.map((r) => r.c + 1));
  const dur = new Array(nC).fill(0);
  for (const r of runs) dur[r.c] += r.e - r.s;
  // 先生（残す人）を決める：録音中に押した印 → いちばん長く話している人
  let main = dur.indexOf(Math.max(...dur));
  let mainBy = 'longest';
  if (rec.anchors && rec.anchors.length) {
    const votes = new Array(nC).fill(0);
    for (const t of rec.anchors) for (const r of runs) { const ov = Math.min(r.e, t + 1) - Math.max(r.s, t - 4); if (ov > 0) votes[r.c] += ov; }
    const vm = Math.max(...votes);
    if (vm > 0) { main = votes.indexOf(vm); mainBy = 'anchor'; }
  }
  const order = [...Array(nC).keys()].filter((c) => dur[c] > 0).sort((a, b) => (a === main ? -1 : b === main ? 1 : dur[b] - dur[a]));
  const letterOf = new Map(order.map((c, i) => [c, LETTERS[i] || 'H']));
  for (const r of runs) r.sp = letterOf.get(r.c) || 'A';

  const oldSpk = new Map((rec.speakers || []).map((s) => [s.id, s]));
  const speakers = order.map((c, i) => {
    const id = LETTERS[i] || 'H';
    const mine = runs.filter((r) => r.c === c);
    let longest = mine[0];
    for (const r of mine) if (r.e - r.s > longest.e - longest.s) longest = r;
    const old = oldSpk.get(id);
    return {
      id, dur: +dur[c].toFixed(1), on: i === 0,
      name: i === 0 ? ((old && old.name) || '先生') : '',
      sample: [longest.s, Math.min(longest.e, longest.s + 8)],
      main: i === 0, mainBy: i === 0 ? mainBy : null,
    };
  });

  await updateRecord(rid, (r) => {
    r.diar.runs = runs.map(({ s, e, w, l, u }) => ({ s, e, w, l, u }));
    r.diar.threshold = thr; r.diar.k = kk || null; r.diar.done = true; r.diar.count = speakers.length;
    r.speakers = speakers;
    const hasText = (r.segs || []).some((sg) => sg.text != null);
    if (hasText) {
      // 文字起こし済みなら区切りはそのまま、話者だけ付け直す
      for (const sg of r.segs) {
        const votes = {};
        for (const run of runs) { const ov = Math.min(run.e, sg.e) - Math.max(run.s, sg.s); if (ov > 0) votes[run.sp] = (votes[run.sp] || 0) + ov; }
        const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        if (best && !sg.spFixed) sg.sp = best[0];
      }
    } else {
      r.segs = buildSegs(runs, rec.audio.duration);
    }
    if (r.state === 'recorded') r.state = 'diarized';
  });
}

// 同じ人の続いた区間を、30秒以内のかたまりにまとめる（文字起こしの単位）
export function buildSegs(runs, duration) {
  const rs = runs.slice().sort((a, b) => a.s - b.s);
  const groups = [];
  let cur = null;
  const close = () => { if (cur) groups.push(cur); cur = null; };
  for (const r of rs) {
    if (cur && cur.sp === r.sp && r.s - cur.e <= JOIN_GAP) {
      if (r.e - cur.s <= MAX_SEG) { cur.e = Math.max(cur.e, r.e); cur.parts.push(r); continue; }
      // 長すぎる：いちばん長い間（ま）で切る
      let bi = -1, bg = -1;
      for (let i = 1; i < cur.parts.length; i++) {
        const g = cur.parts[i].s - cur.parts[i - 1].e;
        if (cur.parts[i].s - cur.s >= 8 && g > bg) { bg = g; bi = i; }
      }
      if (bi > 0 && bg >= 0.12) {
        const tail = cur.parts.splice(bi);
        cur.e = cur.parts[cur.parts.length - 1].e;
        const sp = cur.sp; close();
        cur = { s: tail[0].s, e: tail[tail.length - 1].e, sp, parts: tail };
        if (r.e - cur.s <= MAX_SEG) { cur.e = Math.max(cur.e, r.e); cur.parts.push(r); continue; }
      }
      close();
    } else close();
    cur = { s: r.s, e: r.e, sp: r.sp, parts: [r] };
  }
  close();
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.e - g.s < 0.35) continue;
    const prevE = i > 0 ? groups[i - 1].e : 0;
    const nextS = i < groups.length - 1 ? groups[i + 1].s : duration;
    const s = Math.max(prevE, g.s - 0.2, 0), e = Math.min(nextS, g.e + 0.25, duration);
    out.push({ id: uid('s'), s: +s.toFixed(2), e: +e.toFixed(2), sp: g.sp, text: null, edited: false });
  }
  return out;
}

// 話者を分けずに、話している区間だけで区切る（速い）
export function speakerOn(rec, id) {
  const s = (rec.speakers || []).find((x) => x.id === id);
  return s ? !!s.on : true;
}
