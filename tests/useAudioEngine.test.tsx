import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioEngine } from '../src/hooks/useAudioEngine';
import type { AudioUrls } from '../src/types';
import { deferred, installAudioMocks, MockAudioContext, response } from './audioMocks';

const urls: AudioUrls = { l1: 'a1', l2: 'a2', l3: 'a3', chase: 'a4' };
const empty: AudioUrls = { l1: '', l2: '', l3: '', chase: '' };
const props = { closeness: 50, mixMode: 'dbd' as const, audioUrls: urls,
  masterVolume: 1, isMuted: false, crossfadeMode: 'linear' as const,
  layerOverrides: { l1: 1, l2: 1, l3: 1, chase: 1 },
  smoothPlayStop: false, forsakenSpeed: 'normal' as const };
let requests: ReturnType<typeof installAudioMocks>;
const ctx = () => MockAudioContext.instances.at(-1)!;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async (indices = requests.map((_, i) => i), ok = true) => {
  await act(async () => { indices.forEach(i => requests[i].result.resolve(response(ok))); });
};

beforeEach(() => { requests = installAudioMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useAudioEngine loading lifecycle', () => {
  it('waits for ALL pending layers when a second layer changes, without redownloading unchanged URLs', async () => {
    const { result, rerender } = renderHook(p => useAudioEngine(p), { initialProps: props });
    await act(async () => { await result.current.play(); });
    rerender({ ...props, audioUrls: { ...urls, l2: 'b2' } });
    expect(requests.map(r => r.url)).toEqual(['a1', 'a2', 'a3', 'a4', 'b2']);
    expect(requests[1].signal.aborted).toBe(true);
    await settle([4]);
    expect(ctx().sources).toHaveLength(0);
    await settle([0, 2, 3]);
    expect(ctx().sources).toHaveLength(4);
    expect(new Set(ctx().sources.map(s => s.start.mock.calls[0][0])).size).toBe(1);
    await settle([1], false);
    expect(result.current.errors).toEqual({});
    expect(ctx().sources).toHaveLength(4);
  });

  it('hot-swaps a whole preset atomically after out-of-order decoding', async () => {
    const { result, rerender } = renderHook(p => useAudioEngine(p), { initialProps: props });
    await settle();
    await act(async () => { await result.current.play(); });
    const oldSources = [...ctx().sources];
    rerender({ ...props, audioUrls: { l1: 'b1', l2: 'b2', l3: 'b3', chase: 'b4' } });
    expect(oldSources.every(s => s.stop.mock.calls.length === 1 && s.disconnect.mock.calls.length === 1)).toBe(true);
    await settle([7, 5, 4]);
    expect(ctx().sources).toHaveLength(4);
    await settle([6]);
    expect(ctx().sources).toHaveLength(8);
    expect(new Set(ctx().sources.slice(4).map(s => s.start.mock.calls[0][0])).size).toBe(1);
  });

  it('clears a removed URL immediately and never restarts its old buffer', async () => {
    const { result, rerender } = renderHook(p => useAudioEngine(p), { initialProps: props });
    await settle();
    await act(async () => { await result.current.play(); });
    const old = ctx().sources[0];
    rerender({ ...props, audioUrls: { ...urls, l1: '' } });
    await flush();
    expect(old.stop).toHaveBeenCalledOnce();
    expect(ctx().sources.slice(4)).toHaveLength(3);
    expect(requests).toHaveLength(4);
    expect(result.current.errors.l1).toBeUndefined();
  });

  it('removes the old source and buffer when replacement fails', async () => {
    const { result, rerender } = renderHook(p => useAudioEngine(p), { initialProps: props });
    await settle();
    await act(async () => { await result.current.play(); });
    rerender({ ...props, audioUrls: { ...urls, l1: 'broken' } });
    await settle([4], false);
    expect(result.current.errors.l1).toBe(true);
    expect(ctx().sources.slice(4)).toHaveLength(3);
  });

  it.each([false, true])('does not start sources after Stop during loading (smooth=%s)', async smoothPlayStop => {
    const { result } = renderHook(() => useAudioEngine({ ...props, smoothPlayStop }));
    await act(async () => { await result.current.play(); });
    act(() => result.current.stop());
    await settle();
    expect(result.current.isPlaying).toBe(false);
    expect(ctx().sources).toHaveLength(0);
  });

  it('ignores a stale decode and keeps the latest loading/error state', async () => {
    const { result, rerender } = renderHook(p => useAudioEngine(p), { initialProps: { ...props, audioUrls: { ...empty, l1: 'old' } } });
    const stale = deferred<AudioBuffer>();
    ctx().decodeAudioData.mockImplementationOnce(() => stale.promise);
    await settle([0]);
    rerender({ ...props, audioUrls: { ...empty, l1: 'new' } });
    await act(async () => { stale.resolve({ duration: 10 } as AudioBuffer); });
    expect(result.current.loadingLayers.l1).toBe(true);
    await settle([1]);
    await act(async () => { await result.current.play(); });
    expect(ctx().sources[0].buffer?.duration).toBe(120);
    expect(result.current.errors).toEqual({});
  });

  it('recovers from StrictMode cleanup/replay and rejects old context work', async () => {
    const { result } = renderHook(() => useAudioEngine(props), { reactStrictMode: true });
    expect(MockAudioContext.instances).toHaveLength(2);
    expect(requests).toHaveLength(8);
    expect(requests.slice(0, 4).every(r => r.signal.aborted)).toBe(true);
    await settle([4, 5, 6, 7]);
    await act(async () => { await result.current.play(); });
    expect(ctx().sources).toHaveLength(4);
    await settle([0, 1, 2, 3], false);
    expect(result.current.errors).toEqual({});
    expect(MockAudioContext.instances[0].sources).toHaveLength(0);
  });

  it('does not duplicate sources after Play → Stop → Play with overlapping resume promises', async () => {
    const { result } = renderHook(() => useAudioEngine(props));
    await settle();
    const first = deferred<void>(), second = deferred<void>();
    ctx().resume.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = result.current.play(); result.current.stop(); b = result.current.play(); });
    await act(async () => { second.resolve(); await b; });
    expect(ctx().sources).toHaveLength(4);
    await act(async () => { first.resolve(); await a; });
    expect(ctx().sources).toHaveLength(4);
    expect(result.current.isPlaying).toBe(true);
  });

  it('keeps Play and Stop idempotent and handles a rejected resume', async () => {
    const { result } = renderHook(() => useAudioEngine(props));
    await settle();
    ctx().resume.mockRejectedValueOnce(new Error('device unavailable'));
    await act(async () => { await result.current.play(); });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.playbackError).toContain('Could not start');
    await act(async () => { await result.current.play(); await result.current.play(); });
    expect(ctx().sources).toHaveLength(4);
    act(() => { result.current.stop(); result.current.stop(); });
    expect(ctx().sources.every(s => s.stop.mock.calls.length === 1)).toBe(true);
  });

  it('cancels a smooth-stop timer when playback restarts', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAudioEngine({ ...props, smoothPlayStop: true }));
    await settle();
    await act(async () => { await result.current.play(); });
    act(() => result.current.stop());
    await act(async () => { await result.current.play(); });
    act(() => vi.advanceTimersByTime(1300));
    expect(ctx().sources.slice(4).every(s => s.stop.mock.calls.length === 0)).toBe(true);
  });

  it('applies gains when Play creates the first context with no initial URLs', async () => {
    const { result } = renderHook(() => useAudioEngine({ ...props, audioUrls: empty, masterVolume: 0.4 }));
    await flush();
    await act(async () => { await result.current.play(); });
    expect(ctx().gains[1].gain.setTargetAtTime).toHaveBeenCalled();
  });

  it('invalidates in-flight loads on real unmount', async () => {
    const { result, unmount } = renderHook(() => useAudioEngine(props));
    await act(async () => { await result.current.play(); });
    const context = ctx();
    unmount();
    await settle();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(0);
  });
});
