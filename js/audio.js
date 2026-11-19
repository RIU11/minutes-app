// 音声のあつかい（16kHz・モノラル・16bit を10秒ずつ保存）
import { getPcmRange, putPcm, getBlobs } from './db.js';

export const RATE = 16000;
export const CHUNK_SEC = 10;
export const CHUNK = RATE * CHUNK_SEC;

export function int16ToFloat(i16) {
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}
export function floatToInt16(f32) {
  const o = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    o[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return o;
}

// 指定した秒の範囲を Float32Array で読む
export async function readRange(rid, startSec, endSec) {
  const s0 = Math.max(0, Math.floor(startSec * RATE));
  const s1 = Math.max(s0, Math.floor(endSec * RATE));
  const i0 = Math.floor(s0 / CHUNK), i1 = Math.floor(Math.max(s0, s1 - 1) / CHUNK);
  const rows = await getPcmRange(rid, i0, i1);
  const out = new Float32Array(s1 - s0);
  for (const row of rows) {
    const pcm = new Int16Array(row.pcm);
    const base = row.i * CHUNK;
    const a = Math.max(s0, base), b = Math.min(s1, base + pcm.length);
    for (let s = a; s < b; s++) out[s - s0] = pcm[s - base] / 32768;
  }
  return out;
}
// 10秒の窓をひとつ読む
export async function readChunk(rid, i) {
  const rows = await getPcmRange(rid, i, i);
  if (!rows.length) return new Float32Array(0);
  return int16ToFloat(new Int16Array(rows[0].pcm));
}

// WAV（16bit）を作る
export function wavBlob(f32, rate = RATE) {
  const n = f32.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  const i16 = floatToInt16(f32);
  new Int16Array(buf, 44).set(i16);
  return new Blob([buf], { type: 'audio/wav' });
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) s += String.fromCharCode.apply(null, buf.subarray(i, i + step));
  return btoa(s);
}

// ---------- 再生（その部分だけ） ----------
let player = null, playerUrl = null, playerStop = null;
export async function playRange(rid, s, e, onEnd) {
  stopPlayback();
  const f = await readRange(rid, s, e);
  const blob = wavBlob(f);
  playerUrl = URL.createObjectURL(blob);
  player = new Audio(playerUrl);
  const end = () => { stopPlayback(); if (onEnd) onEnd(); };
  player.addEventListener('ended', end);
  playerStop = onEnd;
  try { await player.play(); } catch (err) { end(); throw err; }
}
export function stopPlayback() {
  if (player) { try { player.pause(); } catch (e) { /* 無視 */ } player = null; }
  if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; }
  if (playerStop) { const f = playerStop; playerStop = null; try { f(); } catch (e) { /* 無視 */ } }
}

// ---------- 音の高さをそろえる（ストリーム用、窓つき sinc） ----------
export class StreamResampler {
  constructor(inRate, outRate, half = 16, phases = 128) {
    this.step = inRate / outRate;
    this.half = half;
    this.phases = phases;
    const c = Math.min(1, outRate / inRate) * 0.92;
    // 小数点以下の位置ごとに係数を前もって作っておく
    this.table = new Float32Array((phases + 1) * 2 * half);
    for (let p = 0; p <= phases; p++) {
      const frac = p / phases;
      let sum = 0;
      for (let k = 0; k < 2 * half; k++) {
        const x = frac + (half - 1 - k); // t - j
        let v;
        if (Math.abs(x) < 1e-9) v = c;
        else if (Math.abs(x) >= half) v = 0;
        else {
          const w = 0.42 + 0.5 * Math.cos(Math.PI * x / half) + 0.08 * Math.cos(2 * Math.PI * x / half);
          v = (Math.sin(Math.PI * c * x) / (Math.PI * x)) * w;
        }
        this.table[p * 2 * half + k] = v; sum += v;
      }
      if (sum) for (let k = 0; k < 2 * half; k++) this.table[p * 2 * half + k] /= sum;
    }
    this.buf = new Float32Array(half); // 最初は無音で埋めておく
    this.t = half;
  }
  push(input) {
    const b = new Float32Array(this.buf.length + input.length);
    b.set(this.buf); b.set(input, this.buf.length);
    const half = this.half, tbl = this.table, ph = this.phases;
    const maxOut = Math.max(0, Math.ceil((b.length - half - this.t) / this.step) + 1);
    const out = new Float32Array(maxOut);
    let n = 0, t = this.t;
    while (t + half < b.length) {
      const i0 = Math.floor(t);
      const p = Math.round((t - i0) * ph);
      const off = p * 2 * half;
      let acc = 0;
      const j0 = i0 - half + 1;
      for (let k = 0; k < 2 * half; k++) acc += b[j0 + k] * tbl[off + k];
      out[n++] = acc;
      t += this.step;
    }
    const keepFrom = Math.max(0, Math.floor(t) - half);
    this.buf = b.slice(keepFrom);
    this.t = t - keepFrom;
    return out.subarray(0, n);
  }
}

