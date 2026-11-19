// いま録音しているかどうか（画面を移っても録音は続ける）
import { Recorder } from './recorder.js';
import { getRecord, putRecord, updateRecord, newRecord, listRecords, countPcm, lastPcm } from './db.js';
import { CHUNK, RATE } from './audio.js';

const state = { rec: null, rid: null, level: 0, peak: 0, seconds: 0, paused: false };
const listeners = new Set();
export function onRecording(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }
export function recState() { return state; }
export function isRecording() { return !!state.rec; }

export async function startRecording(fields) {
  if (state.rec) throw new Error('すでに録音中です');
  const r = newRecord({ ...fields, state: 'recording', source: 'mic' });
  await putRecord(r);
  const rec = new Recorder(r.id, {
    onLevel: (rms, pk) => { state.level = rms; state.peak = pk; emit(); },
    onTick: (sec) => { state.seconds = sec; },
    onError: (e) => console.error(e),
  });
  state.rec = rec; state.rid = r.id; state.seconds = 0; state.paused = false;
  try { await rec.start(); } catch (e) {
    state.rec = null; state.rid = null;
    await updateRecord(r.id, (x) => { x.state = 'failed'; }).catch(() => {});
    const { deleteRecord } = await import('./db.js');
    await deleteRecord(r.id).catch(() => {});
    emit();
    throw e;
  }
  // 録音中も、ときどき長さを記録しておく（途中で閉じても復元できるように）
  state.timer = setInterval(() => {
    if (!state.rec) return;
    const sec = state.rec.seconds;
    updateRecord(state.rid, (x) => { x.audio.duration = sec; }).catch(() => {});
  }, 15000);
  emit();
  return r.id;
}

export function pauseRecording() { if (state.rec) { state.rec.pause(); state.paused = true; emit(); } }
export function resumeRecording() { if (state.rec) { state.rec.resume(); state.paused = false; emit(); } }
export async function addAnchor() {
  if (!state.rec) return 0;
  const t = state.rec.seconds;
  const r = await updateRecord(state.rid, (x) => { x.anchors = [...(x.anchors || []), +t.toFixed(2)]; });
  return r.anchors.length;
}

export async function stopRecording() {
  if (!state.rec) return null;
  const rec = state.rec, rid = state.rid;
  clearInterval(state.timer);
  const res = await rec.stop();
  state.rec = null; state.rid = null; state.paused = false; state.level = 0;
  await updateRecord(rid, (x) => {
    x.audio = { ...x.audio, chunks: res.chunks, samples: res.samples, duration: res.duration, compressed: res.compressed };
    x.state = res.samples > RATE ? 'recorded' : 'empty';
  });
  emit();
  return rid;
}

// 前回、録音中に閉じてしまった記録を直す
export async function recoverInterrupted() {
  const fixed = [];
  for (const r of await listRecords()) {
    if (r.state !== 'recording' || (state.rid && state.rid === r.id)) continue;
    const n = await countPcm(r.id);
    const last = await lastPcm(r.id);
    const lastLen = last ? new Int16Array(last.pcm).length : 0;
    const samples = n ? (n - 1) * CHUNK + lastLen : 0;
    await updateRecord(r.id, (x) => {
      x.audio = { ...x.audio, chunks: n, samples, duration: samples / RATE };
      x.state = samples > RATE ? 'recorded' : 'empty';
      x.recovered = true;
    });
    fixed.push(r.id);
  }
  return fixed;
}
export { getRecord };
