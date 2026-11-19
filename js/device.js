// 端末の力を調べて、使うAIモデルを決める
import { kvGet } from './db.js';

let cached = null;
export async function detect() {
  if (cached) return cached;
  const ua = navigator.userAgent || '';
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  let webgpu = false, f16 = false, adapterInfo = '';
  if (navigator.gpu) {
    try {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (ad) {
        webgpu = true; f16 = ad.features.has('shader-f16');
        try { const info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null); if (info) adapterInfo = [info.vendor, info.architecture].filter(Boolean).join(' '); } catch (e) { /* 無視 */ }
      }
    } catch (e) { webgpu = false; }
  }
  cached = {
    mobile, ios, webgpu, f16, adapterInfo,
    mem: navigator.deviceMemory || null,
    threads: navigator.hardwareConcurrency || 4,
    isolated: !!self.crossOriginIsolated,
  };
  return cached;
}

// 文字起こし（Whisper）の選択肢
export const WHISPER = {
  base: {
    id: 'onnx-community/whisper-base', label: '軽量', size: '約80〜210MB',
    desc: '速いが、日本語のまちがいが多め。スマホ向け。',
    dtype: { wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
  },
  small: {
    id: 'onnx-community/whisper-small', label: '標準', size: '約250〜590MB',
    desc: '速さと正確さのバランス。ふつうはこれ。',
    dtype: { wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' }, webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, webgpuF16: { encoder_model: 'fp16', decoder_model_merged: 'q4' } },
  },
  turbo: {
    id: 'onnx-community/whisper-large-v3-turbo', label: '高精度', size: '約560〜760MB',
    desc: 'いちばん正確。WebGPU が使えるパソコン向け（スマホでは止まることがあります）。',
    needsWebGPU: true,
    dtype: { webgpu: { encoder_model: 'q4', decoder_model_merged: 'q4' }, webgpuF16: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } },
  },
};

// 要約（端末内AI）の選択肢（WebLLM）
export const LLM = {
  gemma: { f16: 'gemma-2-2b-jpn-it-q4f16_1-MLC', f32: 'gemma-2-2b-jpn-it-q4f32_1-MLC', label: '日本語Gemma 2B（標準）', size: '約1.5GB', desc: '日本語向けに調整された小さなAI。8GBメモリのパソコンでも動きます。' },
  qwen: { f16: 'Qwen3.5-4B-q4f16_1-MLC', f32: 'Qwen3.5-4B-q4f32_1-MLC', label: 'Qwen3.5 4B（高品質）', size: '約2.5GB', desc: 'まとめが上手。16GBメモリ以上のパソコン向け。', qwen: true },
  simple: { label: 'AIを使わない簡易まとめ', size: '0MB', desc: '大事そうな文を選んで並べます。どの端末でもすぐ動きます。' },
};

export async function whisperChoice() {
  const d = await detect();
  let key = await kvGet('whisperModel', 'auto');
  if (key === 'auto' || !WHISPER[key]) key = d.webgpu && d.f16 && !d.mobile ? 'turbo' : 'small';
  if (WHISPER[key].needsWebGPU && !d.webgpu) key = 'small';
  const m = WHISPER[key];
  const device = d.webgpu ? 'webgpu' : 'wasm';
  const dtype = device === 'webgpu' ? (d.f16 && m.dtype.webgpuF16 ? m.dtype.webgpuF16 : m.dtype.webgpu) : m.dtype.wasm;
  return { key, model: m.id, device, dtype, label: `${m.label}（${m.id.split('/')[1]}）` };
}

export async function llmChoice() {
  const d = await detect();
  let key = await kvGet('llmModel', 'auto');
  if (key === 'auto' || !LLM[key]) key = d.webgpu ? 'gemma' : 'simple';
  if (key !== 'simple' && !d.webgpu) key = 'simple';
  const m = LLM[key];
  if (key === 'simple') return { key, label: m.label };
  return { key, model: d.f16 ? m.f16 : m.f32, label: m.label, qwen: !!m.qwen };
}
