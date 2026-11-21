// いま録音しているかどうか（画面を移っても・画面を閉じても、「停止」を押すまで録音は終わらせない）
import { Recorder } from './recorder.js';
import { getRecord, putRecord, updateRecord, newRecord, listRecords, countPcm, lastPcm, getBlobs } from './db.js';
import { CHUNK, RATE } from './audio.js';

const state = { rec: null, rid: null, level: 0, peak: 0, seconds: 0, paused: false, interrupted: false };
const listeners = new Set();
export function onRecording(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }
export function recState() { return state; }
export function isRecording() { return !!state.rec; }

async function saveProgress() {
  if (!state.rec) return;
  const { chunks, samples } = await state.rec.checkpoint();
  await updateRecord(state.rid, (x) => { x.audio = { ...x.audio, chunks, samples, duration: samples / RATE }; }).catch(() => {});
}
const onHide = () => { if (document.visibilityState === 'hidden') saveProgress(); };

async function begin(rid, resume) {
  const rec = new Recorder(rid, {
    onLevel: (rms, pk) => { state.level = rms; state.peak = pk; emit(); },
    onTick: (sec) => { state.seconds = sec; },
    onError: (e) => console.error(e),
    onState: (s) => { state.interrupted = s === 'interrupted'; emit(); },
    resume,
  });
  state.rec = rec; state.rid = rid; state.seconds = resume ? resume.samples / RATE : 0; state.paused = false; state.interrupted = false;
  try { await rec.start(); } catch (e) { state.rec = null; state.rid = null; emit(); throw e; }
  // こまめに保存しておく（途中で閉じられても、そこまでの録音は残る）
  state.timer = setInterval(saveProgress, 10000);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', saveProgress);
  emit();
  return rid;
}

export async function startRecording(fields) {
  if (state.rec) throw new Error('すでに録音中です');
  const r = newRecord({ ...fields, state: 'recording', source: 'mic' });
  await putRecord(r);
  try { return await begin(r.id, null); } catch (e) {
    const { deleteRecord } = await import('./db.js');
    await deleteRecord(r.id).catch(() => {});
    throw e;
  }
}

// 中断した録音の続きを録る（同じ記録に足していく）
export async function continueRecording(rid) {
  if (state.rec) throw new Error('すでに録音中です');
  const n = await countPcm(rid);
  const last = await lastPcm(rid);
  const lastData = last ? new Int16Array(last.pcm) : null;
  const partial = lastData && lastData.length < CHUNK;
  const chunkIdx = last ? (partial ? last.i : last.i + 1) : 0;
  const samples = last ? last.i * CHUNK + lastData.length : 0;
  const blobs = await getBlobs(rid);
  await updateRecord(rid, (x) => { x.state = 'recording'; x.recovered = false; x.audio = { ...x.audio, compressed: null }; });
  return begin(rid, { chunkIdx, chunkData: partial ? lastData : null, samples, blobIdx: blobs.length });
}

export function pauseRecording() { if (state.rec) { state.rec.pause(); state.paused = true; emit(); saveProgress(); } }
export function resumeRecording() { if (state.rec) { state.rec.resume(); state.paused = false; emit(); } }
export async function addAnchor() {
  if (!state.rec) return 0;
  const t = state.rec.seconds;
  const r = await updateRecord(state.rid, (x) => { x.anchors = [...(x.anchors || []), +t.toFixed(2)]; });
  return r.anchors.length;
}

// 録音を終えるのは、ここ（「停止」ボタン）だけ
export async function stopRecording() {
  if (!state.rec) return null;
  const rec = state.rec, rid = state.rid;
  clearInterval(state.timer);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', saveProgress);
  const res = await rec.stop();
  state.rec = null; state.rid = null; state.paused = false; state.level = 0; state.interrupted = false;
  await updateRecord(rid, (x) => {
    x.audio = { ...x.audio, chunks: res.chunks, samples: res.samples, duration: res.duration, compressed: res.compressed };
    x.state = res.samples > RATE ? 'recorded' : 'empty';
  });
  emit();
  return rid;
}

// 録音中にアプリやタブが閉じられた記録は、「中断中」として残す（続きを録れる。終わらせるのは停止ボタン）
export async function recoverInterrupted() {
  const fixed = [];
  for (const r of await listRecords()) {
    if (r.state !== 'recording' || (state.rid && state.rid === r.id)) continue;
    const n = await countPcm(r.id);
    const last = await lastPcm(r.id);
    const samples = last ? last.i * CHUNK + new Int16Array(last.pcm).length : 0;
    await updateRecord(r.id, (x) => {
      x.audio = { ...x.audio, chunks: last ? last.i + 1 : n, samples, duration: samples / RATE, compressed: null };
      x.state = 'paused';
      x.recovered = true;
    });
    fixed.push(r.id);
  }
  return fixed;
}
export async function pausedRecords() {
  return (await listRecords()).filter((r) => r.state === 'paused');
}
// 中断中の記録を、ここで終える（停止ボタンと同じ）
export async function finishPaused(rid) {
  await updateRecord(rid, (x) => { x.state = (x.audio.samples || 0) > RATE ? 'recorded' : 'empty'; x.recovered = false; });
}
export { getRecord };
