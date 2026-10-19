export const TRACKS = [
  { id: 'waves', name: '岸边海浪', icon: 'wave', cutoff: 8500 },
  { id: 'wind', name: '轻轻海风', icon: 'wind', cutoff: 3500 },
  { id: 'gulls', name: '远处海鸥', icon: 'bird', cutoff: 3000 },
  { id: 'cafe', name: '小店日常', icon: 'cup', cutoff: 1800 },
];
export const PRESETS = {
  shore: { name: '码头听海', levels: { waves: 65, wind: 18, gulls: 12, cafe: 0 } },
  breeze: { name: '海风散步', levels: { waves: 30, wind: 55, gulls: 9, cafe: 0 } },
  cabin: { name: '窗边小憩', levels: { waves: 25, wind: 10, gulls: 0, cafe: 35 } },
};
const bounded = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
export function cleanMix(value) {
  return {
    levels: Object.fromEntries(TRACKS.map(({ id }) => [id, bounded(value?.levels?.[id], PRESETS.shore.levels[id])])),
    master: bounded(value?.master, 45),
  };
}

// Each recording overlaps its end with its beginning, so a loop has no hard cut.
function seamlessBuffer(context, original) {
  const overlap = Math.min(Math.floor(original.sampleRate * .75), Math.floor(original.length / 5));
  const buffer = context.createBuffer(original.numberOfChannels, original.length - overlap, original.sampleRate);
  let sum = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const input = original.getChannelData(channel), output = buffer.getChannelData(channel);
    output.set(input.subarray(overlap));
    const start = output.length - overlap;
    for (let n = 0; n < overlap; n++) {
      const ratio = n / overlap;
      output[start + n] = input[original.length - overlap + n] * (1 - ratio) + input[n] * ratio;
    }
    for (let n = 0; n < output.length; n += 32) { sum += output[n] ** 2; count++; }
  }
  const rms = Math.sqrt(sum / Math.max(count, 1));
  return { buffer, rms, normalization: Math.min(24, .06 / Math.max(rms, .002)) };
}

