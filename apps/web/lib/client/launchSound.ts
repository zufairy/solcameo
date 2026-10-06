/**
 * Launch celebration sound, synthesised with Web Audio so it needs no asset.
 * Browsers only let audio start after a user gesture, so call `unlockLaunchAudio`
 * from a click/tap early in the flow; `playLaunchSound` can then fire later,
 * after wallet approvals and network waits.
 */
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { ctx ??= new Ctor(); } catch { return null; }
  return ctx;
}

export function unlockLaunchAudio() {
  const c = audio();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

export function playLaunchSound() {
  const c = audio();
  if (!c) return;
  void c.resume().catch(() => undefined);
  const t0 = c.currentTime + 0.03;
  const master = c.createGain();
  master.gain.value = 0.3;
  const limiter = c.createDynamicsCompressor();
  master.connect(limiter).connect(c.destination);

  // Two confetti-cannon pops: a filtered noise burst over a short low thump.
  const noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  for (const offset of [0, 0.07]) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const hp = c.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 900;
    const g = c.createGain();
    g.gain.value = 0.8;
    src.connect(hp).connect(g).connect(master);
    src.start(t0 + offset);
    const thump = c.createOscillator(), tg = c.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(130, t0 + offset);
    thump.frequency.exponentialRampToValueAtTime(40, t0 + offset + 0.22);
    tg.gain.setValueAtTime(0.9, t0 + offset);
    tg.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.26);
    thump.connect(tg).connect(master);
    thump.start(t0 + offset); thump.stop(t0 + offset + 0.3);
  }

  // A bright rising arpeggio (C major) that rings out.
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
    const start = t0 + 0.14 + i * 0.085;
    for (const [type, level] of [["triangle", 0.5], ["sine", 0.35]] as const) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(level, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      o.connect(g).connect(master);
      o.start(start); o.stop(start + 1.2);
    }
  });

  // Soft sparkle while the confetti rains down.
  for (let i = 0; i < 14; i++) {
    const start = t0 + 0.7 + Math.random() * 1.8;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = 2200 + Math.random() * 2400;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.07, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    o.connect(g).connect(master);
    o.start(start); o.stop(start + 0.3);
  }
}
