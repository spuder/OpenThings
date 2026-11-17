/** Synthesized UI sounds (Web Audio) — no audio files to ship. */
let ctx: AudioContext | null = null;
let muted = false;
let reverb: ConvolverNode | null = null;

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

function fresh(): AudioContext | null {
  try {
    void ctx?.close().catch(() => {});
  } catch {
    /* already closed */
  }
  reverb = null; // nodes belong to one context
  playing = 0;
  clearTimeout(idleTimer);
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * A running context keeps an output stream open and feeds silence to the audio server for as long
 * as it lives (a constant CPU cost on Linux / PipeWire). So once every source has ended and the
 * reverb tail has died away, the context is suspended; `play()` resumes it for the next sound.
 */
const TAIL_MS = 2000; // the reverb impulse in room() is 1.6 s
let playing = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function track(ac: AudioContext, src: AudioScheduledSourceNode) {
  playing++;
  clearTimeout(idleTimer);
  src.onended = () => {
    if (ctx !== ac || --playing > 0) return; // a replaced context's sources don't count
    idleTimer = setTimeout(() => {
      if (ctx !== ac || playing > 0 || ac.state !== 'running') return;
      // A sound that starts while the suspend is in flight would otherwise be silenced.
      ac.suspend().then(
        () => void (ctx === ac && playing > 0 && ac.resume().catch(() => {})),
        () => {},
      );
    }, TAIL_MS);
  };
}

/** Set when a resume didn't take: the next sound starts from a new context. */
let stale = false;

/** Resolves true if `ac` is running within `ms`; a hung `resume()` counts as failed. */
function wake(ac: AudioContext, ms = 300): Promise<boolean> {
  return Promise.race([
    ac.resume().then(
      () => ac.state === 'running',
      () => false,
    ),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

/**
 * Run `fn` once the context can make sound. WebKit (the macOS and iOS shells, Safari) can leave a
 * long-lived context 'suspended' or 'interrupted' after sleep or an output-device change, and
 * `resume()` may never take; then a new context replaces it. The swap happens here, synchronously,
 * when possible, so it stays inside the click that asked for the sound (autoplay rules).
 * `fn` reads `currentTime` itself, so a late start is fine.
 */
function play(fn: (ac: AudioContext) => void) {
  if (muted) return;
  const state = ctx?.state as string | undefined;
  const ac = !ctx || stale || state === 'closed' || state === 'interrupted' ? fresh() : ctx;
  stale = false;
  if (!ac) return;
  if (ac.state === 'running') return fn(ac);
  void wake(ac).then(async (ok) => {
    if (ok) return fn(ac);
    if (ctx !== ac) return; // another sound already replaced it
    stale = true;
    const next = fresh();
    if (next && (next.state === 'running' || (await wake(next)))) {
      stale = false;
      fn(next);
    }
  });
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
  track(ac, osc);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

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
    track(ac, osc);
    osc.start(start);
    osc.stop(start + d + 0.05);
  }
}

/** Task complete: a two-note rising chime (G5 then C6 + E6) that rings out. */
export function playComplete() {
  play((ac) => {
    const t = ac.currentTime + 0.01;
    bell(ac, 783.99, t, 0.17, 1.3);
    bell(ac, 1046.5, t + 0.11, 0.16, 1.9);
    bell(ac, 1318.5, t + 0.11, 0.07, 1.6);
  });
}

/** Un-complete: a single soft lower note. */
export function playUncheck() {
  play((ac) => {
    tone(ac, 659.3, ac.currentTime, 0.12, 0.08);
  });
}

/** Habit check-in: a warmer three-note arpeggio of bells. */
export function playHabit() {
  play((ac) => {
    const t = ac.currentTime + 0.01;
    [523.25, 659.25, 783.99].forEach((f, i) => bell(ac, f, t + i * 0.08, 0.16, 1.4 + i * 0.2));
  });
}

/** Brain dump check: a short pencil scratch (filtered noise). */
export function playScratch() {
  play((ac) => {
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
    track(ac, src);
    src.start();
  });
}

/**
 * Move to Trash: paper crumpled into a ball. Many tiny noise crackles, densest at the start and
 * thinning out, through a band-pass so it reads as crinkling rather than hiss.
 */
export function playCrumple() {
  play((ac) => {
    const len = 0.32;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let k = 0; k < 70; k++) {
      // Square the random offset so crackles bunch up early, like the first squeeze of the ball.
      const at = Math.floor(Math.random() ** 2 * data.length * 0.85);
      const dur = Math.floor(ac.sampleRate * (0.002 + Math.random() * 0.007));
      const amp = (0.3 + Math.random() * 0.7) * (1 - at / data.length);
      for (let i = 0; i < dur && at + i < data.length; i++) data[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-5 * i) / dur);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.value = 0.3;
    src.connect(bp).connect(g).connect(ac.destination);
    track(ac, src);
    src.start();
  });
}

/** Pomodoro finished: three slow, low bells. */
export function playBell() {
  play((ac) => {
    const t = ac.currentTime + 0.01;
    for (let i = 0; i < 3; i++) bell(ac, 587.33, t + i * 0.7, 0.24, 2.4);
  });
}

/** Reminder: two descending bells, distinct from the completion chime. */
export function playReminder() {
  play((ac) => {
    const t = ac.currentTime + 0.01;
    bell(ac, 1174.66, t, 0.18, 1.4);
    bell(ac, 880, t + 0.22, 0.2, 2.0);
  });
}
