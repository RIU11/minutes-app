// 端末内の文章AI（WebLLM・WebGPU）。要約と質問づくりに使う。外には送らない。
import { llmChoice } from './device.js';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js';
let engine = null, engineModel = null, worker = null, loading = null;

export async function getEngine(onProgress) {
  const choice = await llmChoice();
  if (choice.key === 'simple') return null;
  if (engine && engineModel === choice.model) return { engine, choice };
  if (loading) await loading.catch(() => {});
  if (engine && engineModel === choice.model) return { engine, choice };
  loading = (async () => {
    if (engine) { try { await engine.unload(); } catch (e) { /* 無視 */ } engine = null; }
    if (worker) { try { worker.terminate(); } catch (e) { /* 無視 */ } worker = null; }
    const webllm = await import(WEBLLM_URL);
    worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
    engine = await webllm.CreateWebWorkerMLCEngine(worker, choice.model, {
      initProgressCallback: (r) => { if (onProgress) onProgress({ ratio: r.progress || 0, text: r.text || '' }); },
    });
    engineModel = choice.model;
  })();
  try { await loading; } finally { loading = null; }
  return { engine, choice };
}

export async function unloadEngine() {
  if (engine) { try { await engine.unload(); } catch (e) { /* 無視 */ } }
  if (worker) { try { worker.terminate(); } catch (e) { /* 無視 */ } }
  engine = null; engineModel = null; worker = null;
}

function stripThink(s) { return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '').trim(); }

export async function chat({ engine, choice }, prompt, { maxTokens = 600, temperature = 0.3, signal } = {}) {
  if (signal && signal.aborted) { const e = new Error('中止しました'); e.name = 'AbortError'; throw e; }
  const req = { messages: [{ role: 'user', content: prompt }], temperature, max_tokens: maxTokens, top_p: 0.9, frequency_penalty: 0.3, presence_penalty: 0 };
  if (choice.qwen) req.extra_body = { enable_thinking: false };
  let onAbort = null;
  if (signal) { onAbort = () => { try { engine.interruptGenerate(); } catch (e) { /* 無視 */ } }; signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    let r;
    try { r = await engine.chat.completions.create(req); } catch (e) {
      if (!req.extra_body) throw e;
      delete req.extra_body; r = await engine.chat.completions.create(req);
    }
    if (signal && signal.aborted) { const e = new Error('中止しました'); e.name = 'AbortError'; throw e; }
    return stripThink(r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : '');
  } finally { if (signal && onAbort) signal.removeEventListener('abort', onAbort); }
}