// ---------- 音声ファイルの読み込み ----------
// できるだけブラウザの機能で 16kHz に変換する。
export async function decodeFileTo16k(file, onProgress) {
  const ab = await file.arrayBuffer();
  onProgress && onProgress(0.1, '音声を読み取っています');
  let buf = null;
  // 1) 16kHz の AudioContext で直接読む（多くのブラウザで使える）
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ sampleRate: RATE });
    try { buf = await ctx.decodeAudioData(ab.slice(0)); } finally { try { ctx.close(); } catch (e) { /* 無視 */ } }
  } catch (e) { buf = null; }
  // 2) ふつうに読んでから変換する
  if (!buf) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try { buf = await ctx.decodeAudioData(ab.slice(0)); } finally { try { ctx.close(); } catch (e) { /* 無視 */ } }
  }
  onProgress && onProgress(0.5, '16kHz・モノラルに変換しています');
  // モノラルにまとめる
  const len = buf.length, ch = buf.numberOfChannels;
  let mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  if (buf.sampleRate !== RATE) {
    let done = false;
    try {
      const off = new OfflineAudioContext(1, Math.ceil(buf.duration * RATE), RATE);
      const mb = off.createBuffer(1, len, buf.sampleRate);
      mb.copyToChannel(mono, 0);
      const src = off.createBufferSource(); src.buffer = mb; src.connect(off.destination); src.start();
      const out = await off.startRendering();
      mono = out.getChannelData(0); done = true;
    } catch (e) { done = false; }
    if (!done) {
      const rs = new StreamResampler(buf.sampleRate, RATE);
      const parts = []; let total = 0;
      const step = buf.sampleRate * 10;
      for (let i = 0; i < len; i += step) { const o = rs.push(mono.subarray(i, i + step)); parts.push(o.slice()); total += o.length; }
      const out = new Float32Array(total); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
      mono = out;
    }
  }
  return mono;
}

export async function storeFloatAsChunks(rid, f32, onProgress) {
  let chunks = 0;
  for (let s = 0; s < f32.length; s += CHUNK) {
    const part = floatToInt16(f32.subarray(s, Math.min(f32.length, s + CHUNK)));
    await putPcm(rid, chunks++, part.buffer);
    if (onProgress && chunks % 30 === 0) onProgress(s / f32.length);
  }
  return { chunks, samples: f32.length, duration: f32.length / RATE };
}

// 録音した音声（圧縮）をひとつのファイルにする
export async function compressedAudio(rec) {
  const parts = await getBlobs(rec.id);
  if (!parts.length) return null;
  const mime = (rec.audio.compressed && rec.audio.compressed.mime) || parts[0].type || 'audio/webm';
  return new Blob(parts, { type: mime.split(';')[0] });
}
// 保存してある音声をまるごと WAV にする（長いと大きくなる）
export async function wholeWav(rec) {
  return wavBlob(await readRange(rec.id, 0, rec.audio.duration));
}
