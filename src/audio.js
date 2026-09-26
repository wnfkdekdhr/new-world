// Small synthesized soundscape: wind bed, dialogue blips, shard chimes
export class Sound {
  start() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    // wind: filtered noise with slow swells
    const buf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate); const d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = last * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = last * 3; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = 0.25;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 0.12; lfo.connect(lg).connect(g.gain); lfo.start();
    src.connect(f).connect(g).connect(this.master); src.start();
    // soft drone pad
    for (const fr of [110, 164.8, 220]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const og = c.createGain(); og.gain.value = 0.018; o.connect(og).connect(this.master); o.start();
    }
  }
  tone(freq, t0, dur, vol = 0.12, type = 'sine') {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0, c.currentTime + t0);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g).connect(this.master); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  blip() { this.tone(660 + Math.random() * 120, 0, 0.08, 0.03, 'triangle'); }
  click() { this.tone(880, 0, 0.06, 0.05, 'triangle'); }
  chime(n) { const base = [523.25, 587.33, 659.25, 783.99][n % 4]; [1, 1.5, 2].forEach((m, i) => this.tone(base * m, i * 0.09, 1.6, 0.08)); }
  swell() { [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => this.tone(f, i * 0.35, 4.5, 0.07)); }
}
