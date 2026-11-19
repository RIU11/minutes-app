// 端末内AI（ml-worker.js）とのやりとり
let worker = null;
let seq = 0;
const pending = new Map();

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL('./ml-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, type, data, error } = e.data || {};
    if (!id) return;
    const p = pending.get(id);
    if (!p) return;
    if (type === 'progress') { if (p.onProgress) p.onProgress(data); return; }
    pending.delete(id);
    if (type === 'done') p.resolve(data); else p.reject(new Error(error || 'エラー'));
  };
  worker.onerror = (e) => {
    const msg = (e && e.message) || '端末内AIの読み込みに失敗しました（通信やブラウザを確認してください）';
    for (const [, p] of pending) p.reject(new Error(msg));
    pending.clear();
    try { worker.terminate(); } catch (err) { /* 無視 */ }
    worker = null;
  };
  return worker;
}

export function mlCall(cmd, args = {}, { onProgress, transfer = [] } = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try { ensure().postMessage({ id, cmd, args }, transfer); } catch (e) { pending.delete(id); reject(e); }
  });
}

export function mlTerminate() {
  if (worker) { try { worker.terminate(); } catch (e) { /* 無視 */ } worker = null; }
  for (const [, p] of pending) p.reject(new Error('中止しました'));
  pending.clear();
}

// ダウンロードの進み具合を、ファイルごとに合計する
export function makeDownloadTracker(onUpdate) {
  const files = new Map();
  return (p) => {
    if (!p || !p.file) return;
    if (p.status === 'progress' || p.status === 'download' || p.status === 'initiate') {
      const cur = files.get(p.file) || { loaded: 0, total: 0 };
      if (p.loaded != null) cur.loaded = p.loaded;
      if (p.total) cur.total = p.total;
      files.set(p.file, cur);
    } else if (p.status === 'done') {
      const cur = files.get(p.file); if (cur && cur.total) cur.loaded = cur.total;
    }
    let loaded = 0, total = 0;
    for (const v of files.values()) { loaded += v.loaded || 0; total += v.total || 0; }
    onUpdate({ loaded, total, ratio: total ? loaded / total : 0 });
  };
}
