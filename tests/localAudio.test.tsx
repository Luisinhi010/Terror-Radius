import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalAudioUrl, portableAudioUrls, portablePresets } from '../src/utils/localAudio';
import { usePersistedState } from '../src/hooks/usePersistedState';
import { useLocalAudioSources } from '../src/hooks/useLocalAudioSources';
import { pickWebAudio, useFilePicker } from '../src/hooks/useFilePicker';
import { LayerCard } from '../src/components/LayerCard';
import { LAYERS } from '../src/constants';
import type { AudioUrls, Preset } from '../src/types';
import { deferred } from './audioMocks';

const native = vi.hoisted(() => ({ open: vi.fn(), convert: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: native.convert }));
const empty: AudioUrls = { l1: '', l2: '', l3: '', chase: '' };
const local = { url: 'blob:audio-one', filename: 'Layer 1.ogg', isBlob: true };
const audioFile = () => new File(['audio'], 'test.ogg', { type: 'audio/ogg' });
const input = () => document.querySelector('input[type=file]') as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('URL', URL);
  URL.createObjectURL = vi.fn(() => local.url);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('portable config', () => {
  it.each(['blob:example', 'asset://localhost/file.ogg', 'http://asset.localhost/file.ogg',
    'https://asset.localhost/file.ogg', 'file:///tmp/a.ogg', 'content://audio/42'])('recognizes a session-only source: %s', url => {
    expect(isLocalAudioUrl(url)).toBe(true);
    expect(portableAudioUrls({ ...empty, l1: url }).l1).toBe('');
  });
  it('preserves remote/relative URLs while removing local ones', () => {
    expect(portableAudioUrls({ l1: '/audio/a.ogg', l2: 'https://example.com/a.ogg', l3: local.url, chase: '' }))
      .toEqual({ l1: '/audio/a.ogg', l2: 'https://example.com/a.ogg', l3: '', chase: '' });
  });
  it('filters malformed presets, null URLs and invalid mix modes safely', () => {
    expect(portablePresets([null, { id: '1', name: 'a', urls: null },
      { id: '2', name: 'b', urls: empty, defaultMixMode: 'wrong' }])).toEqual([]);
    expect(portablePresets([])).toEqual([]);
  });
  it('keeps session audio in React state but not localStorage, including favorites', () => {
    const { result } = renderHook(() => {
      const [urls, setUrls] = usePersistedState('urls', empty, portableAudioUrls);
      const [presets, setPresets] = usePersistedState<Preset[]>('favorites', [], portablePresets);
      return { urls, setUrls, presets, setPresets };
    });
    const sessionUrls = { ...empty, l1: local.url };
    act(() => {
      result.current.setUrls(sessionUrls);
      result.current.setPresets([{ id: 'local', name: 'My mix', urls: sessionUrls }]);
    });
    expect(result.current.urls.l1).toBe(local.url);
    expect(result.current.presets[0].urls.l1).toBe(local.url);
    expect(JSON.parse(localStorage.getItem('urls')!).l1).toBe('');
    expect(JSON.parse(localStorage.getItem('favorites')!)[0].urls.l1).toBe('');
  });
  it('migrates broken references saved by an older version on startup', () => {
    localStorage.setItem('urls', JSON.stringify({ ...empty, l1: local.url }));
    const { result } = renderHook(() => usePersistedState('urls', empty, portableAudioUrls));
    expect(result.current[0]).toEqual(empty);
  });
});

