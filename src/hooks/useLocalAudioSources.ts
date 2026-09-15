import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioLayer, AudioUrls, Preset } from '../types';
import type { LocalAudioFile } from '../utils/localAudio';

// Ownership belongs to App, not LayerCard: compact mode unmounts the cards,
// and a session favorite may still need a file after another preset is loaded.
export function useLocalAudioSources(
  urls: AudioUrls,
  favorites: Preset[],
  onUrlChange: (layer: AudioLayer, url: string) => void,
) {
  const owned = useRef(new Map<string, LocalAudioFile>());
  const [files, setFiles] = useState<Record<string, LocalAudioFile>>({});
  const referenced = useMemo(() => new Set([
    ...Object.values(urls), ...favorites.flatMap(p => Object.values(p.urls)),
  ]), [urls, favorites]);
  // Adjust display metadata to the new props without an effect-driven render.
  // Revocation itself stays in the effect below, never in render.
  if (Object.keys(files).some(url => !referenced.has(url))) {
    setFiles(Object.fromEntries(Object.entries(files).filter(([url]) => referenced.has(url))));
  }

  const selectFile = useCallback((layer: AudioLayer, file: LocalAudioFile) => {
    owned.current.set(file.url, file);
    setFiles(previous => ({ ...previous, [file.url]: file }));
    onUrlChange(layer, file.url);
  }, [onUrlChange]);

  useEffect(() => {
    for (const [url, file] of owned.current) {
      if (referenced.has(url)) continue;
      if (file.isBlob) URL.revokeObjectURL(url);
      owned.current.delete(url);
    }
  }, [referenced]);

  useEffect(() => {
    const entries = owned.current;
    return () => {
      for (const [url, file] of entries) if (file.isBlob) URL.revokeObjectURL(url);
      entries.clear();
    };
  }, []);

  return { files, selectFile };
}
