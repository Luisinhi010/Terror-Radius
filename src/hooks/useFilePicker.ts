import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalAudioFile } from '../utils/localAudio';

const AUDIO_EXTENSIONS = ['ogg', 'mp3', 'wav', 'flac', 'm4a', 'opus', 'aac'];
const AUDIO_ACCEPT = 'audio/*,' + AUDIO_EXTENSIONS.map(ext => '.' + ext).join(',');

export function pickWebAudio(signal: AbortSignal): Promise<LocalAudioFile | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = AUDIO_ACCEPT;
    input.hidden = true;
    let finished = false;
    const cleanup = () => {
      finished = true;
      input.remove();
      input.onchange = null;
      input.oncancel = null;
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      if (finished) return;
      cleanup();
      resolve(null);
    };
    input.oncancel = cancel;
    input.onchange = () => {
      if (finished) return;
      const file = input.files?.[0];
      cleanup();
      if (!file) { resolve(null); return; }
      try {
        resolve({ url: URL.createObjectURL(file), filename: file.name, isBlob: true });
      } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', cancel, { once: true });
    document.body.appendChild(input);
    try { input.click(); }
    catch (error) { cleanup(); reject(error); }
  });
}

async function pickNativeAudio(signal: AbortSignal): Promise<LocalAudioFile | null> {
  const [{ open }, { convertFileSrc }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core'),
  ]);
  if (signal.aborted) return null;
  const path = await open({ multiple: false, directory: false,
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }] });
  if (signal.aborted || typeof path !== 'string') return null;
  return { url: convertFileSrc(path), filename: path.split(/[\\/]/).pop() ?? path, isBlob: false };
}

export function useFilePicker(onPick: (file: LocalAudioFile) => void, currentUrl: string) {
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState({ url: currentUrl, picking: false, error: null as string | null });
  const isPicking = status.url === currentUrl && status.picking;
  const pickerError = status.url === currentUrl ? status.error : null;

  useEffect(() => {
    return () => { active.current?.abort(); active.current = null; };
  }, [currentUrl]);

  const pick = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus({ url: currentUrl, picking: true, error: null });
    try {
      // On mobile, use the WebView's file input, which supplies a File instead
      // of an Android content URI that convertFileSrc cannot turn into a path.
      const nativeDesktop = '__TAURI_INTERNALS__' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent);
      const file = await (nativeDesktop ? pickNativeAudio(controller.signal) : pickWebAudio(controller.signal));
      if (controller.signal.aborted) {
        if (file?.isBlob) URL.revokeObjectURL(file.url);
        return;
      }
      if (file) onPick(file);
    } catch {
      if (!controller.signal.aborted) setStatus({ url: currentUrl, picking: false,
        error: 'Could not open the audio file. Please try again.' });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setStatus(previous => ({ ...previous, picking: false }));
      }
    }
  }, [onPick, currentUrl]);

  return { pick, isPicking, pickerError };
}