describe('local source ownership', () => {
  function useSources() {
    const [urls, setUrls] = useState(empty);
    const [favorites, setFavorites] = useState<Preset[]>([]);
    const sources = useLocalAudioSources(urls, favorites, (layer, url) => setUrls(prev => ({ ...prev, [layer]: url })));
    return { ...sources, urls, setUrls, favorites, setFavorites };
  }
  it('releases blobs when a remote preset replaces them', () => {
    const { result } = renderHook(useSources);
    act(() => result.current.selectFile('l1', local));
    expect(result.current.files[local.url]).toEqual(local);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    act(() => result.current.setUrls({ ...empty, l1: 'https://example.com/new.ogg' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(local.url);
    expect(result.current.files[local.url]).toBeUndefined();
  });
  it('retains files referenced by a session favorite until that favorite is removed', () => {
    const { result } = renderHook(useSources);
    act(() => result.current.selectFile('l1', local));
    act(() => result.current.setFavorites([{ id: 'fav', name: 'Local', urls: result.current.urls }]));
    act(() => result.current.setUrls(empty));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(result.current.files[local.url].filename).toBe(local.filename);
    act(() => result.current.setFavorites([]));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(local.url);
  });
  it('revokes blobs on real App unmount but never revokes native paths as blobs', () => {
    const { result, unmount } = renderHook(useSources);
    act(() => {
      result.current.selectFile('l1', local);
      result.current.selectFile('l2', { url: 'http://asset.localhost/a', filename: 'native.ogg', isBlob: false });
    });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(local.url);
  });
});

describe('file picker cleanup and native paths', () => {
  it('removes the hidden input and creates no blob on Cancel', async () => {
    const pending = pickWebAudio(new AbortController().signal);
    expect(input()).not.toBeNull();
    fireEvent(input(), new Event('cancel'));
    expect(await pending).toBeNull();
    expect(input()).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('removes the input on abort/unmount', async () => {
    const controller = new AbortController();
    const pending = pickWebAudio(controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect(input()).toBeNull();
  });
  it('returns the filename and blob and permits selecting the same file again', async () => {
    for (let n = 0; n < 2; n++) {
      const pending = pickWebAudio(new AbortController().signal);
      fireEvent.change(input(), { target: { files: [audioFile()] } });
      expect(await pending).toEqual({ ...local, filename: 'test.ogg' });
      expect(input()).toBeNull();
    }
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
  it('cancels a pending web selection when its layer URL changes', async () => {
    const onPick = vi.fn();
    const { result, rerender } = renderHook(({ url }) => useFilePicker(onPick, url), { initialProps: { url: '' } });
    let promise!: Promise<void>;
    act(() => { promise = result.current.pick(); });
    rerender({ url: 'https://example.com/preset.ogg' });
    await act(async () => { await promise; });
    expect(onPick).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(result.current.isPicking).toBe(false);
  });
  it('keeps Windows asset.localhost results marked as local files', async () => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    native.open.mockResolvedValue('C:\\Music\\L1.ogg');
    native.convert.mockReturnValue('http://asset.localhost/C%3A%5CMusic%5CL1.ogg');
    const onPick = vi.fn();
    const { result } = renderHook(() => useFilePicker(onPick, ''));
    await act(async () => { await result.current.pick(); });
    expect(onPick).toHaveBeenCalledWith({ filename: 'L1.ogg', isBlob: false,
      url: 'http://asset.localhost/C%3A%5CMusic%5CL1.ogg' });
    expect(isLocalAudioUrl(onPick.mock.calls[0][0].url)).toBe(true);
  });
  it('discards a native dialog result after unmount', async () => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    const selection = deferred<string>();
    native.open.mockReturnValue(selection.promise);
    const onPick = vi.fn();
    const { result, unmount } = renderHook(() => useFilePicker(onPick, ''));
    let promise!: Promise<void>;
    await act(async () => { promise = result.current.pick(); await Promise.resolve(); });
    unmount();
    await act(async () => { selection.resolve('/audio/a.ogg'); await promise; });
    expect(onPick).not.toHaveBeenCalled();
  });
  it('shows a visible error when a native dialog fails', async () => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    native.open.mockRejectedValue(new Error('dialog unavailable'));
    const { result } = renderHook(() => useFilePicker(vi.fn(), ''));
    await act(async () => { await result.current.pick(); });
    expect(result.current.pickerError).toContain('Could not open');
    expect(result.current.isPicking).toBe(false);
  });
});

describe('uploaded LayerCard UI', () => {
  const cardProps = { config: LAYERS[0], mixMode: 'dbd' as const, volume: 0.7,
    url: '', onUrlChange: vi.fn(), hasError: false, analyser: null,
    isLoading: false, isLayerMuted: false, isLayerSoloed: false, onMute: vi.fn(), onSolo: vi.fn(),
    showWaveform: true, isPlaying: false, localFile: null, onFilePick: vi.fn() };
  it('keeps the uploaded card layout, local badge, filename and remove button', () => {
    const { container } = render(<LayerCard {...cardProps} url={local.url} localFile={local} />);
    expect(container.firstElementChild?.className).toContain('p-5 rounded-lg border');
    expect(screen.getAllByText('Layer 1.ogg')).toHaveLength(2);
    expect(screen.getByText('session only')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove local file'));
    expect(cardProps.onUrlChange).toHaveBeenCalledWith('');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // Ownership remains in App.
  });
  it('keeps metadata on card remount, as used by compact mode', () => {
    const view = render(<LayerCard {...cardProps} url={local.url} localFile={local} />);
    view.unmount();
    render(<LayerCard {...cardProps} url={local.url} localFile={local} />);
    expect(screen.getAllByText('Layer 1.ogg')).toHaveLength(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('debounces typing and cancels drafts when a preset replaces the URL', () => {
    vi.useFakeTimers();
    const { rerender } = render(<LayerCard {...cardProps} />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'h' } });
    fireEvent.change(field, { target: { value: 'https://example.com/audio.ogg' } });
    act(() => vi.advanceTimersByTime(349));
    expect(cardProps.onUrlChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(cardProps.onUrlChange).toHaveBeenCalledExactlyOnceWith('https://example.com/audio.ogg');
    cardProps.onUrlChange.mockClear();
    fireEvent.change(field, { target: { value: 'https://old-draft' } });
    rerender(<LayerCard {...cardProps} url="https://new-preset" />);
    act(() => vi.advanceTimersByTime(400));
    expect(cardProps.onUrlChange).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('https://new-preset');
  });
});
