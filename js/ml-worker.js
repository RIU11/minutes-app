// 端末内AI（声の区切り・声の特徴・文字起こし）。画面が固まらないよう別の作業場所で動かす。
// ここで扱う音声は、この端末の外には送らない（モデルのファイルを取りに行くだけ）。
import {
  env, pipeline, AutoProcessor, AutoFeatureExtractor, AutoModel, AutoModelForAudioFrameClassification,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const SEG_ID = 'onnx-community/pyannote-segmentation-3.0';
const EMB_ID = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const M = { seg: null, emb: null, asr: null };

function progressFor(id) {
  return (p) => {
    if (!p) return;
    const { status, file, loaded, total, progress, name } = p;
    self.postMessage({ id, type: 'progress', data: { status, file: file || name, loaded, total, progress } });
  };
}

async function loadSeg(id) {
  if (M.seg) return M.seg;
  const cb = progressFor(id);
  const [proc, model] = await Promise.all([
    AutoProcessor.from_pretrained(SEG_ID, { progress_callback: cb }),
    AutoModelForAudioFrameClassification.from_pretrained(SEG_ID, { dtype: 'fp32', device: 'wasm', progress_callback: cb }),
  ]);
  M.seg = { proc, model };
  return M.seg;
}
async function loadEmb(id) {
  if (M.emb) return M.emb;
  const cb = progressFor(id);
  const [fe, model] = await Promise.all([
    AutoFeatureExtractor.from_pretrained(EMB_ID, { progress_callback: cb }),
    AutoModel.from_pretrained(EMB_ID, { dtype: 'fp32', device: 'wasm', progress_callback: cb }),
  ]);
  M.emb = { fe, model };
  return M.emb;
}
async function loadAsr(id, cfg) {
  const key = JSON.stringify(cfg);
  if (M.asr && M.asr.key === key) return M.asr.pipe;
  if (M.asr) { try { await M.asr.pipe.dispose(); } catch (e) { /* 無視 */ } M.asr = null; }
  const pipe = await pipeline('automatic-speech-recognition', cfg.model, { device: cfg.device, dtype: cfg.dtype, progress_callback: progressFor(id) });
  M.asr = { key, pipe };
  return pipe;
}

function l2(v) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s;
  return o;
}

const handlers = {
  async load(id, a) {
    if (a.which === 'seg') await loadSeg(id);
    else if (a.which === 'emb') await loadEmb(id);
    else if (a.which === 'asr') await loadAsr(id, a.asr);
    return true;
  },
  // 10秒ごとの窓で「だれかが話しているか・何人目か」を調べる
  async seg(id, a) {
    const { proc, model } = await loadSeg(id);
    const out = [];
    for (let audio of a.windows) {
      if (audio.length < 16000) { const p = new Float32Array(16000); p.set(audio); audio = p; }
      const inputs = await proc(audio);
      const { logits } = await model(inputs);
      const segs = proc.post_process_speaker_diarization(logits, audio.length)[0] || [];
      out.push(segs.filter((s) => s.id !== 0).map((s) => ({ id: s.id, start: s.start, end: s.end, c: s.confidence })));
    }
    return out;
  },
  // 声の特徴（256個の数）
  async emb(id, a) {
    const { fe, model } = await loadEmb(id);
    const out = [];
    for (const audio of a.audios) {
      const inputs = await fe(audio);
      const res = await model(inputs);
      const t = res.embeddings || res.last_hidden_state || res[Object.keys(res)[0]];
      out.push(l2(t.data));
    }
    return out;
  },
  // 文字起こし（30秒以内）
  async asr(id, a) {
    const pipe = await loadAsr(id, a.asr);
    const r = await pipe(a.audio, {
      language: 'japanese', task: 'transcribe', return_timestamps: false,
      max_new_tokens: Math.min(440, Math.max(32, Math.round((a.audio.length / 16000) * 12))),
      ...(a.opts || {}),
    });
    return { text: (r && r.text) || '' };
  },
  async dispose(id, a) {
    const which = a.which || 'all';
    for (const k of which === 'all' ? ['seg', 'emb', 'asr'] : [which]) {
      const m = M[k]; if (!m) continue;
      try { if (k === 'asr') await m.pipe.dispose(); else await m.model.dispose(); } catch (e) { /* 無視 */ }
      M[k] = null;
    }
    return true;
  },
  async info() {
    return { isolated: self.crossOriginIsolated, threads: (env.backends && env.backends.onnx && env.backends.onnx.wasm && env.backends.onnx.wasm.numThreads) || null };
  },
};

let chain = Promise.resolve();
self.onmessage = (e) => {
  const { id, cmd, args } = e.data || {};
  chain = chain.then(async () => {
    try {
      const fn = handlers[cmd];
      if (!fn) throw new Error('unknown command: ' + cmd);
      const data = await fn(id, args || {});
      const transfer = [];
      if (Array.isArray(data)) data.forEach((x) => { if (x && x.buffer instanceof ArrayBuffer) transfer.push(x.buffer); });
      self.postMessage({ id, type: 'done', data }, transfer);
    } catch (err) {
      self.postMessage({ id, type: 'error', error: (err && (err.message || String(err))) || 'error' });
    }
  });
};
self.postMessage({ type: 'ready' });
