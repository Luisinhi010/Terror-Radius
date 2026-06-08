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

  const currentZone = getZone(closeness);
  const isChase     = currentZone === 4;

  // Refs que acompanham o estado mais recente para uso em closures assíncronas
  const isPlayingRef = useRef(false);
  const zoneRef      = useRef(currentZone);
  const prevZoneRef  = useRef(currentZone);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
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
  const loadBuffer = useCallback(async (layer: AudioLayer, url: string) => {
    if (!url) return;
    setLoadingLayers(prev => ({ ...prev, [layer]: true }));
    try {
      const ctx = ensureCtx();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      bufRefs.current[layer] = buf;
      setErrors(prev => { const n = { ...prev }; delete n[layer]; return n; });
    } catch {
      bufRefs.current[layer] = null;
      setErrors(prev => ({ ...prev, [layer]: true }));
    } finally {
      setLoadingLayers(prev => { const n = { ...prev }; delete n[layer]; return n; });
    }
  }, [ensureCtx]);

  // ── Posição atual do buffer em segundos ────────────────────────────────────
  const getBufferPosition = useCallback((layer: AudioLayer): number => {
    const ctx = audioCtxRef.current;
    const buf = bufRefs.current[layer];
    const t0  = startTimeRefs.current[layer];
    if (!ctx || !buf || t0 === null) return 0;
    return (ctx.currentTime - t0) % buf.duration;
  }, []);

  // ── Cria + inicia um novo AudioBufferSourceNode ───────────────────────────
  const startSource = useCallback((layer: AudioLayer, offset = 0, when?: number) => {
    const ctx  = audioCtxRef.current;
    const buf  = bufRefs.current[layer];
    const gain = gainRefs.current[layer];
    if (!ctx || !buf || !gain) return;
    try { srcRefs.current[layer]?.stop(); } catch {}
    const resolvedWhen = when ?? ctx.currentTime;
    const safeOffset   = buf.duration > 0 ? offset % buf.duration : 0;
    const source       = ctx.createBufferSource();
    source.buffer  = buf;
    source.loop    = true;
    source.connect(gain);
    source.start(resolvedWhen, safeOffset);
    srcRefs.current[layer]       = source;
    startTimeRefs.current[layer] = resolvedWhen - safeOffset;
  }, []);

  // ── Pré-decode na montagem; hot-swap quando URL muda ─────────────────────
  useEffect(() => {
    const reload = async (layer: AudioLayer) => {
      await loadBuffer(layer, audioUrls[layer]);
      if (isPlayingRef.current && bufRefs.current[layer]) startSource(layer);
    };
    (Object.keys(audioUrls) as AudioLayer[]).forEach(layer => reload(layer));
  }, [audioUrls, loadBuffer, startSource]);

  // ── Entrada na zona Chase ─────────────────────────────────────────────────
  // Forsaken: restart do zero | DBD: snap ao offset de L3 para transição inaudível
  useEffect(() => {
    const enteredChase = prevZoneRef.current !== 4 && currentZone === 4;
    prevZoneRef.current = currentZone;
    if (!enteredChase || !isPlayingRef.current) return;
    if (mixMode === 'forsaken') {
      startSource('chase');
    } else {
      startSource('chase', getBufferPosition('l3'));
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
          return {
            l1: lerp(prev.l1, z === 1 ? 1 : 0),
            l2: lerp(prev.l2, z === 2 ? 1 : 0),
            l3: lerp(prev.l3, z === 3 ? 1 : 0),
          };
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
  }, [volL1, volL2, volL3, volChase, isMuted, masterVolume, layerOverrides]);

  // ── Play / Stop ───────────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    const ctx        = ensureCtx();
    const masterGain = masterGainRef.current;

    if (!isPlaying) {
      if (fadeOutTimer.current) { clearTimeout(fadeOutTimer.current); fadeOutTimer.current = null; }
      await ctx.resume();

      if (masterGain) {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        if (smoothPlayStop) {
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          masterGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
        } else {
          masterGain.gain.setValueAtTime(1, ctx.currentTime);
        }
      }
      const startAt = ctx.currentTime + 0.05;
      (Object.keys(srcRefs.current) as AudioLayer[]).forEach(layer => startSource(layer, 0, startAt));
      setIsPlaying(true);

    } else {
      setIsPlaying(false);

      if (smoothPlayStop && masterGain) {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        fadeOutTimer.current = setTimeout(() => {
          fadeOutTimer.current = null;
          if (isPlayingRef.current) return;
          (Object.keys(srcRefs.current) as AudioLayer[]).forEach(layer => {
            try { srcRefs.current[layer]?.stop(); } catch {}
            srcRefs.current[layer] = null;
          });
          if (masterGainRef.current) {
            masterGainRef.current.gain.cancelScheduledValues(0);
            masterGainRef.current.gain.setValueAtTime(1, 0);
          }
        }, 1200);
      } else {
        (Object.keys(srcRefs.current) as AudioLayer[]).forEach(layer => {
          try { srcRefs.current[layer]?.stop(); } catch {}
          srcRefs.current[layer] = null;
        });
        if (masterGain) {
          masterGain.gain.cancelScheduledValues(ctx.currentTime);
          masterGain.gain.setValueAtTime(1, ctx.currentTime);
        }
      }
    }
  }, [isPlaying, smoothPlayStop, ensureCtx, startSource]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (fadeOutTimer.current) clearTimeout(fadeOutTimer.current);
      (Object.keys(srcRefs.current) as AudioLayer[]).forEach(layer => {
        try { srcRefs.current[layer]?.stop(); } catch {}
      });
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isPlaying, errors, loadingLayers, analysers,
    volL1, volL2, volL3, volChase,
    togglePlay,
  };
}
