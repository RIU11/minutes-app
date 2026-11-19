// 外部サービス（Google Gemini・Groq）とのやりとり
// 「部外秘ではない」を選んだ記録だけが、ここを通って外に出られる。
// 送る直前に毎回、保存されている記録を読み直して確かめる（途中で部外秘にしたら、そこで止まる）。
import { getRecord, kvGet } from './db.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ = 'https://api.groq.com/openai/v1';

export class ExternalBlockedError extends Error {
  constructor(msg) { super(msg); this.name = 'ExternalBlockedError'; }
}

async function guard(rid) {
  if (!rid) throw new ExternalBlockedError('記録が指定されていません');
  const rec = await getRecord(rid);
  if (!rec) throw new ExternalBlockedError('記録が見つかりません');
  if (rec.privacy === 'confidential') throw new ExternalBlockedError('この記録は部外秘（ロック中）なので、外部サービスには送れません。');
  if (rec.privacy !== 'public') throw new ExternalBlockedError('「部外秘ではない」を選んだ記録だけ、外部サービスに送れます。');
  if ((await kvGet('externalOff', false)) === true) throw new ExternalBlockedError('設定で外部サービスを止めています。');
  return rec;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('中止しました'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
}

// 無料枠の回数制限に合わせて、送る間隔をあける
const gate = { gemini: { next: 0, gap: 4200 }, groq: { next: 0, gap: 3200 } };
async function waitTurn(svc, signal) {
  const g = gate[svc]; const now = Date.now();
  const t = Math.max(0, g.next - now);
  g.next = Math.max(now, g.next) + g.gap;
  if (t) await sleep(t, signal);
}

async function apiError(svc, res) {
  let detail = '';
  try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { /* 無視 */ }
  const name = svc === 'gemini' ? 'Gemini' : 'Groq';
  let msg;
  if (res.status === 400) msg = `${name}：送った内容を受け付けてもらえませんでした。`;
  else if (res.status === 401 || res.status === 403) msg = `${name}：キーが使えません。キーが正しいか、使える状態かを確かめてください。`;
  else if (res.status === 404) msg = `${name}：AIモデルが見つかりません（設定でモデルを選び直してください）。`;
  else if (res.status === 413) msg = `${name}：送る音声が大きすぎました。`;
  else if (res.status === 429) msg = `${name}：無料枠の回数をこえました。しばらく待ってから続けてください。`;
  else msg = `${name}：エラーが起きました（${res.status}）。`;
  const e = new Error(detail ? `${msg}（${detail}）` : msg);
  e.status = res.status;
  return e;
}

async function fetchRetry(svc, url, init, { signal, tries = 5 } = {}) {
  for (let i = 0; ; i++) {
    await waitTurn(svc, signal);
    let res;
    try { res = await fetch(url, { ...init, signal }); } catch (e) {
      if (signal && signal.aborted) throw e;
      if (i >= tries) throw new Error('通信できませんでした。ネットワークを確かめてください。');
      await sleep(2000 * (i + 1), signal); continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (i >= tries) throw await apiError(svc, res);
      const ra = Number(res.headers.get('retry-after'));
      await sleep(ra ? ra * 1000 + 500 : Math.min(60000, 5000 * 2 ** i), signal);
      continue;
    }
    if (!res.ok) throw await apiError(svc, res);
    return res;
  }
}

// ---------- Gemini ----------
// キーは x-goog-api-key で送る。受け付けられないキー（2026年からの新しい形式など）は ?key= でも試す
let keyInQuery = false;
function gUrl(url, key) { return keyInQuery ? url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : url; }
function gHeaders(key, extra = {}) { return keyInQuery ? { ...extra } : { ...extra, 'x-goog-api-key': key }; }

export async function geminiModels(key) {
  let res = await fetch(gUrl(`${GEMINI}/models?pageSize=1000`, key), { headers: gHeaders(key) });
  if ((res.status === 401 || res.status === 403) && !keyInQuery) {
    const alt = await fetch(`${GEMINI}/models?pageSize=1000&key=${encodeURIComponent(key)}`).catch(() => null);
    if (alt && alt.ok) { keyInQuery = true; res = alt; }
  }
  if (!res.ok) throw await apiError('gemini', res);
  const j = await res.json();
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => ({
    id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name, inLimit: m.inputTokenLimit || 0,
  }));
}
// いちばん新しい「Flash」系（文章用）を選ぶ
export function pickGeminiModel(list) {
  const bad = /(image|tts|live|embed|transcribe|audio|vision|robotics|computer|nano|aqa|learnlm|gemma|veo|imagen|lyria|decision|native|exp-|-exp|thinking)/i;
  const cand = list.filter((m) => /^gemini-/.test(m.id) && !bad.test(m.id));
  const ver = (id) => { const m = /^gemini-(\d+(?:\.\d+)?)/.exec(id); return m ? parseFloat(m[1]) : 0; };
  const score = (m) => {
    let s = ver(m.id) * 100;
    if (/flash/.test(m.id)) s += 30;
    if (/lite/.test(m.id)) s -= 25;
    if (/pro/.test(m.id)) s -= 10;
    if (/preview/.test(m.id)) s -= 15;
    if (/-\d{3,}$|-\d{2}-\d{4}$/.test(m.id)) s -= 2;
    return s;
  };
  cand.sort((a, b) => score(b) - score(a));
  return cand[0] ? cand[0].id : (list[0] ? list[0].id : 'gemini-2.5-flash');
}
export async function geminiCheck(key) {
  keyInQuery = false;
  const list = await geminiModels(key);
  if (!list.length) throw new Error('このキーで使えるAIモデルが見つかりませんでした。');
  return { models: list, pick: pickGeminiModel(list), keyInQuery };
}

