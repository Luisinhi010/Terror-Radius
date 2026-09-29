import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMediaSession } from '../src/hooks/useMediaSession';
import App from '../src/App';
import { installAudioMocks, MockAudioContext, response } from './audioMocks';
import { installMediaMocks } from './mediaMocks';

vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => null }));
let media: ReturnType<typeof installMediaMocks>;
const props = () => ({
  title: 'CURTAINS_CALL', isPlaying: true, closeness: 50,
  volumes: { l1: 0.71, l2: 0.71, l3: 0, chase: 0 },
  play: vi.fn(async () => {}), stop: vi.fn(), seek: vi.fn(),
});
beforeEach(() => { media = installMediaMocks(); });
afterEach(() => { cleanup(); media.restore(); vi.unstubAllGlobals(); localStorage.clear(); });

it('shows song/layer metadata and proximity with the validated nearly-zero rate', () => {
  const initial = props();
  const { rerender } = renderHook(p => useMediaSession(p), { initialProps: initial });
  expect(media.session.metadata).toMatchObject({ title: 'CURTAINS_CALL', artist: 'Layer 1 + Layer 2 · 50%', album: 'Terror Radius' });
  expect(media.session.setPositionState).toHaveBeenLastCalledWith({ duration: 100, position: 50, playbackRate: 0.000001 });
  expect(media.session.playbackState).toBe('playing');
  rerender({ ...initial, title: 'No Virus', closeness: 100, volumes: { l1: 0, l2: 0, l3: 0, chase: 1 } });
  expect(media.session.metadata).toMatchObject({ title: 'No Virus', artist: 'Chase · 100%' });
  expect(media.session.setPositionState).toHaveBeenLastCalledWith({ duration: 100, position: 100, playbackRate: 0.000001 });
  rerender({ ...initial, closeness: 0, isPlaying: false, volumes: { l1: 0, l2: 0, l3: 0, chase: 0 } });
  expect(media.session.metadata?.artist).toBe('Safe · 0%');
  expect(media.session.playbackState).toBe('paused');
});

it('routes media Play/Pause/Stop to the current callbacks after a rerender', async () => {
  const initial = props(), next = props();
  const { rerender } = renderHook(p => useMediaSession(p), { initialProps: initial });
  rerender(next);
  await act(async () => media.action('play'));
  act(() => { media.action('pause'); media.action('stop'); });
  expect(next.play).toHaveBeenCalledOnce();
  expect(next.stop).toHaveBeenCalledTimes(2);
  expect(initial.play).not.toHaveBeenCalled();
  expect(media.session.setActionHandler).toHaveBeenCalledTimes(6);
});

it('clamps seeks, ignores invalid values and accumulates relative hardware seeks', () => {
  const initial = props();
  renderHook(() => useMediaSession(initial));
  act(() => {
    media.action('seekto', { seekTime: -5 });
    media.action('seekforward');
    media.action('seekforward', { seekOffset: 15 });
    media.action('seekbackward', { seekOffset: 5 });
    media.action('seekto', { seekTime: 150 });
    media.action('seekto', { seekTime: NaN });
    media.action('seekto', { seekTime: Infinity });
    media.action('seekto');
  });
  expect(initial.seek.mock.calls.map(call => call[0])).toEqual([0, 10, 25, 20, 100]);
});

it('does not resend position for sub-percent animation changes or elapsed time', () => {
  vi.useFakeTimers();
  try {
    const initial = props();
    const { rerender } = renderHook(p => useMediaSession(p), { initialProps: initial });
    media.session.setPositionState.mockClear();
    rerender({ ...initial, closeness: 50.1 });
    act(() => vi.advanceTimersByTime(60000));
    expect(media.session.setPositionState).not.toHaveBeenCalled();
    rerender({ ...initial, closeness: 51 });
    expect(media.session.setPositionState).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('tolerates missing metadata, rejected actions/position and cleans up under StrictMode', () => {
  vi.stubGlobal('MediaMetadata', undefined);
  const original = media.session.setActionHandler.getMockImplementation()!;
  media.session.setActionHandler.mockImplementation((action, handler) => {
    if (action === 'seekto') throw new Error('unsupported');
    original(action, handler);
  });
  media.session.setPositionState.mockImplementation(() => { throw new Error('unsupported'); });
  const initial = props();
  const { unmount } = renderHook(() => useMediaSession(initial), { reactStrictMode: true });
  act(() => media.action('pause'));
  expect(initial.stop).toHaveBeenCalledOnce();
  expect(media.handlers.has('play')).toBe(true);
  unmount();
  expect(media.handlers.size).toBe(0);
  expect(media.session.metadata).toBeNull();
  expect(media.session.playbackState).toBe('none');
});

it('is a no-op when Media Session is absent', () => {
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: undefined });
  expect(() => renderHook(() => useMediaSession(props()))).not.toThrow();
  expect(media.session.setActionHandler).not.toHaveBeenCalled();
});

it('integrates native seeking with both UIs and headset restart', async () => {
  const requests = installAudioMocks();
  localStorage.setItem('tr_smooth_play', 'true');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  render(<App />, { reactStrictMode: true });
  fireEvent.click(screen.getByRole('button', { name: 'No Virus' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dead by Daylight' }));
  await act(async () => { requests.forEach(request => request.result.resolve(response())); });
  await act(async () => { fireEvent.click(screen.getByTitle(/Play \/ Pause/)); });
  expect(media.session.playbackState).toBe('playing');
  expect(media.session.metadata?.title).toBe('No Virus');
  act(() => media.action('seekto', { seekTime: 50 }));
  expect(screen.getByTitle(/fine adjust/)).toHaveProperty('value', '50');
  expect(screen.getByText('50%', { selector: 'div' })).toBeTruthy();
  expect(media.session.metadata?.artist).toBe('Layer 1 + Layer 2 · 50%');
  // The same handler continues to work when the app switches to its compact UI.
  fireEvent.keyDown(document.body, { code: 'KeyM', ctrlKey: true });
  act(() => media.action('seekto', { seekTime: 75 }));
  expect(screen.getAllByRole('slider')[0]).toHaveProperty('value', '75');
  const context = MockAudioContext.instances.at(-1)!;
  const beforeStop = [...context.sources];
  act(() => media.action('pause'));
  expect(beforeStop.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  expect(media.audios[0].paused).toBe(true);
  await act(async () => media.action('play'));
  expect(context.sources.slice(beforeStop.length)).toHaveLength(4);
  expect(context.sources.slice(beforeStop.length).every(source => source.start.mock.calls[0][1] === 0)).toBe(true);
  expect(media.session.playbackState).toBe('playing');
  expect(media.session.setPositionState).toHaveBeenLastCalledWith({ duration: 100, position: 75, playbackRate: 0.000001 });
});
