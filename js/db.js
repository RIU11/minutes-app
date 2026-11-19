// 端末の中だけに保存する（IndexedDB）。外には送らない。
const DB_NAME = 'minutes-app';
const DB_VER = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pcm')) db.createObjectStore('pcm', { keyPath: ['rid', 'i'] });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: ['rid', 'i'] });
      if (!db.objectStoreNames.contains('emb')) db.createObjectStore('emb', { keyPath: 'rid' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースを開けませんでした（別のタブを閉じてください）'));
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function doneP(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存を中止しました')); });
}

// ---------- 部外秘のロック ----------
// 一度「部外秘」にした記録は、二度と「部外秘ではない」に戻せない。ここで必ず止める。
export class PrivacyLockError extends Error {
  constructor() { super('この記録は部外秘としてロックされています。外部サービスには送れません。'); this.name = 'PrivacyLockError'; }
}
function enforcePrivacy(oldRec, newRec) {
  if (oldRec && oldRec.privacy === 'confidential' && newRec.privacy !== 'confidential') throw new PrivacyLockError();
  if (!['unset', 'confidential', 'public'].includes(newRec.privacy)) newRec.privacy = 'unset';
}

// ---------- 記録 ----------
export async function getRecord(id) {
  const db = await openDB();
  return reqP(db.transaction('records').objectStore('records').get(id));
}
export async function listRecords() {
  const db = await openDB();
  const all = await reqP(db.transaction('records').objectStore('records').getAll());
  return all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || (b.createdAt - a.createdAt));
}
export async function putRecord(rec) {
  const db = await openDB();
  const tx = db.transaction('records', 'readwrite');
  const st = tx.objectStore('records');
  const old = await reqP(st.get(rec.id));
  enforcePrivacy(old, rec);
  rec.updatedAt = Date.now();
  st.put(rec);
  await doneP(tx);
  emitChange(rec.id);
  return rec;
}
// 読んで・直して・書く を1回の手続きで（同時に直しても消えないように）
export async function updateRecord(id, fn) {
  const db = await openDB();
  const tx = db.transaction('records', 'readwrite');
  const st = tx.objectStore('records');
  const old = await reqP(st.get(id));
  if (!old) { tx.abort(); throw new Error('記録が見つかりません'); }
  const before = old.privacy;
  const rec = structuredClone(old);
  const r = fn(rec);
  if (r && typeof r.then === 'function') throw new Error('updateRecord の関数は同期にしてください');
  enforcePrivacy({ privacy: before }, rec);
  rec.updatedAt = Date.now();
  st.put(rec);
  await doneP(tx);
  emitChange(id);
  return rec;
}
export async function deleteRecord(id) {
  const db = await openDB();
  const tx = db.transaction(['records', 'pcm', 'blobs', 'emb'], 'readwrite');
  tx.objectStore('records').delete(id);
  const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
  tx.objectStore('pcm').delete(range);
  tx.objectStore('blobs').delete(range);
  tx.objectStore('emb').delete(id);
  await doneP(tx);
  emitChange(id);
}
export async function deleteAudio(id) {
  const db = await openDB();
  const tx = db.transaction(['pcm', 'blobs', 'emb'], 'readwrite');
  const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
  tx.objectStore('pcm').delete(range);
  tx.objectStore('blobs').delete(range);
  tx.objectStore('emb').delete(id);
  await doneP(tx);
}

// ---------- 音声（16kHz・1ch・16bit を10秒ずつ） ----------
export async function putPcm(rid, i, buf) {
  const db = await openDB();
  const tx = db.transaction('pcm', 'readwrite');
  tx.objectStore('pcm').put({ rid, i, pcm: buf });
  await doneP(tx);
}
export async function getPcm(rid, i) {
  const db = await openDB();
  const row = await reqP(db.transaction('pcm').objectStore('pcm').get([rid, i]));
  return row ? row.pcm : null;
}
export async function getPcmRange(rid, i0, i1) {
  const db = await openDB();
  const rows = await reqP(db.transaction('pcm').objectStore('pcm').getAll(IDBKeyRange.bound([rid, i0], [rid, i1])));
  return rows;
}
export async function countPcm(rid) {
  const db = await openDB();
  return reqP(db.transaction('pcm').objectStore('pcm').count(IDBKeyRange.bound([rid, -Infinity], [rid, Infinity])));
}
export async function lastPcm(rid) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('pcm').objectStore('pcm').openCursor(IDBKeyRange.bound([rid, -Infinity], [rid, Infinity]), 'prev');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

// 圧縮した録音（書き出し用）
export async function putBlob(rid, i, blob) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ rid, i, blob });
  await doneP(tx);
}
export async function getBlobs(rid) {
  const db = await openDB();
  const rows = await reqP(db.transaction('blobs').objectStore('blobs').getAll(IDBKeyRange.bound([rid, -Infinity], [rid, Infinity])));
  return rows.sort((a, b) => a.i - b.i).map((r) => r.blob);
}

// 声の特徴（分け直しに使う）
export async function putEmb(rid, data) {
  const db = await openDB();
  const tx = db.transaction('emb', 'readwrite');
  tx.objectStore('emb').put({ rid, ...data });
  await doneP(tx);
}
export async function getEmb(rid) {
  const db = await openDB();
  return reqP(db.transaction('emb').objectStore('emb').get(rid));
}

// ---------- 設定 ----------
export async function kvGet(k, def = null) {
  const db = await openDB();
  const row = await reqP(db.transaction('kv').objectStore('kv').get(k));
  return row ? row.v : def;
}
export async function kvSet(k, v) {
  const db = await openDB();
  const tx = db.transaction('kv', 'readwrite');
  if (v === null || v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put({ k, v });
  await doneP(tx);
  emitChange('kv:' + k);
}

// ---------- 変更のお知らせ（画面の更新用） ----------
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitChange(id) { listeners.forEach((fn) => { try { fn(id); } catch (e) { console.error(e); } }); }

// ---------- 新しい記録 ----------
export function newRecord(fields = {}) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    id: 'r' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '', date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, time: `${p(now.getHours())}:${p(now.getMinutes())}`,
    place: '', participants: '', agenda: '', memo: '',
    createdAt: now.getTime(), updatedAt: now.getTime(),
    privacy: 'unset', privacyAt: null,
    source: 'mic', fileName: '',
    audio: { rate: 16000, chunkSec: 10, chunks: 0, samples: 0, duration: 0, compressed: null },
    state: 'recording',
    anchors: [],
    diar: null, speakers: [], segs: [],
    trans: null, summary: null, questions: [], tasks: [],
    ...fields,
  };
}
