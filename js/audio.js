'use strict';

/* =========================================================
   程序化音效（Web Audio）
   必须在用户手势回调中初始化
   ========================================================= */
const SFX = {
  ctx: null,
  master: null,
  muted: false,
  ready: false,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;

      // 压限器：多音叠加时防止削波
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      // 轻微混响，让音色更"空间"
      this.reverb = this.ctx.createGain();
      this.reverb.gain.value = 0.22;
      this.reverb.connect(this.master);

      this.ready = true;
    } catch (e) {
      this.ready = false;
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  /** 基础音：类型 + 频率包络 */
  tone(opts) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.15;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.f0 || 440, t0);
    if (opts.f1 != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t0 + dur);
    }
    const vol = (opts.vol == null ? 0.25 : opts.vol);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(this.master);
    if (opts.reverb) gain.connect(this.reverb);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  /** 噪声爆炸 */
  noise(opts) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const dur = opts.dur || 0.25;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, opts.decay || 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'lowpass';
    filter.frequency.setValueAtTime(opts.f0 || 1800, t0);
    if (opts.f1) filter.frequency.exponentialRampToValueAtTime(opts.f1, t0 + dur);
    filter.Q.value = opts.q || 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.vol == null ? 0.3 : opts.vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
  },

  /* ---------- 具体音效 ---------- */
  castBolt() {
    this.tone({ type: 'triangle', f0: 680, f1: 1180, dur: 0.12, vol: 0.14 });
    this.tone({ type: 'sine', f0: 1360, f1: 1720, dur: 0.09, vol: 0.06, delay: 0.01 });
  },
  castFire() {
    this.noise({ f0: 900, f1: 240, dur: 0.28, vol: 0.2, filter: 'bandpass', q: 1.4 });
    this.tone({ type: 'sawtooth', f0: 220, f1: 90, dur: 0.24, vol: 0.12 });
  },
  castIce() {
    this.tone({ type: 'sine', f0: 1760, f1: 2400, dur: 0.16, vol: 0.1 });
    this.tone({ type: 'triangle', f0: 2400, f1: 3100, dur: 0.12, vol: 0.05, delay: 0.03 });
    this.noise({ f0: 5200, f1: 2600, dur: 0.16, vol: 0.07, filter: 'highpass' });
  },
  castThunder() {
    this.noise({ f0: 6000, f1: 700, dur: 0.3, vol: 0.26, filter: 'highpass', decay: 1.4 });
    this.tone({ type: 'square', f0: 140, f1: 60, dur: 0.2, vol: 0.12 });
  },
  castMeteor() {
    this.noise({ f0: 400, f1: 90, dur: 0.75, vol: 0.22, filter: 'lowpass' });
    this.tone({ type: 'sawtooth', f0: 90, f1: 40, dur: 0.7, vol: 0.15 });
  },
  explode() {
    this.noise({ f0: 1600, f1: 120, dur: 0.45, vol: 0.3, decay: 2.4 });
    this.tone({ type: 'sine', f0: 120, f1: 42, dur: 0.4, vol: 0.2 });
  },
  hit() {
    this.noise({ f0: 2600, f1: 900, dur: 0.08, vol: 0.12, filter: 'bandpass', q: 2 });
  },
  crit() {
    this.noise({ f0: 4200, f1: 1200, dur: 0.14, vol: 0.18, filter: 'bandpass', q: 3 });
    this.tone({ type: 'square', f0: 900, f1: 1500, dur: 0.08, vol: 0.08 });
  },
  reaction() {
    this.tone({ type: 'sine', f0: 320, f1: 1400, dur: 0.3, vol: 0.16 });
    this.noise({ f0: 3000, f1: 400, dur: 0.35, vol: 0.16, decay: 1.6 });
  },
  hurt() {
    this.tone({ type: 'sawtooth', f0: 260, f1: 110, dur: 0.22, vol: 0.16 });
    this.noise({ f0: 900, f1: 200, dur: 0.2, vol: 0.12 });
  },
  teleport() {
    this.tone({ type: 'sine', f0: 400, f1: 2000, dur: 0.18, vol: 0.1 });
    this.tone({ type: 'sine', f0: 2000, f1: 500, dur: 0.14, vol: 0.06, delay: 0.08 });
  },
  buff() {
    this.tone({ type: 'sine', f0: 440, f1: 880, dur: 0.4, vol: 0.1 });
    this.tone({ type: 'triangle', f0: 660, f1: 1320, dur: 0.42, vol: 0.06, delay: 0.06 });
  },
  heal() {
    this.tone({ type: 'sine', f0: 523, f1: 784, dur: 0.5, vol: 0.12 });
    this.tone({ type: 'sine', f0: 784, f1: 1046, dur: 0.5, vol: 0.09, delay: 0.1 });
    this.tone({ type: 'sine', f0: 1046, f1: 1568, dur: 0.5, vol: 0.06, delay: 0.2 });
  },
  levelUp() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', f0: f, f1: f, dur: 0.34, vol: 0.13, delay: i * 0.085 });
      this.tone({ type: 'sine', f0: f * 2, f1: f * 2, dur: 0.3, vol: 0.05, delay: i * 0.085 });
    });
  },
  pickup() {
    this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.1, vol: 0.1 });
  },
  death() {
    this.tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.9, vol: 0.18 });
    this.noise({ f0: 1200, f1: 100, dur: 0.9, vol: 0.16 });
  },
  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', f0: f, dur: 0.5, vol: 0.12, delay: i * 0.12 });
    });
  },
  jump() {
    this.tone({ type: 'sine', f0: 300, f1: 560, dur: 0.1, vol: 0.05 });
  },
};