export async function geminiGenerate(rid, body, { signal } = {}) {
  await guard(rid);
  const key = await kvGet('geminiKey');
  if (!key) throw new ExternalBlockedError('Gemini のキーがまだ設定されていません（設定 → 外部サービスの準備）。');
  const model = (await kvGet('geminiModel')) || 'gemini-2.5-flash';
  if ((await kvGet('geminiKeyInQuery', false)) === true) keyInQuery = true;
  const res = await fetchRetry('gemini', gUrl(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, key), {
    method: 'POST', headers: gHeaders(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  }, { signal });
  const j = await res.json();
  const cand = j.candidates && j.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter((p) => !p.thought).map((p) => p.text || '').join('') : '';
  if (!text) {
    const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || '空の返事';
    throw new Error(`Gemini から内容が返ってきませんでした（${why}）。`);
  }
  return text;
}

// ---------- Groq（文字起こし） ----------
export async function groqCheck(key) {
  const res = await fetch(`${GROQ}/models`, { headers: { Authorization: 'Bearer ' + key } });
  if (!res.ok) throw await apiError('groq', res);
  const j = await res.json();
  const ids = (j.data || []).map((m) => m.id);
  const whisper = ids.filter((id) => /whisper/i.test(id));
  return { models: ids, whisper, pick: whisper.includes('whisper-large-v3') ? 'whisper-large-v3' : (whisper[0] || 'whisper-large-v3') };
}

export async function groqTranscribe(rid, wav, { signal } = {}) {
  await guard(rid);
  const key = await kvGet('groqKey');
  if (!key) throw new ExternalBlockedError('Groq のキーがまだ設定されていません。');
  const model = (await kvGet('groqModel')) || 'whisper-large-v3';
  const fd = new FormData();
  fd.append('file', wav, 'audio.wav');
  fd.append('model', model);
  fd.append('language', 'ja');
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  fd.append('timestamp_granularities[]', 'segment');
  const res = await fetchRetry('groq', `${GROQ}/audio/transcriptions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd }, { signal });
  return res.json();
}

export async function externalReady() {
  const [g, q, off] = await Promise.all([kvGet('geminiKey'), kvGet('groqKey'), kvGet('externalOff', false)]);
  return { gemini: !!g && !off, groq: !!q && !off, off: !!off };
}

// JSON をゆるく読む（前後に文字がついていても読む）
export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch (e) { /* 続ける */ }
  const s = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(s); } catch (e) { /* 続ける */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  const c = s.indexOf('['), d = s.lastIndexOf(']');
  const tryP = (x, y) => { if (x >= 0 && y > x) { try { return JSON.parse(s.slice(x, y + 1)); } catch (e) { return undefined; } } return undefined; };
  const o = (c >= 0 && (a < 0 || c < a)) ? (tryP(c, d) ?? tryP(a, b)) : (tryP(a, b) ?? tryP(c, d));
  if (o === undefined) throw new Error('AIの返事を読み取れませんでした。');
  return o;
}