export class HarborAudio {
  constructor(mix, onChange = () => {}) {
    const clean = cleanMix(mix);
    this.levels = clean.levels;
    this.master = clean.master;
    this.onChange = onChange;
    this.context = null;
    this.desired = false;
    this.revision = 0;
    this.buffers = new Map();
    this.pending = new Map();
    this.voices = new Map();
    this.errors = new Map();
    this.rainWanted = false;
    this.effectsPlayed = 0;
    this.lastEffect = -10;
  }
  emit() { this.onChange(this.snapshot()); }
  init() {
    if (this.context) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('当前浏览器暂不支持环境音。');
    this.context = new Context();
    this.output = this.context.createGain();
    this.output.gain.value = 0;
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 16;
    limiter.ratio.value = 8;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.output.connect(limiter).connect(this.analyser).connect(this.context.destination);
    this.context.onstatechange = () => this.emit();
  }
  ramp(param, value, duration = .45) {
    const now = this.context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.linearRampToValueAtTime(value, now + duration);
  }
  load(id) {
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    this.errors.delete(id);
    const promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(new URL(`./assets/audio/${id}.mp3`, import.meta.url), { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
        const prepared = seamlessBuffer(this.context, decoded);
        this.buffers.set(id, prepared);
        return prepared;
      } catch (error) {
        this.errors.set(id, '暂未加载，点播放重试');
        return null;
      } finally {
        clearTimeout(timeout);
        this.pending.delete(id);
        this.emit();
      }
    })();
    this.pending.set(id, promise);
    this.emit();
    return promise;
  }
  async syncVoice(id) {
    if (!this.desired || !this.levels[id]) return;
    const prepared = await this.load(id);
    if (!prepared || !this.desired || !this.levels[id]) return;
    if (!this.voices.has(id)) {
      const source = this.context.createBufferSource();
      source.buffer = prepared.buffer;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = TRACKS.find(track => track.id === id).cutoff;
      const gain = this.context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.output);
      source.start();
      this.voices.set(id, { source, gain, normalization: prepared.normalization });
    }
    const voice = this.voices.get(id);
    this.ramp(voice.gain.gain, this.levels[id] / 100 * voice.normalization);
    this.emit();
  }
  async start() {
    const revision = ++this.revision;
    try {
      this.init();
      this.errors.delete('audio');
      this.desired = true;
      // Resume before the first await: this call belongs to the user's gesture.
      const resumed = this.context.resume();
      this.emit();
      await resumed;
      if (!this.desired || revision !== this.revision) return false;
      this.ramp(this.output.gain, this.master / 100, .9);
      this.effect('rain', this.rainWanted);
      await Promise.all(TRACKS.map(({ id }) => this.syncVoice(id)));
      if (!this.desired || revision !== this.revision) return false;
      if (!TRACKS.some(({ id }) => this.levels[id] > 0 && this.voices.has(id))) {
        this.stop();
        return false;
      }
      this.emit();
      return true;
    } catch (error) {
      if (revision === this.revision) {
        this.errors.set('audio', '声音暂未启动，请再点一次播放。');
        this.stop();
      }
      return false;
    }
  }
  stop() {
    this.desired = false;
    const revision = ++this.revision;
    if (this.context) {
      this.ramp(this.output.gain, 0, .65);
      setTimeout(() => {
        if (!this.desired && revision === this.revision && this.context.state === 'running') this.context.suspend();
      }, 750);
    }
    this.emit();
  }
  setLevels(levels) {
    this.levels = cleanMix({ levels, master: this.master }).levels;
    for (const { id } of TRACKS) {
      const voice = this.voices.get(id);
      if (voice) this.ramp(voice.gain.gain, this.levels[id] / 100 * voice.normalization);
      else if (this.desired && this.levels[id]) this.syncVoice(id);
    }
    if (!Object.values(this.levels).some(Boolean)) this.stop();
    else this.emit();
  }
  setMaster(value) {
    this.master = bounded(value, 45);
    if (this.context && this.desired) this.ramp(this.output.gain, this.master / 100, .15);
    this.emit();
  }
  effect(kind, enabled) {
    if (kind === 'rain') this.rainWanted = !!enabled;
    // Scene gestures never initialize or resume sound. They share the explicit player consent and master gain.
    if (!this.context || !this.desired || this.context.state !== 'running') return;
    if (kind === 'rain') {
      if (enabled && !this.rainVoice) {
        const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * .18;
        const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
        const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2800;
        const gain = this.context.createGain(); gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(this.output); source.start();
        this.rainVoice = { source, gain };
      }
      if (this.rainVoice) this.ramp(this.rainVoice.gain.gain, enabled ? .42 : 0, 1);
      return;
    }
    if (!this.master || this.context.currentTime - this.lastEffect < .16) return;
    this.lastEffect = this.context.currentTime; this.effectsPlayed++;
    const now = this.context.currentTime, duration = kind === 'horn' ? .75 : .24;
    for (const frequency of kind === 'horn' ? [174, 261] : [480]) {
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now);
      if (kind !== 'horn') oscillator.frequency.exponentialRampToValueAtTime(140, now + duration);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(kind === 'horn' ? .04 : .055, now + .035);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.connect(gain).connect(this.output); oscillator.start(now); oscillator.stop(now + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
  snapshot() {
    const loaded = [...this.voices.keys()].filter(id => this.levels[id] > 0);
    return {
      levels: { ...this.levels }, master: this.master, desired: this.desired,
      playing: this.desired && this.context?.state === 'running' && loaded.length > 0 && this.master > 0,
      context: this.context?.state || 'uninitialized', loaded,
      loading: [...this.pending.keys()].filter(id => this.levels[id] > 0),
      errors: Object.fromEntries([...this.errors].filter(([id]) => id === 'audio' || this.levels[id] > 0)),
    };
  }
  inspect() {
    const samples = new Float32Array(256);
    this.analyser?.getFloatTimeDomainData(samples);
    return { ...this.snapshot(), outputRms: Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length),
      buffers: Object.fromEntries([...this.buffers].map(([id, value]) => [id, { duration: value.buffer.duration, rms: value.rms }])),
      voices: this.voices.size, masterGain: this.output?.gain.value || 0,
      effectsPlayed: this.effectsPlayed, rainWanted: this.rainWanted, rainGain: this.rainVoice?.gain.gain.value || 0 };
  }
}
