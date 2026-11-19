// 時間のかかる処理（話者分け・文字起こし・要約）を、画面を移っても続けられるように管理する
const jobs = new Map();
const listeners = new Set();

export function onJobs(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(rid) { listeners.forEach((fn) => { try { fn(rid, jobs.get(rid) || null); } catch (e) { console.error(e); } }); }

export function getJob(rid) { return jobs.get(rid) || null; }
export function anyJob() { return jobs.size > 0; }

export function startJob(rid, kind, fn) {
  if (jobs.has(rid)) throw new Error('この記録は処理中です');
  const ac = new AbortController();
  const job = { rid, kind, ratio: 0, text: '準備しています…', eta: null, signal: ac.signal, abort: () => ac.abort(), error: null, startedAt: Date.now() };
  jobs.set(rid, job);
  emit(rid);
  const progress = (p) => {
    if (!jobs.has(rid)) return;
    if (p.ratio != null) job.ratio = p.ratio;
    if (p.text) job.text = p.text;
    job.eta = p.eta != null ? p.eta : null;
    emit(rid);
  };
  const promise = (async () => {
    try { await fn({ signal: ac.signal, progress }); job.ok = true; } catch (e) { job.error = e; throw e; } finally {
      jobs.delete(rid);
      lastResult.set(rid, { kind, ok: !job.error, error: job.error, at: Date.now() });
      emit(rid);
    }
  })();
  promise.catch(() => {});
  return promise;
}
export function cancelJob(rid) { const j = jobs.get(rid); if (j) j.abort(); }

const lastResult = new Map();
export function lastJobResult(rid) { return lastResult.get(rid) || null; }
export function clearJobResult(rid) { lastResult.delete(rid); }
