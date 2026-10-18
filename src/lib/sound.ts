/** Synthesized UI sounds (Web Audio) — no audio files to ship. */
let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('openthings.muted') === '1';
} catch {
  /* storage unavailable */
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('openthings.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.18, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

let reverb: ConvolverNode | null = null;

/** A short synthetic room so chimes ring instead of clicking off. */
function room(ac: AudioContext): AudioNode {
  if (!reverb) {
    const len = Math.floor(ac.sampleRate * 1.6);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb = ac.createConvolver();
    reverb.buffer = ir;
    const wet = ac.createGain();
    wet.gain.value = 0.28;
    reverb.connect(wet).connect(ac.destination);
  }
  return reverb;
}

/**
 * One struck bell: a fundamental plus inharmonic partials (ratios typical of a small bell),
 * each with its own decay — higher partials die faster, which is what makes it read as a chime.
 */
function bell(ac: AudioContext, freq: number, start: number, gain: number, decay = 1.6) {
  const partials: [number, number, number][] = [
    // [ratio, relative level, decay multiplier]
    [1, 1, 1],
    [2.0, 0.42, 0.7],
    [2.76, 0.32, 0.55],
    [5.4, 0.14, 0.32],
    [8.93, 0.06, 0.2],
  ];
  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(ac.destination);
  out.connect(room(ac));
  for (const [ratio, level, dm] of partials) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const d = decay * dm;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + d + 0.05);
  }
}

/** Task complete: a two-note rising chime (G5 then C6 + E6) that rings out. */
export function playComplete() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  bell(ac, 783.99, t, 0.17, 1.3);
  bell(ac, 1046.5, t + 0.11, 0.16, 1.9);
  bell(ac, 1318.5, t + 0.11, 0.07, 1.6);
}

/** Un-complete: a single soft lower note. */
export function playUncheck() {
  const ac = audio();
  if (!ac) return;
  tone(ac, 659.3, ac.currentTime, 0.12, 0.08);
}

/** Habit check-in: a warmer three-note arpeggio of bells. */
export function playHabit() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  [523.25, 659.25, 783.99].forEach((f, i) => bell(ac, f, t + i * 0.08, 0.16, 1.4 + i * 0.2));
}

/** Brain dump check: a short pencil scratch (filtered noise). */
export function playScratch() {
  const ac = audio();
  if (!ac) return;
  const len = 0.16;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = Math.sin((Math.PI * i) / data.length);
    data[i] = (Math.random() * 2 - 1) * env * (0.6 + 0.4 * Math.sin(i / 90));
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.value = 0.22;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start();
}

/** Pomodoro finished: three slow, low bells. */
export function playBell() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  for (let i = 0; i < 3; i++) bell(ac, 587.33, t + i * 0.7, 0.24, 2.4);
}

/** Reminder: two descending bells, distinct from the completion chime. */
export function playReminder() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  bell(ac, 1174.66, t, 0.18, 1.4);
  bell(ac, 880, t + 0.22, 0.2, 2.0);
}
