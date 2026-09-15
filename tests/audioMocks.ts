import { vi } from 'vitest';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class MockAudioContext {
  static instances: MockAudioContext[] = [];
  currentTime = 12;
  state = 'running';
  destination = {};
  sources: ReturnType<MockAudioContext['createBufferSource']>[] = [];
  gains: ReturnType<MockAudioContext['createGain']>[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async () => ({ duration: 120 } as AudioBuffer));

  constructor() { MockAudioContext.instances.push(this); }

  createGain() {
    const gain = {
      gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    };
    this.gains.push(gain);
    return gain;
  }
  createAnalyser() {
    return { fftSize: 512, frequencyBinCount: 256, smoothingTimeConstant: 0,
      connect: vi.fn(), getByteFrequencyData: vi.fn(), getByteTimeDomainData: vi.fn() };
  }
  createBufferSource() {
    const source = { buffer: null as AudioBuffer | null, loop: false,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source;
  }
}

export function response(ok = true) {
  return { ok, status: ok ? 200 : 404, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
}

export function installAudioMocks() {
  MockAudioContext.instances = [];
  vi.stubGlobal('AudioContext', MockAudioContext);
  const requests: { url: string; signal: AbortSignal; result: ReturnType<typeof deferred<Response>> }[] = [];
  // Deliberately don't auto-reject on abort: stale continuations must still be
  // harmless if a response/decode has already escaped fetch cancellation.
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    const result = deferred<Response>();
    requests.push({ url: String(url), signal: options.signal, result });
    return result.promise;
  }));
  return requests;
}
