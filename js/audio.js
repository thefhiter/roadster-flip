// Synthesised sound: electric-motor whine, cold-gas hiss, wind, and one-shot
// cues. Nothing is loaded; everything is built from oscillators and noise.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('roadster.muted') === '1'; } catch { /* storage blocked */ }
  }

  // Browsers only allow audio after a user gesture.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;

    // motor: two detuned oscillators through a lowpass
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter(); this.motorFilter.type = 'lowpass'; this.motorFilter.frequency.value = 1800;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'triangle';
    this.osc1.connect(this.motorFilter); this.osc2.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.osc1.start(); this.osc2.start();

    const loopNoise = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return { f, g };
    };
    this.hiss = loopNoise('bandpass', 2400, 0.7);
    this.wind = loopNoise('lowpass', 500, 0.5);
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('roadster.muted', m ? '1' : '0'); } catch { /* storage blocked */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  // Called every frame with the car state.
  update({ speed = 0, throttle = 0, jets = 0, air = false, active = true }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.06;
    const f = 90 + speed * 26 + throttle * 30;
    this.osc1.frequency.setTargetAtTime(f, t, k);
    this.osc2.frequency.setTargetAtTime(f * 2.01, t, k);
    this.motorFilter.frequency.setTargetAtTime(700 + speed * 60, t, k);
    const mg = active ? Math.min(0.09, 0.012 + throttle * 0.05 + speed * 0.0012) * (air ? 0.35 : 1) : 0;
    this.motorGain.gain.setTargetAtTime(mg, t, 0.08);
    this.hiss.g.gain.setTargetAtTime(active ? jets * 0.22 : 0, t, 0.03);
    this.hiss.f.frequency.setTargetAtTime(1800 + jets * 1400, t, 0.05);
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.18, speed * speed * 0.00012) : 0, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + speed * 18, t, 0.1);
  }

  burst(dur, freq, gain, type = 'lowpass') {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain, type = 'sine', delay = 0, slideTo) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, strength = 1) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'release': this.burst(0.35, 3000, 0.25, 'highpass'); this.tone(420, 0.18, 0.08, 'sine', 0, 220); break;
      case 'land':
        this.tone(140, 0.35, 0.5 * Math.min(1.4, strength), 'sine', 0, 40);
        this.burst(0.3, 900, 0.25 * strength);
        break;
      case 'crash':
        this.burst(1.1, 2600, 0.7);
        this.tone(95, 0.6, 0.5, 'square', 0, 30);
        this.tone(1250, 0.25, 0.06, 'square', 0.03, 600);
        break;
      case 'impact': this.burst(0.25, 1400, 0.25 * Math.min(2, strength)); break;
      case 'clear': this.tone(660 + strength * 70, 0.12, 0.06, 'triangle'); break;
      case 'success':
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 0.5, 0.09, 'triangle', i * 0.09));
        break;
      case 'tick': this.tone(1200, 0.05, 0.03, 'square'); break;
      case 'flip': this.tone(880, 0.12, 0.05, 'sine', 0, 1320); break;
    }
  }
}
