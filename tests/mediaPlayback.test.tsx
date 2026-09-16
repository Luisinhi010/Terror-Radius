import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioEngine } from '../src/hooks/useAudioEngine';
import { createSilentWav } from '../src/utils/mediaCarrier';
import { deferred, installAudioMocks, MockAudioContext, response } from './audioMocks';
import { installMediaMocks } from './mediaMocks';

let media: ReturnType<typeof installMediaMocks>;
let requests: ReturnType<typeof installAudioMocks>;
const props = {
  closeness: 50, mixMode: 'dbd' as const,
  audioUrls: { l1: 'l1', l2: 'l2', l3: 'l3', chase: 'chase' },
  masterVolume: 1, isMuted: false, crossfadeMode: 'equal-power' as const,
  layerOverrides: { l1: 1, l2: 1, l3: 1, chase: 1 },
  smoothPlayStop: true, forsakenSpeed: 'normal' as const,
};
const context = () => MockAudioContext.instances.at(-1)!;
const settle = async () => { await act(async () => { requests.forEach(r => r.result.resolve(response())); }); };
beforeEach(() => { requests = installAudioMocks(); media = installMediaMocks(); });
afterEach(() => { cleanup(); media.restore(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('starts one unmuted silent carrier in the gesture, before context resume finishes', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  expect(media.audios).toHaveLength(0);
  const resume = deferred<void>();
  context().resume.mockImplementationOnce(() => resume.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.play(); });
  expect(media.audios[0].play).toHaveBeenCalledOnce();
  expect(media.audios[0]).toMatchObject({ muted: false, loop: true, volume: 1, playbackRate: 1 });
  expect(context().sources).toHaveLength(0);
  expect(result.current.mediaPlaying).toBe(false);
  await act(async () => { resume.resolve(); await pending; });
  expect(context().sources).toHaveLength(4);
  expect(new Set(context().sources.map(source => source.start.mock.calls[0][0])).size).toBe(1);
  expect(context().sources.every(source => source.start.mock.calls[0][1] === 0)).toBe(true);
  expect(result.current.mediaPlaying).toBe(true);
  await act(async () => { await result.current.play(); });
  expect(media.audios).toHaveLength(1);
  expect(media.audios[0].play).toHaveBeenCalledOnce();
});

it('native pause bypasses smooth fading, rewinds and permits a restart at zero', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  await act(async () => { await result.current.play(); });
  const audio = media.audios[0];
  audio.currentTime = 7;
  act(() => { audio.paused = true; audio.dispatchEvent(new Event('pause')); });
  expect(result.current.isPlaying).toBe(false);
  expect(result.current.mediaPlaying).toBe(false);
  expect(context().sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  expect(audio.currentTime).toBe(0);
  await act(async () => { await result.current.play(); });
  expect(context().sources).toHaveLength(8);
  expect(context().sources.slice(4).every(source => source.start.mock.calls[0][1] === 0)).toBe(true);
  act(() => { audio.dispatchEvent(new Event('pause')); }); // stale queued event
  expect(result.current.isPlaying).toBe(true);
});

it('cancels pending loading/resume on Stop without reviving the carrier or stems', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  const resume = deferred<void>();
  context().resume.mockImplementationOnce(() => resume.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.play(); });
  act(() => result.current.stopImmediately());
  await settle();
  await act(async () => { resume.resolve(); await pending; });
  expect(context().sources).toHaveLength(0);
  expect(media.audios[0].paused).toBe(true);
  expect(result.current.mediaPlaying).toBe(false);
});

it('cancels pending HTML audio play and ignores its stale rejection after a new Play', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  await act(async () => { await result.current.play(); });
  act(() => result.current.stopImmediately());
  const pendingAudio = deferred<void>();
  media.audios[0].play.mockImplementationOnce(() => pendingAudio.promise);
  let first!: Promise<void>;
  act(() => { first = result.current.play(); });
  act(() => result.current.stopImmediately());
  await act(async () => { await result.current.play(); });
  await act(async () => { pendingAudio.reject(new Error('interrupted')); await first; });
  expect(context().sources).toHaveLength(8);
  expect(result.current.mediaPlaying).toBe(true);
  expect(media.audios[0].paused).toBe(false);
  expect(result.current.playbackError).toBeNull();
});

it('stops both paths on a rejected carrier start and lets the user retry', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  await act(async () => { await result.current.play(); });
  act(() => result.current.stopImmediately());
  media.audios[0].play.mockRejectedValueOnce(new Error('not allowed'));
  await act(async () => { await result.current.play(); });
  expect(result.current.isPlaying).toBe(false);
  expect(result.current.playbackError).toContain('Could not start');
  expect(context().sources).toHaveLength(4);
  expect(media.audios[0].paused).toBe(true);
  await act(async () => { await result.current.play(); });
  expect(result.current.mediaPlaying).toBe(true);
});

it('stops on carrier failure and pagehide, but keeps playing while the page is hidden', async () => {
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  await act(async () => { await result.current.play(); });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current.isPlaying).toBe(true);
  act(() => media.audios[0].dispatchEvent(new Event('error')));
  expect(result.current.isPlaying).toBe(false);
  expect(result.current.playbackError).toContain('System audio');
  await act(async () => { await result.current.play(); });
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(result.current.isPlaying).toBe(false);
  expect(context().sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
});

it('keeps one carrier across hot swaps and disposes listeners/blob on unmount', async () => {
  const { result, rerender, unmount } = renderHook(p => useAudioEngine(p), { initialProps: props, reactStrictMode: true });
  await settle();
  await act(async () => { await result.current.play(); });
  rerender({ ...props, audioUrls: { ...props.audioUrls, l1: 'replacement' } });
  await settle();
  expect(context().sources).toHaveLength(8);
  expect(media.audios).toHaveLength(1);
  const audio = media.audios[0], url = audio.src;
  unmount();
  expect(media.revoke).toHaveBeenCalledExactlyOnceWith(url);
  expect(audio.paused).toBe(true);
  expect(audio.src).toBe('');
  audio.dispatchEvent(new Event('pause'));
  audio.dispatchEvent(new Event('error'));
});

it('retires old fading sources before awaiting a restarted Play', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useAudioEngine(props));
  await settle();
  await act(async () => { await result.current.play(); });
  act(() => result.current.stop());
  const resume = deferred<void>();
  context().resume.mockImplementationOnce(() => resume.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.play(); });
  expect(context().sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  await act(async () => { resume.resolve(); await pending; });
  act(() => vi.advanceTimersByTime(1300));
  expect(context().sources.slice(4).every(source => source.stop.mock.calls.length === 0)).toBe(true);
});

it('generates ten seconds of valid zero-valued PCM without bundled audio assets', () => {
  const wav = createSilentWav();
  const header = new DataView(wav);
  expect(wav.byteLength).toBe(160044);
  expect(header.getUint32(4, true)).toBe(wav.byteLength - 8);
  expect(header.getUint32(24, true)).toBe(8000);
  expect(header.getUint32(40, true)).toBe(160000);
  expect(new Uint8Array(wav, 44).every(value => value === 0)).toBe(true);
});
