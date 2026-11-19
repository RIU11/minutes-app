// マイクの音を 16kHz・16bit にして、少しずつ本体へ送る（AudioWorklet）
class Resampler {
  constructor(inRate, outRate, half = 16, phases = 128) {
    this.step = inRate / outRate; this.half = half; this.phases = phases;
    const c = Math.min(1, outRate / inRate) * 0.92;
    this.table = new Float32Array((phases + 1) * 2 * half);
    for (let p = 0; p <= phases; p++) {
      const frac = p / phases; let sum = 0;
      for (let k = 0; k < 2 * half; k++) {
        const x = frac + (half - 1 - k); let v;
        if (Math.abs(x) < 1e-9) v = c;
        else if (Math.abs(x) >= half) v = 0;
        else { const w = 0.42 + 0.5 * Math.cos(Math.PI * x / half) + 0.08 * Math.cos(2 * Math.PI * x / half); v = (Math.sin(Math.PI * c * x) / (Math.PI * x)) * w; }
        this.table[p * 2 * half + k] = v; sum += v;
      }
      if (sum) for (let k = 0; k < 2 * half; k++) this.table[p * 2 * half + k] /= sum;
    }
    this.cap = 8192; this.buf = new Float32Array(this.cap); this.len = half; this.t = half;
  }
  push(input, out) { // out: 配列に追加
    if (this.len + input.length > this.cap) {
      const nb = new Float32Array(Math.max(this.cap * 2, this.len + input.length)); nb.set(this.buf.subarray(0, this.len)); this.buf = nb; this.cap = nb.length;
    }
    this.buf.set(input, this.len); this.len += input.length;
    const half = this.half, tbl = this.table, ph = this.phases, b = this.buf;
    let t = this.t;
    while (t + half < this.len) {
      const i0 = Math.floor(t); const p = Math.round((t - i0) * ph); const off = p * 2 * half; const j0 = i0 - half + 1;
      let acc = 0; for (let k = 0; k < 2 * half; k++) acc += b[j0 + k] * tbl[off + k];
      out.push(acc); t += this.step;
    }
    const keepFrom = Math.max(0, Math.floor(t) - half);
    if (keepFrom > 0) { b.copyWithin(0, keepFrom, this.len); this.len -= keepFrom; }
    this.t = t - keepFrom;
  }
}

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.rs = sampleRate === target ? null : new Resampler(sampleRate, target);
    this.pending = [];
    this.sendEvery = Math.round(target / 4); // 0.25秒ごと
    this.sq = 0; this.cnt = 0; this.peak = 0;
    this.running = true;
    this.port.onmessage = (e) => { if (e.data && e.data.cmd === 'pause') this.running = false; if (e.data && e.data.cmd === 'resume') this.running = true; if (e.data && e.data.cmd === 'flush') this.flush(true); };
  }
  flush(force) {
    if (!this.pending.length) { if (force) this.port.postMessage({ pcm: new Int16Array(0), rms: 0, peak: 0, final: true }); return; }
    const n = this.pending.length;
    const i16 = new Int16Array(n);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, this.pending[i])); i16[i] = v < 0 ? v * 32768 : v * 32767; }
    const rms = this.cnt ? Math.sqrt(this.sq / this.cnt) : 0;
    this.port.postMessage({ pcm: i16, rms, peak: this.peak, final: !!force }, [i16.buffer]);
    this.pending = []; this.sq = 0; this.cnt = 0; this.peak = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.running || !input || !input.length || !input[0]) return true;
    let ch = input[0];
    if (input.length > 1) { const m = new Float32Array(ch.length); for (let c = 0; c < input.length; c++) { const d = input[c]; for (let i = 0; i < d.length; i++) m[i] += d[i] / input.length; } ch = m; }
    for (let i = 0; i < ch.length; i++) { const v = ch[i]; this.sq += v * v; const a = v < 0 ? -v : v; if (a > this.peak) this.peak = a; }
    this.cnt += ch.length;
    if (this.rs) this.rs.push(ch, this.pending); else for (let i = 0; i < ch.length; i++) this.pending.push(ch[i]);
    if (this.pending.length >= this.sendEvery) this.flush(false);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
