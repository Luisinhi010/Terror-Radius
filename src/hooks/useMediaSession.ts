import { useEffect, useRef } from 'react';
import type { AudioLayer } from '../types';

interface MediaSessionProps {
  title: string;
  isPlaying: boolean;
  closeness: number;
  volumes: Record<AudioLayer, number>;
  play: () => Promise<void>;
  stop: () => void;
  seek: (proximity: number) => void;
}

const clamp = (value: number) => Math.round(Math.min(100, Math.max(0, value)));

// Deliberately describe proximity as a 100-second track. This tiny nonzero
// rate keeps the native seek bar nearly stationary; actual audio stays at 1x.
function setPosition(session: MediaSession, proximity: number) {
  try {
    session.setPositionState?.({ duration: 100, position: proximity, playbackRate: 0.000001 });
  } catch { /* Some browsers implement Media Session without custom positions. */ }
}

export function useMediaSession({ title, isPlaying, closeness, volumes, play, stop, seek }: MediaSessionProps) {
  const proximity = clamp(closeness);
  const layers = (['l1', 'l2', 'l3', 'chase'] as const)
    .filter(key => volumes[key] > 0.001)
    .map(key => key === 'chase' ? 'Chase' : `Layer ${key.slice(1)}`)
    .join(' + ') || 'Safe';
  const artist = `${layers} · ${proximity}%`;
  const latest = useRef({ play, stop, seek, proximity });
  useEffect(() => { latest.current = { play, stop, seek, proximity }; }, [play, stop, seek, proximity]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    const update = (value: number | undefined) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const next = clamp(value);
      latest.current.proximity = next; // Back-to-back hardware actions accumulate.
      latest.current.seek(next);
      setPosition(session, next);
    };
    const offset = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 10;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { void latest.current.play(); },
      pause: () => latest.current.stop(),
      stop: () => latest.current.stop(),
      seekto: details => update(details.seekTime),
      seekbackward: details => update(latest.current.proximity - offset(details.seekOffset)),
      seekforward: details => update(latest.current.proximity + offset(details.seekOffset)),
    };
    const registered: MediaSessionAction[] = [];
    for (const action of Object.keys(handlers) as MediaSessionAction[]) {
      try {
        session.setActionHandler(action, handlers[action]!);
        registered.push(action);
      } catch { /* Unsupported actions must not prevent other controls. */ }
    }
    return () => {
      for (const action of registered) {
        try { session.setActionHandler(action, null); } catch { /* Optional API. */ }
      }
      session.metadata = null;
      session.playbackState = 'none';
      try { session.setPositionState?.(); } catch { /* Optional API. */ }
    };
  }, []);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session || typeof MediaMetadata === 'undefined') return;
    session.metadata = new MediaMetadata({ title, artist, album: 'Terror Radius' });
  }, [title, artist]);

  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    session.playbackState = isPlaying ? 'playing' : 'paused';
    setPosition(session, proximity);
  }, [isPlaying, proximity, title, artist]);
}
