// ============================================================
// useAudioEngine — toda a lógica Web Audio API
// O App component só cuida do render; este hook cuida do som.
// ============================================================

import {
  useState, useRef, useEffect, useCallback, useMemo, startTransition,
} from 'react';

import type {
  AudioLayer, AudioUrls, AudioErrors, CrossfadeMode,
  FVols, ForsakenSpeed, MixMode,
} from '../types';
import { dbdVolumes, getZone } from '../utils/audioMath';
import { createMediaCarrier } from '../utils/mediaCarrier';

const AUDIO_LAYERS: AudioLayer[] = ['l1', 'l2', 'l3', 'chase'];

interface UseAudioEngineProps {
  closeness:      number;
  mixMode:        MixMode;
  audioUrls:      AudioUrls;
  masterVolume:   number;
  isMuted:        boolean;
  crossfadeMode:  CrossfadeMode;
  layerOverrides: Record<AudioLayer, number>; // 0 = muted, 1 = normal
  smoothPlayStop: boolean;
  forsakenSpeed:  ForsakenSpeed;
}

export function useAudioEngine({
  closeness, mixMode, audioUrls, masterVolume,
  isMuted, crossfadeMode, layerOverrides,
  smoothPlayStop, forsakenSpeed,
}: UseAudioEngineProps) {
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [fVols,         setFVols]         = useState<FVols>({ l1: 0, l2: 0, l3: 0 });
  const [errors,        setErrors]        = useState<AudioErrors>({});
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [loadingLayers, setLoadingLayers] = useState<Partial<Record<AudioLayer, boolean>>>({});
  const [analysers,     setAnalysers]     = useState<Record<AudioLayer, AnalyserNode | null>>({
    l1: null, l2: null, l3: null, chase: null,
  });

  // ── Web Audio refs ─────────────────────────────────────────────────────────
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const fadeOutTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gainRefs      = useRef<Record<AudioLayer, GainNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const analyserRefs  = useRef<Record<AudioLayer, AnalyserNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const srcRefs       = useRef<Record<AudioLayer, AudioBufferSourceNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const bufRefs       = useRef<Record<AudioLayer, AudioBuffer | null>>({ l1: null, l2: null, l3: null, chase: null });
  const startTimeRefs = useRef<Record<AudioLayer, number | null>>({ l1: null, l2: null, l3: null, chase: null });
  const loadGenerationRefs = useRef<Record<AudioLayer, number>>({ l1: 0, l2: 0, l3: 0, chase: 0 });
  const abortRefs = useRef<Record<AudioLayer, AbortController | null>>({ l1: null, l2: null, l3: null, chase: null });
  const previousUrlsRef = useRef<AudioUrls | null>(null);
  const loadPromisesRef = useRef<Partial<Record<AudioLayer, Promise<boolean>>>>({});
  const reloadGenerationRef = useRef(0);
  const playGenerationRef = useRef(0);
  const loadingBatchRef = useRef(false);
  const playbackReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const mediaCarrierRef = useRef<ReturnType<typeof createMediaCarrier> | null>(null);
  const [mediaPlaying, setMediaPlaying] = useState(false);

  const currentZone = getZone(closeness);
  const isChase     = currentZone === 4;

  // Refs que acompanham o estado mais recente para uso em closures assíncronas
  const isPlayingRef = useRef(false);
  const zoneRef      = useRef(currentZone);
  const prevZoneRef  = useRef(currentZone);

  useEffect(() => { zoneRef.current = currentZone; },    [currentZone]);

  // ── Cria AudioContext + GainNodes + AnalyserNodes ─────────────────────────
  // Node graph por layer: source → GainNode → AnalyserNode → masterGain → destination
  const ensureCtx = useCallback((): AudioContext => {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') return audioCtxRef.current;

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    const newAnalysers: Record<AudioLayer, AnalyserNode | null> = { l1: null, l2: null, l3: null, chase: null };
    (Object.keys(gainRefs.current) as AudioLayer[]).forEach(layer => {
      const gain    = ctx.createGain();
      gain.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize               = 512;
      analyser.smoothingTimeConstant = 0.75;
      gain.connect(analyser);
      analyser.connect(masterGain);
      gainRefs.current[layer]     = gain;
      analyserRefs.current[layer] = analyser;
      newAnalysers[layer]         = analyser;
    });
    setAnalysers(newAnalysers);
    return ctx;
  }, []);

  // ── Fetch + decode URL → AudioBuffer ──────────────────────────────────────
  // Cada layer tem uma geração + AbortController próprios. Assim uma resposta
  // antiga nunca sobrescreve a URL mais recente.
  const stopSource = useCallback((layer: AudioLayer) => {
    const source = srcRefs.current[layer];
    if (source) {
      try { source.stop(); } catch { /* Source may have already stopped. */ }
      source.disconnect();
    }
    srcRefs.current[layer] = null;
    startTimeRefs.current[layer] = null;
  }, []);

  const loadBuffer = useCallback(async (layer: AudioLayer, url: string): Promise<boolean> => {
    const generation = ++loadGenerationRefs.current[layer];
    abortRefs.current[layer]?.abort();
    abortRefs.current[layer] = null;
    bufRefs.current[layer] = null;
    setErrors(prev => { const n = { ...prev }; delete n[layer]; return n; });

    if (!url.trim()) {
      stopSource(layer);
      bufRefs.current[layer] = null;
      setErrors(prev => { const n = { ...prev }; delete n[layer]; return n; });
      setLoadingLayers(prev => { const n = { ...prev }; delete n[layer]; return n; });
      return false;
    }

    const controller = new AbortController();
    abortRefs.current[layer] = controller;
    setLoadingLayers(prev => ({ ...prev, [layer]: true }));

    try {
      const ctx = ensureCtx();
      const res = await fetch(url.trim(), { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      if (!mountedRef.current || controller.signal.aborted || loadGenerationRefs.current[layer] !== generation) return false;
      bufRefs.current[layer] = buf;
      setErrors(prev => { const n = { ...prev }; delete n[layer]; return n; });
      return true;
    } catch {
      if (!mountedRef.current || controller.signal.aborted || loadGenerationRefs.current[layer] !== generation) return false;
      stopSource(layer);
      bufRefs.current[layer] = null;
      setErrors(prev => ({ ...prev, [layer]: true }));
      return false;
    } finally {
      if (mountedRef.current && loadGenerationRefs.current[layer] === generation) {
        abortRefs.current[layer] = null;
        setLoadingLayers(prev => { const n = { ...prev }; delete n[layer]; return n; });
      }
    }
  }, [ensureCtx, stopSource]);

  // ── Posição atual do buffer em segundos ────────────────────────────────────
  const getBufferPosition = useCallback((layer: AudioLayer, when?: number): number => {
    const ctx = audioCtxRef.current;
    const buf = bufRefs.current[layer];
    const t0  = startTimeRefs.current[layer];
    if (!ctx || !buf || buf.duration <= 0 || t0 === null) return 0;
    return Math.max(0, (when ?? ctx.currentTime) - t0) % buf.duration;
  }, []);

  // ── Cria + inicia um novo AudioBufferSourceNode ───────────────────────────
  const startSource = useCallback((layer: AudioLayer, offset = 0, when?: number) => {
    const ctx  = audioCtxRef.current;
    const buf  = bufRefs.current[layer];
    const gain = gainRefs.current[layer];
    if (!ctx || !buf || !gain || !playbackReadyRef.current || loadingBatchRef.current) return;
    stopSource(layer);
    const resolvedWhen = when ?? ctx.currentTime;
    const safeOffset   = buf.duration > 0 ? Math.max(0, offset) % buf.duration : 0;
    const source       = ctx.createBufferSource();
    source.buffer  = buf;
    source.loop    = true;
    source.connect(gain);
    source.start(resolvedWhen, safeOffset);
    srcRefs.current[layer]       = source;
    startTimeRefs.current[layer] = resolvedWhen - safeOffset;
  }, [stopSource]);

  const startTogether = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current || !playbackReadyRef.current || loadingBatchRef.current) return;
    const when = ctx.currentTime + 0.05;
    AUDIO_LAYERS.forEach(layer => startSource(layer, 0, when));
  }, [startSource]);

  // Invalidate BOTH fetch and decode continuations on unmount. Resetting URLs
  // also makes React StrictMode's setup → cleanup → setup replay reload safely.
  const dispose = useCallback(() => {
    mountedRef.current = false;
    isPlayingRef.current = false;
    playbackReadyRef.current = false;
    loadingBatchRef.current = false;
    mediaCarrierRef.current?.dispose();
    mediaCarrierRef.current = null;
    ++playGenerationRef.current;
    ++reloadGenerationRef.current;
    previousUrlsRef.current = null;
    loadPromisesRef.current = {};
    if (fadeOutTimer.current) clearTimeout(fadeOutTimer.current);
    fadeOutTimer.current = null;
    AUDIO_LAYERS.forEach(layer => {
      ++loadGenerationRefs.current[layer];
      abortRefs.current[layer]?.abort();
      abortRefs.current[layer] = null;
      stopSource(layer);
      bufRefs.current[layer] = null;
      gainRefs.current[layer] = null;
      analyserRefs.current[layer] = null;
    });
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    masterGainRef.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
  }, [stopSource]);

  useEffect(() => {
    mountedRef.current = true;
    return dispose;
  }, [dispose]);

  // ── Pré-decode na montagem; hot-swap quando URL muda ─────────────────────
  useEffect(() => {
    const previous = previousUrlsRef.current;
    previousUrlsRef.current = { ...audioUrls };
    const changed = AUDIO_LAYERS
      .filter(layer => previous === null || previous[layer] !== audioUrls[layer]);

    if (changed.length === 0) return;
    const generation = ++reloadGenerationRef.current;
    loadingBatchRef.current = true;
    // Silence the previous set during replacement; never mix old sources with
    // newly decoded buffers. Unchanged buffers are reused without downloading.
    AUDIO_LAYERS.forEach(stopSource);
    changed.forEach(layer => {
      loadPromisesRef.current[layer] = loadBuffer(layer, audioUrls[layer]);
    });
    // Include pending work for UNCHANGED layers. A second selection must not
    // abandon other layers that are still downloading/decoding.
    void Promise.all(Object.values(loadPromisesRef.current)).then(() => {
      if (!mountedRef.current || generation !== reloadGenerationRef.current) return;
      loadingBatchRef.current = false;
      startTogether();
    });
  }, [audioUrls, loadBuffer, startTogether, stopSource]);

  // ── Entrada na zona Chase ─────────────────────────────────────────────────
  // Forsaken: restart do zero | DBD: snap ao offset de L3 para transição inaudível
  useEffect(() => {
    const enteredChase = prevZoneRef.current !== 4 && currentZone === 4;
    prevZoneRef.current = currentZone;
    if (!enteredChase || !isPlayingRef.current) return;
    if (mixMode === 'forsaken') {
      startSource('chase');
    } else {
      const when = (audioCtxRef.current?.currentTime ?? 0) + 0.01;
      startSource('chase', getBufferPosition('l3', when), when);
    }
  }, [currentZone, mixMode, startSource, getBufferPosition]);

  // ── Forsaken lerp ─────────────────────────────────────────────────────────
  // startTransition marca como baixa prioridade para interações do usuário terem precedência
  useEffect(() => {
    if (mixMode !== 'forsaken') return;
    const step = { slow: 0.04, normal: 0.1, fast: 0.25 }[forsakenSpeed];
    const interval = setInterval(() => {
      startTransition(() => {
        setFVols(prev => {
          const z    = zoneRef.current;
          const lerp = (cur: number, tgt: number) =>
            Math.abs(cur - tgt) < step ? tgt : cur + (tgt > cur ? step : -step);
          const next = {
            l1: lerp(prev.l1, z === 1 ? 1 : 0),
            l2: lerp(prev.l2, z === 2 ? 1 : 0),
            l3: lerp(prev.l3, z === 3 ? 1 : 0),
          };
          // Reuse the same state object after the fade settles. Returning a new
          // object here used to rerender the entire app 20 times per second in
          // Forsaken mode, which could starve drawer clicks on slower WebViews.
          return next.l1 === prev.l1 && next.l2 === prev.l2 && next.l3 === prev.l3
            ? prev
            : next;
        });
      });
    }, 50);
    return () => clearInterval(interval);
  }, [mixMode, forsakenSpeed]);

  // ── Cálculo final de volume ────────────────────────────────────────────────
  const { volL1, volL2, volL3, volChase } = useMemo(() => {
    if (isChase)               return { volL1: 0, volL2: 0, volL3: 0, volChase: 1 };
    if (mixMode === 'forsaken')
      return { volL1: fVols.l1, volL2: fVols.l2, volL3: fVols.l3, volChase: 0 };
    const { l1, l2, l3 } = dbdVolumes(closeness, crossfadeMode);
    return { volL1: l1, volL2: l2, volL3: l3, volChase: 0 };
  }, [closeness, mixMode, crossfadeMode, fVols, isChase]);

  // ── Escreve volumes nos GainNodes ─────────────────────────────────────────
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const eff  = (v: number, layer: AudioLayer) => isMuted ? 0 : v * masterVolume * layerOverrides[layer];
    const ramp = (gain: GainNode | null, v: number, layer: AudioLayer) =>
      gain?.gain.setTargetAtTime(eff(v, layer), ctx.currentTime, 0.01);
    ramp(gainRefs.current.l1,    volL1,    'l1');
    ramp(gainRefs.current.l2,    volL2,    'l2');
    ramp(gainRefs.current.l3,    volL3,    'l3');
    ramp(gainRefs.current.chase, volChase, 'chase');
  }, [volL1, volL2, volL3, volChase, isMuted, masterVolume, layerOverrides, analysers]);

  // ── Play / Stop ───────────────────────────────────────────────────────────
  const stop = useCallback((immediate = false) => {
    if (!isPlayingRef.current && !immediate) return;
    ++playGenerationRef.current;
    isPlayingRef.current = false;
    playbackReadyRef.current = false;
    setIsPlaying(false);
    setMediaPlaying(false);
    mediaCarrierRef.current?.stop();
    if (fadeOutTimer.current) clearTimeout(fadeOutTimer.current);
    fadeOutTimer.current = null;

    const ctx = audioCtxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx) return;

    if (!immediate && smoothPlayStop && masterGain) {
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      fadeOutTimer.current = setTimeout(() => {
        fadeOutTimer.current = null;
        if (isPlayingRef.current) return;
        (Object.keys(srcRefs.current) as AudioLayer[]).forEach(stopSource);
        const gain = masterGainRef.current;
        const currentCtx = audioCtxRef.current;
        if (gain && currentCtx) {
          gain.gain.cancelScheduledValues(currentCtx.currentTime);
          gain.gain.setValueAtTime(1, currentCtx.currentTime);
        }
      }, 1200);
    } else {
      (Object.keys(srcRefs.current) as AudioLayer[]).forEach(stopSource);
      if (masterGain) {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setValueAtTime(1, ctx.currentTime);
      }
    }
  }, [smoothPlayStop, stopSource]);

  const stopImmediately = useCallback(() => stop(true), [stop]);

  const play = useCallback(async () => {
    if (!mountedRef.current || isPlayingRef.current) return;
    const generation = ++playGenerationRef.current;
    isPlayingRef.current = true;
    playbackReadyRef.current = false;
    setIsPlaying(true);
    setPlaybackError(null);

    if (fadeOutTimer.current) clearTimeout(fadeOutTimer.current);
    fadeOutTimer.current = null;
    // A new Play cancels old fading sources even if resume/play is still pending.
    AUDIO_LAYERS.forEach(stopSource);
    try {
      const ctx = ensureCtx();
      if (navigator.mediaSession && !mediaCarrierRef.current) {
        mediaCarrierRef.current = createMediaCarrier(
          () => { if (mountedRef.current && isPlayingRef.current) stop(true); },
          () => {
            if (!mountedRef.current || !isPlayingRef.current) return;
            stop(true);
            setPlaybackError('System audio stopped unexpectedly. Try Play again.');
          },
        );
      }
      // Invoke both before awaiting so HTML audio keeps the user activation.
      await Promise.all([ctx.resume(), mediaCarrierRef.current?.play()]);
      if (!mountedRef.current || generation !== playGenerationRef.current || !isPlayingRef.current) return;
      playbackReadyRef.current = true;
      setMediaPlaying(true);
      const masterGain = masterGainRef.current;
      if (masterGain) {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        if (smoothPlayStop) {
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          masterGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
        } else {
          masterGain.gain.setValueAtTime(1, ctx.currentTime);
        }
      }
      startTogether();
    } catch {
      if (!mountedRef.current || generation !== playGenerationRef.current) return;
      stop(true);
      setPlaybackError('Could not start audio. Try Play again or check your audio device.');
    }
  }, [smoothPlayStop, ensureCtx, startTogether, stopSource, stop]);

  useEffect(() => {
    // Navigating away stops playback; merely hiding/locking the page does not.
    window.addEventListener('pagehide', stopImmediately);
    return () => window.removeEventListener('pagehide', stopImmediately);
  }, [stopImmediately]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) stop();
    else void play();
  }, [play, stop]);

  return {
    isPlaying, mediaPlaying, errors, loadingLayers, analysers, playbackError,
    volL1, volL2, volL3, volChase,
    play, stop, stopImmediately, togglePlay,
  };
}
