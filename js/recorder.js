// 録音（マイク → 16kHz の音声を10秒ずつ保存。書き出し用に圧縮した音声も保存）
import { putPcm, putBlob } from './db.js';
import { RATE, CHUNK } from './audio.js';

export class Recorder {
  constructor(rid, { onLevel, onTick, onError } = {}) {
    this.rid = rid; this.onLevel = onLevel; this.onTick = onTick; this.onError = onError;
    this.chunkBuf = new Int16Array(CHUNK); this.chunkLen = 0; this.chunkIdx = 0;
    this.samples = 0; this.paused = false; this.stopped = false;
    this.blobIdx = 0; this.saving = Promise.resolve();
    this.wakeLock = null; this.mime = '';
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('この端末・ブラウザでは録音できません（https で開いているか確認してください）');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture', { processorOptions: { targetRate: RATE }, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.port.onmessage = (e) => this._onData(e.data);
    this.mute = this.ctx.createGain(); this.mute.gain.value = 0;
    this.src.connect(this.node); this.node.connect(this.mute); this.mute.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // 書き出し用の圧縮音声
    try {
      const types = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
      this.mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      if (window.MediaRecorder) {
        this.mr = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : undefined);
        this.mime = this.mr.mimeType || this.mime;
        this.mr.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) { const i = this.blobIdx++; this.saving = this.saving.then(() => putBlob(this.rid, i, ev.data)).catch((err) => this.onError && this.onError(err)); }
        };
        this.mr.start(10000);
      }
    } catch (e) { this.mr = null; }

    await this._lock();
    this._vis = () => { if (document.visibilityState === 'visible' && !this.stopped) this._lock(); };
    document.addEventListener('visibilitychange', this._vis);
  }

  async _lock() {
    try { if ('wakeLock' in navigator && !this.wakeLock) { this.wakeLock = await navigator.wakeLock.request('screen'); this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }); } } catch (e) { /* 使えなくても続ける */ }
  }

  _onData(d) {
    const pcm = d.pcm;
    if (this.onLevel) this.onLevel(d.rms || 0, d.peak || 0);
    if (!pcm || !pcm.length) { if (d.final && this._flushResolve) this._flushResolve(); return; }
    let off = 0;
    while (off < pcm.length) {
      const n = Math.min(CHUNK - this.chunkLen, pcm.length - off);
      this.chunkBuf.set(pcm.subarray(off, off + n), this.chunkLen);
      this.chunkLen += n; off += n; this.samples += n;
      if (this.chunkLen === CHUNK) {
        const i = this.chunkIdx++; const buf = this.chunkBuf.buffer;
        this.saving = this.saving.then(() => putPcm(this.rid, i, buf)).catch((err) => this.onError && this.onError(err));
        this.chunkBuf = new Int16Array(CHUNK); this.chunkLen = 0;
      }
    }
    if (this.onTick) this.onTick(this.samples / RATE);
    if (d.final && this._flushResolve) this._flushResolve();
  }

  get seconds() { return this.samples / RATE; }

  pause() {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.node.port.postMessage({ cmd: 'pause' });
    try { if (this.mr && this.mr.state === 'recording') this.mr.pause(); } catch (e) { /* 無視 */ }
  }
  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.node.port.postMessage({ cmd: 'resume' });
    try { if (this.mr && this.mr.state === 'paused') this.mr.resume(); } catch (e) { /* 無視 */ }
  }

  async stop() {
    if (this.stopped) return this.result();
    this.stopped = true;
    // 残りを受け取る
    await new Promise((resolve) => { this._flushResolve = resolve; try { this.node.port.postMessage({ cmd: 'flush' }); } catch (e) { resolve(); } setTimeout(resolve, 800); });
    this._flushResolve = null;
    if (this.chunkLen > 0) {
      const i = this.chunkIdx++; const part = this.chunkBuf.slice(0, this.chunkLen);
      this.saving = this.saving.then(() => putPcm(this.rid, i, part.buffer));
      this.chunkLen = 0;
    }
    if (this.mr && this.mr.state !== 'inactive') {
      await new Promise((resolve) => { this.mr.addEventListener('stop', resolve, { once: true }); try { this.mr.stop(); } catch (e) { resolve(); } setTimeout(resolve, 2000); });
    }
    try { this.src.disconnect(); this.node.disconnect(); this.mute.disconnect(); } catch (e) { /* 無視 */ }
    try { this.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* 無視 */ }
    try { await this.ctx.close(); } catch (e) { /* 無視 */ }
    try { if (this.wakeLock) await this.wakeLock.release(); } catch (e) { /* 無視 */ }
    document.removeEventListener('visibilitychange', this._vis);
    await this.saving;
    return this.result();
  }

  result() {
    return {
      chunks: this.chunkIdx, samples: this.samples, duration: this.samples / RATE,
      compressed: this.blobIdx ? { mime: this.mime || 'audio/webm', count: this.blobIdx } : null,
    };
  }
}

// マイクの確認だけ（保存しない）
export class MicMonitor {
  async start(onLevel) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const an = this.ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
    const data = new Float32Array(an.fftSize);
    const loop = () => {
      if (!this.ctx) return;
      an.getFloatTimeDomainData(data);
      let sq = 0, pk = 0; for (const v of data) { sq += v * v; const a = Math.abs(v); if (a > pk) pk = a; }
      onLevel(Math.sqrt(sq / data.length), pk);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  stop() {
    cancelAnimationFrame(this.raf);
    try { this.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* 無視 */ }
    try { this.ctx.close(); } catch (e) { /* 無視 */ }
    this.ctx = null;
  }
}

// 声の大きさを、わかりやすいことばにする
export function levelInfo(rms) {
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  let msg = '', cls = '';
  if (db < -50) { msg = '音がほとんど入っていません'; cls = 'low'; }
  else if (db < -38) { msg = '声が小さめです。先生の方へ向けて置くと良くなります'; cls = 'low'; }
  else if (db < -8) { msg = '声が届いています'; cls = 'ok'; }
  else { msg = '音が大きすぎます。少し離してください'; cls = 'high'; }
  return { db, pct, msg, cls };
}
