import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Just enough of the Web Audio API for sound.ts: nodes chain, sources end when told to. */
class FakeContext {
  static all: FakeContext[] = [];
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  sources: { onended: (() => void) | null }[] = [];
  suspend = vi.fn(async () => void (this.state = 'suspended'));
  resume = vi.fn(async () => void (this.state = 'running'));
  close = vi.fn(async () => void (this.state = 'closed'));
  constructor() {
    FakeContext.all.push(this);
  }
  private node(): any {
    const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain: param, frequency: param, Q: param, connect: (n: unknown) => n, start() {}, stop() {}, onended: null };
  }
  private source() {
    const n = this.node();
    this.sources.push(n);
    return n;
  }
  createOscillator = () => this.source();
  createBufferSource = () => this.source();
  createGain = () => this.node();
  createBiquadFilter = () => this.node();
  createConvolver = () => this.node();
  createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  /** Fire `onended` on every source started so far. */
  endAll() {
    for (const s of this.sources.splice(0)) s.onended?.();
  }
}

let sound: typeof import('./sound');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeContext.all = [];
  vi.stubGlobal('AudioContext', FakeContext);
  sound = await import('./sound');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('idle suspend', () => {
  it('suspends the context once every sound has ended and the reverb tail has passed', () => {
    sound.playComplete();
    const ac = FakeContext.all[0];
    expect(ac.sources.length).toBeGreaterThan(0);

    vi.advanceTimersByTime(10_000);
    expect(ac.suspend).not.toHaveBeenCalled(); // still ringing

    ac.endAll();
    vi.advanceTimersByTime(1_999);
    expect(ac.suspend).not.toHaveBeenCalled(); // reverb tail
    vi.advanceTimersByTime(1);
    expect(ac.suspend).toHaveBeenCalledOnce();
  });

  it('a new sound during the tail cancels the pending suspend', () => {
    sound.playUncheck();
    const ac = FakeContext.all[0];
    ac.endAll();
    vi.advanceTimersByTime(1_000);
    sound.playUncheck();
    vi.advanceTimersByTime(5_000);
    expect(ac.suspend).not.toHaveBeenCalled();
    ac.endAll();
    vi.advanceTimersByTime(2_000);
    expect(ac.suspend).toHaveBeenCalledOnce();
  });

  it('resumes the same context for the next sound after suspending', async () => {
    sound.playUncheck();
    const ac = FakeContext.all[0];
    ac.endAll();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ac.state).toBe('suspended');

    sound.playUncheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(ac.resume).toHaveBeenCalled();
    expect(ac.state).toBe('running');
    expect(FakeContext.all).toHaveLength(1);
  });

  it('plays nothing and opens no context when muted', () => {
    sound.setMuted(true);
    sound.playBell();
    expect(FakeContext.all).toHaveLength(0);
  });
});
