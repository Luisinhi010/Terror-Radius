import type { AudioLayer, AudioUrls, Preset } from '../types';

export interface LocalAudioFile {
  url: string;
  filename: string;
  isBlob: boolean;
}

const LAYERS: AudioLayer[] = ['l1', 'l2', 'l3', 'chase'];

export function isLocalAudioUrl(url: string): boolean {
  const value = url.trim();
  if (/^(blob|asset|file|content):/i.test(value)) return true;
  try { return new URL(value).hostname === 'asset.localhost'; }
  catch { return false; }
}

export function readAudioUrls(value: unknown): AudioUrls | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!LAYERS.every(layer => typeof record[layer] === 'string')) return null;
  return Object.fromEntries(LAYERS.map(layer => [layer, record[layer]])) as AudioUrls;
}

// Neither object URLs nor Tauri's runtime file scope survive a new session.
// Do not pretend that serializing a reference embeds the selected audio file.
export function portableAudioUrls(value: unknown): AudioUrls {
  const urls = readAudioUrls(value);
  return Object.fromEntries(LAYERS.map(layer => {
    const url = urls?.[layer] ?? '';
    return [layer, isLocalAudioUrl(url) ? '' : url];
  })) as AudioUrls;
}

export function portablePresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(p => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string' ||
      !readAudioUrls(p.urls) || (p.defaultMixMode !== undefined && !['dbd', 'forsaken'].includes(p.defaultMixMode))) return [];
    return [{ id: p.id, name: p.name, urls: portableAudioUrls(p.urls),
      ...(p.defaultMixMode ? { defaultMixMode: p.defaultMixMode } : {}) }];
  });
}
