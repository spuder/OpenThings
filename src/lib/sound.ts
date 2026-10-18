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

/** Task complete: a quick, bright two-note chime. */
export function playComplete() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, 1318.5, t, 0.18, 0.14); // E6
  tone(ac, 1760, t + 0.07, 0.32, 0.12); // A6
  tone(ac, 3520, t + 0.07, 0.12, 0.025, 'triangle');
}

/** Un-complete: a single soft lower note. */
export function playUncheck() {
  const ac = audio();
  if (!ac) return;
  tone(ac, 659.3, ac.currentTime, 0.12, 0.08);
}

/** Habit check-in: a warmer three-note rise. */
export function playHabit() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  [523.3, 659.3, 784].forEach((f, i) => tone(ac, f, t + i * 0.06, 0.28, 0.11));
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

/** Pomodoro finished: three gentle bells. */
export function playBell() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  for (let i = 0; i < 3; i++) {
    tone(ac, 880, t + i * 0.45, 0.9, 0.12);
    tone(ac, 1760, t + i * 0.45, 0.5, 0.03, 'triangle');
  }
}
