import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { Play, Square, Volume2, VolumeX, Link as LinkIcon, AlertCircle, PanelLeft, PanelRight, X, Maximize2, HelpCircle } from 'lucide-react';

// ============================================================
// TYPES
// ============================================================
type MixMode     = 'dbd' | 'forsaken';
type AudioLayer  = 'l1' | 'l2' | 'l3' | 'chase';
type AudioUrls   = Record<AudioLayer, string>;
type FVols       = Record<Exclude<AudioLayer, 'chase'>, number>;
type AudioErrors   = Partial<Record<AudioLayer, boolean>>;
type CrossfadeMode = 'linear' | 'equal-power';
type ForsakenSpeed = 'slow' | 'normal' | 'fast';

interface Preset {
  id:              string;
  name:            string;
  urls:            AudioUrls;
  defaultMixMode?: MixMode; // auto-switch mix mode when this preset is loaded
}

interface LayerConfig {
  key:           AudioLayer;
  label:         string;
  dbdRange:      string;
  forsakenRange: string;
  colorClass:    string; // Tailwind class for the volume bar and indicator dot
  color:         string; // Raw CSS color for canvas drawing
}

// ============================================================
// DBD MODE — VOLUME BOUNDARY CONSTANTS
// Active range: [DBD_START, DBD_END) — values below start are
// silent; DBD_END (99) triggers full L3; 100 = chase.
// Three equal zones of ≈32.67 units each divide [1, 99].
// ============================================================
const DBD_START = 1;
const DBD_END   = 99;
const DBD_ZONE  = (DBD_END - DBD_START) / 3; // ≈ 32.67
const DBD_B2    = DBD_START + DBD_ZONE;       // ≈ 33.67  (L1 peak / L2 fade-in start)
const DBD_B3    = DBD_START + DBD_ZONE * 2;   // ≈ 66.33  (L2 peak / L3 fade-in start)

// ============================================================
// LAYER DEFINITIONS
// All per-layer data lives here — no hardcoded strings in JSX.
// ============================================================
const LAYERS: LayerConfig[] = [
  { key: 'l1',    label: 'Layer 1 — Far',   colorClass: 'bg-green-500',  color: '#22c55e',
    dbdRange: 'Active: 1% – 66%  (peak at ~34%)',       forsakenRange: 'Exclusive zone: 1% – 33%'   },
  { key: 'l2',    label: 'Layer 2 — Mid',   colorClass: 'bg-yellow-500', color: '#eab308',
    dbdRange: 'Active: 34% – 99%  (peak at ~66%)',      forsakenRange: 'Exclusive zone: 34% – 66%'  },
  { key: 'l3',    label: 'Layer 3 — Close', colorClass: 'bg-orange-500', color: '#f97316',
    dbdRange: 'Active: 66% – 99%  (full at 99%)',       forsakenRange: 'Exclusive zone: 67% – 99%'  },
  { key: 'chase', label: 'Chase Music',     colorClass: 'bg-red-500',    color: '#ef4444',
    dbdRange: '100% — Line of Sight',                   forsakenRange: '100%'                        },
];

// ============================================================
// HELPERS
// ============================================================

// Maps a closeness value (0–100) to one of 5 discrete zones:
//   0 = silence | 1 = far | 2 = mid | 3 = close | 4 = chase (line-of-sight)
const getZone = (c: number): number => {
  if (c === 0)  return 0;
  if (c <= 33)  return 1;
  if (c <= 66)  return 2;
  if (c < 100)  return 3;
  return 4;
};

// Human-readable label for each zone index (0 = silence … 4 = chase)
const ZONE_LABELS: Record<number, string> = {
  0: 'Safe', 1: 'Far', 2: 'Mid', 3: 'Close', 4: 'Chase',
};

// ── Pure volume helpers (module-level, shared by engine + curve graph) ───────

// Computes the three stem volumes for DBD mode at a given closeness value.
// Extracted so the audio engine and the curve graph stay in sync automatically.
function dbdVolumes(c: number, mode: CrossfadeMode): { l1: number; l2: number; l3: number } {
  let l1 = 0, l2 = 0, l3 = 0;
  const xfade = (t: number): [number, number] => {
    const h = t * Math.PI / 2;
    return mode === 'equal-power' ? [Math.cos(h), Math.sin(h)] : [1 - t, t];
  };
  if      (c >= DBD_START && c < DBD_B2)  l1 = xfade((c - DBD_START) / DBD_ZONE)[1];
  else if (c >= DBD_B2    && c < DBD_B3) { const [o, i] = xfade((c - DBD_B2) / DBD_ZONE); l1 = o; l2 = i; }
  else if (c >= DBD_B3    && c < DBD_END){ const [o, i] = xfade((c - DBD_B3) / DBD_ZONE); l2 = o; l3 = i; }
  else if (c >= DBD_END)                  l3 = 1;
  return { l1, l2, l3 };
}

// Returns all 4 layer volumes at a given closeness — used by the curve graph
// to sample the design curves across the 0–100 range.
function allVolumes(c: number, mix: MixMode, cf: CrossfadeMode): Record<AudioLayer, number> {
  const zone = getZone(c);
  if (zone === 4)           return { l1: 0, l2: 0, l3: 0, chase: 1 };
  if (mix === 'forsaken')   return {
    l1: zone === 1 ? 1 : 0, l2: zone === 2 ? 1 : 0, l3: zone === 3 ? 1 : 0, chase: 0,
  };
  const { l1, l2, l3 } = dbdVolumes(c, cf);
  return { l1, l2, l3, chase: 0 };
}

// Generic hook that mirrors useState but syncs to localStorage.
// Uses a lazy initializer so the stored value is read only once on mount.
function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item !== null ? (JSON.parse(item) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

// ============================================================
// HOOK: useAudioEngine
//
// Owns all audio logic. The App component only handles rendering.
// ============================================================
interface UseAudioEngineProps {
  closeness:      number;
  mixMode:        MixMode;
  audioUrls:      AudioUrls;
  masterVolume:   number;
  isMuted:        boolean;
  crossfadeMode:  CrossfadeMode;
  layerOverrides: Record<AudioLayer, number>; // per-layer multiplier: 0 = muted, 1 = normal
  smoothPlayStop: boolean;   // fade in/out on play/stop vs instant cut
  forsakenSpeed:  ForsakenSpeed; // lerp step size for Forsaken volume transitions
}

function useAudioEngine({ closeness, mixMode, audioUrls, masterVolume, isMuted, crossfadeMode, layerOverrides, smoothPlayStop, forsakenSpeed }: UseAudioEngineProps) {
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [fVols,         setFVols]         = useState<FVols>({ l1: 0, l2: 0, l3: 0 });
  const [errors,        setErrors]        = useState<AudioErrors>({});
  const [loadingLayers, setLoadingLayers] = useState<Partial<Record<AudioLayer, boolean>>>({});
  // Exposed as state so LayerCard re-renders when analysers become available
  const [analysers, setAnalysers] = useState<Record<AudioLayer, AnalyserNode | null>>({
    l1: null, l2: null, l3: null, chase: null,
  });

  // ── Web Audio API refs ─────────────────────────────────────────────────────
  const audioCtxRef   = useRef<AudioContext | null>(null);
  // Master gain — all layer analysers funnel through here before destination.
  // Used for global fade in / out on play / stop.
  const masterGainRef = useRef<GainNode | null>(null);
  // Pending fade-out timer — cleared when the user plays again before it fires.
  const fadeOutTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gainRefs      = useRef<Record<AudioLayer, GainNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const analyserRefs  = useRef<Record<AudioLayer, AnalyserNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const srcRefs       = useRef<Record<AudioLayer, AudioBufferSourceNode | null>>({ l1: null, l2: null, l3: null, chase: null });
  const bufRefs       = useRef<Record<AudioLayer, AudioBuffer | null>>({ l1: null, l2: null, l3: null, chase: null });
  // Records the effective t=0 for each layer (AudioContext time − playback offset),
  // used to compute the current buffer position for DBD chase sync.
  const startTimeRefs = useRef<Record<AudioLayer, number | null>>({ l1: null, l2: null, l3: null, chase: null });

  const currentZone = getZone(closeness);
  const isChase     = currentZone === 4;

  const isPlayingRef = useRef(false);
  const zoneRef      = useRef(currentZone);
  const prevZoneRef  = useRef(currentZone);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { zoneRef.current = currentZone; },    [currentZone]);

  // ── Create AudioContext + GainNodes + AnalyserNodes ────────────────────────
  // Node graph per layer:  source → GainNode → AnalyserNode → masterGain → destination
  // masterGain handles global fade in/out; AnalyserNode taps the signal without consuming it.
  const ensureCtx = useCallback((): AudioContext => {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') return audioCtxRef.current;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    // Single master gain for global fade in/out
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    const newAnalysers: Record<AudioLayer, AnalyserNode | null> = { l1: null, l2: null, l3: null, chase: null };
    (Object.keys(gainRefs.current) as AudioLayer[]).forEach(layer => {
      const gain     = ctx.createGain();
      gain.gain.value = 0;
      const analyser  = ctx.createAnalyser();
      analyser.fftSize               = 512;
      analyser.smoothingTimeConstant = 0.75;
      gain.connect(analyser);
      analyser.connect(masterGain); // route through master gain, not directly to destination
      gainRefs.current[layer]     = gain;
      analyserRefs.current[layer] = analyser;
      newAnalysers[layer]         = analyser;
    });
    setAnalysers(newAnalysers);
    return ctx;
  }, []);

  // ── Fetch + decode a URL → AudioBuffer, with loading state ────────────────
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

  // ── Compute a layer's current playback position in seconds ─────────────────
  // position = (AudioContext.currentTime − effectiveStart) mod buffer.duration
  // Used for DBD chase sync: snapping chase to layer 3's position on zone entry.
  const getBufferPosition = useCallback((layer: AudioLayer): number => {
    const ctx = audioCtxRef.current;
    const buf = bufRefs.current[layer];
    const t0  = startTimeRefs.current[layer];
    if (!ctx || !buf || t0 === null) return 0;
    return (ctx.currentTime - t0) % buf.duration;
  }, []);

  // ── Create + start a new AudioBufferSourceNode for one layer ──────────────
  const startSource = useCallback((layer: AudioLayer, offset = 0, when?: number) => {
    const ctx  = audioCtxRef.current;
    const buf  = bufRefs.current[layer];
    const gain = gainRefs.current[layer];
    if (!ctx || !buf || !gain) return;
    try { srcRefs.current[layer]?.stop(); } catch {}
    const resolvedWhen  = when ?? ctx.currentTime;
    const safeOffset    = buf.duration > 0 ? offset % buf.duration : 0;
    const source        = ctx.createBufferSource();
    source.buffer       = buf;
    source.loop         = true;
    source.connect(gain);
    source.start(resolvedWhen, safeOffset);
    srcRefs.current[layer]       = source;
    // Store the effective t=0: what AudioContext time corresponds to buffer position 0
    startTimeRefs.current[layer] = resolvedWhen - safeOffset;
  }, []);

  // ── Pre-decode on mount; hot-swap when a URL changes ──────────────────────
  useEffect(() => {
    const reload = async (layer: AudioLayer) => {
      await loadBuffer(layer, audioUrls[layer]);
      if (isPlayingRef.current && bufRefs.current[layer]) startSource(layer);
    };
    (Object.keys(audioUrls) as AudioLayer[]).forEach(layer => reload(layer));
  }, [audioUrls, loadBuffer, startSource]);

  // ── Chase zone entry ───────────────────────────────────────────────────────
  // Forsaken: restart chase from position 0 (hard cut, fresh start).
  // DBD: snap chase to layer 3's current buffer position so the transition is
  // inaudible even when the two tracks have different loop lengths.
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

  // ── Forsaken lerp ──────────────────────────────────────────────────────────
  // startTransition marks this as a low-priority update so React always
  // processes user interactions (clicks, taps) before re-rendering for the lerp.
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

  // ── Final volume calculation ───────────────────────────────────────────────
  // Uses the shared dbdVolumes() function so the engine and curve graph
  // are guaranteed to produce identical numbers.
  const { volL1, volL2, volL3, volChase } = useMemo(() => {
    if (isChase)              return { volL1: 0, volL2: 0, volL3: 0, volChase: 1 };
    if (mixMode === 'forsaken')
      return { volL1: fVols.l1, volL2: fVols.l2, volL3: fVols.l3, volChase: 0 };
    const { l1, l2, l3 } = dbdVolumes(closeness, crossfadeMode);
    return { volL1: l1, volL2: l2, volL3: l3, volChase: 0 };
  }, [closeness, mixMode, crossfadeMode, fVols, isChase]);

  // ── Write volumes to GainNodes ─────────────────────────────────────────────
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

  // ── Play / Stop ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    const ctx        = ensureCtx();
    const masterGain = masterGainRef.current;

    if (!isPlaying) {
      if (fadeOutTimer.current) { clearTimeout(fadeOutTimer.current); fadeOutTimer.current = null; }
      await ctx.resume();

      if (masterGain) {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        if (smoothPlayStop) {
          // Smooth: fade in 0 → 1 over 500 ms
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          masterGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
        } else {
          // Instant: jump straight to 1
          masterGain.gain.setValueAtTime(1, ctx.currentTime);
        }
      }
      const startAt = ctx.currentTime + 0.05;
      (Object.keys(srcRefs.current) as AudioLayer[]).forEach(layer => startSource(layer, 0, startAt));
      setIsPlaying(true);

    } else {
      setIsPlaying(false);

      if (smoothPlayStop && masterGain) {
        // Smooth: exponential fade out, near-silence in ~900 ms
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
        // Instant: stop sources now, reset gain
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

  // ── Cleanup ────────────────────────────────────────────────────────────────
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

// ============================================================
// COMPONENT: LayerCard
// ============================================================
interface LayerCardProps {
  config:        LayerConfig;
  mixMode:       MixMode;
  volume:        number;
  url:           string;
  onUrlChange:   (val: string) => void;
  hasError:      boolean;
  analyser:      AnalyserNode | null;
  isLoading:     boolean;
  isLayerMuted:  boolean;
  isLayerSoloed: boolean;
  onMute:        () => void;
  onSolo:        () => void;
  showWaveform:  boolean;
}

function LayerCard({ config, mixMode, volume, url, onUrlChange, hasError, analyser, isLoading, isLayerMuted, isLayerSoloed, onMute, onSolo, showWaveform }: LayerCardProps) {
  const percent      = Math.round(volume * 100);
  const isActive     = volume > 0.01;
  const isChaseLayer = config.key === 'chase';

  // ── Waveform visualizer ────────────────────────────────────────────────────
  // Uses a requestAnimationFrame loop reading time-domain data from the
  // AnalyserNode. Opacity scales with volume so inactive layers stay dim.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const bufLen = analyser.frequencyBinCount; // = fftSize / 2 = 256
    const data   = new Uint8Array(bufLen);
    let rafId    = 0;

    const draw = () => {
      rafId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      // Resize backing store if the element changed size
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      ctx2d.clearRect(0, 0, w, h);

      const vol   = volumeRef.current;
      const alpha = 0.15 + vol * 0.85;

      // Decompose hex color once for rgba() calls
      const cr = parseInt(config.color.slice(1, 3), 16);
      const cg = parseInt(config.color.slice(3, 5), 16);
      const cb = parseInt(config.color.slice(5, 7), 16);
      const rgba = (a: number) => `rgba(${cr},${cg},${cb},${a})`;

      // Build point array once — reused for fill path and stroke path
      const pts: [number, number][] = Array.from({ length: bufLen }, (_, i) => [
        (i / (bufLen - 1)) * w,
        ((255 - data[i]) / 255) * h,
      ]);

      // 1 ── Gradient fill: waveform → transparent at the bottom
      const grad = ctx2d.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(alpha * 0.45));
      grad.addColorStop(1, rgba(0));
      ctx2d.beginPath();
      ctx2d.moveTo(0, h);
      pts.forEach(([x, y]) => ctx2d.lineTo(x, y));
      ctx2d.lineTo(w, h);
      ctx2d.closePath();
      ctx2d.fillStyle = grad;
      ctx2d.fill();

      // 2 ── Waveform line with soft glow when audible
      ctx2d.globalAlpha = alpha;
      ctx2d.strokeStyle = config.color;
      ctx2d.lineWidth   = 1.5;
      if (vol > 0.03) { ctx2d.shadowBlur = 7; ctx2d.shadowColor = config.color; }
      ctx2d.beginPath();
      pts.forEach(([x, y], i) => i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y));
      ctx2d.stroke();
      ctx2d.shadowBlur  = 0;
      ctx2d.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [analyser, config.color]);

  return (
    <div className={`p-5 rounded-lg border transition-all duration-300 ${
      isChaseLayer && isActive ? 'bg-red-950/30 border-red-700' :
      hasError                 ? 'bg-neutral-900 border-red-900/50' :
      isActive                 ? 'bg-neutral-900 border-neutral-700' :
                                 'bg-neutral-900 border-neutral-800'
    }`}>

        <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2">
            {/* Indicator dot */}
            <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              isLoading ? 'bg-neutral-500 animate-pulse' :
              isLayerMuted ? 'bg-neutral-700' :
              isActive  ? config.colorClass : 'bg-neutral-700'
            }`} />
            <h3 className="font-bold text-sm">{config.label}</h3>
            {isLoading && (
              <span className="text-[10px] text-neutral-500 animate-pulse uppercase tracking-wide">
                decoding…
              </span>
            )}
            {hasError && !isLoading && (
              <span title="Audio failed to load">
                <AlertCircle size={13} className="text-red-500" />
              </span>
            )}
          </div>
          <span className="text-[11px] text-neutral-500 ml-4">
            {mixMode === 'forsaken' ? config.forsakenRange : config.dbdRange}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Solo */}
          <button onClick={onSolo} title="Solo this layer"
            className={`text-[9px] font-black w-5 h-5 rounded flex items-center justify-center transition-all ${
              isLayerSoloed
                ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/50'
                : 'text-neutral-600 hover:text-neutral-300 bg-neutral-800'
            }`}
          >S</button>
          {/* Mute */}
          <button onClick={onMute} title="Mute this layer"
            className={`text-[9px] font-black w-5 h-5 rounded flex items-center justify-center transition-all ${
              isLayerMuted
                ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50'
                : 'text-neutral-600 hover:text-neutral-300 bg-neutral-800'
            }`}
          >M</button>
          {/* Volume percentage */}
          <span className={`text-2xl font-black tabular-nums transition-colors duration-300 ml-1 ${
            isLayerMuted ? 'text-neutral-700' : isActive ? 'text-neutral-100' : 'text-neutral-600'
          }`}>
            {percent}<span className="text-sm font-normal text-neutral-500">%</span>
          </span>
        </div>
      </div>

      {/* Waveform canvas */}
      {showWaveform && <canvas ref={canvasRef} className="w-full h-14 mb-3 rounded" />}

      {/* Volume bar */}
      <div className="w-full h-3 bg-neutral-950 rounded-full overflow-hidden mb-5 relative">
        <div
          className={`h-full ${config.colorClass} transition-all duration-150 ease-out`}
          style={{ width: `${percent}%` }}
        />
        {/* Tick marks at 25% intervals for visual reference */}
        <div className="absolute inset-0 flex justify-between opacity-20 px-1">
          {[0, 1, 2, 3].map(i => <div key={i} className="w-px h-full bg-white" />)}
        </div>
      </div>

      {/* Audio URL input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-neutral-600">
          <LinkIcon size={13} />
        </div>
        <input
          type="text"
          placeholder="Paste audio URL (.ogg, .mp3) or /audio/file.ogg"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          className={`w-full bg-neutral-950 border text-neutral-400 text-xs rounded pl-8 pr-3 py-2
            focus:ring-1 focus:ring-red-600 focus:border-red-600 focus:text-neutral-200
            transition-colors placeholder-neutral-700 ${
            hasError ? 'border-red-900' : 'border-neutral-800'
          }`}
        />
      </div>
      {hasError && !isLoading && (
        <p className="text-[11px] text-red-500/80 mt-1.5 flex items-center gap-1">
          <AlertCircle size={10} />
          CORS or invalid URL — try a local file (e.g. /audio/layer.ogg in public/)
        </p>
      )}
    </div>
  );
}

// ============================================================
// COMPONENT: Sidebar
// ============================================================
interface SidebarProps {
  isOpen:        boolean;
  onClose:       () => void;
  builtins:      Preset[];
  favorites:     Preset[];
  activeId:      string | null;
  onLoad:        (p: Preset) => void;
  onDelete:      (id: string) => void;
  onSave:        (name: string) => void;
}

function Sidebar({ isOpen, onClose, builtins, favorites, activeId, onLoad, onDelete, onSave }: SidebarProps) {
  const [saving, setSaving] = useState(false);
  const [name,   setName]   = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
    setSaving(false);
  };

  const PresetRow = ({ preset, deletable }: { preset: Preset; deletable?: boolean }) => (
    <div className={`flex items-center rounded-lg border transition-all ${
      activeId === preset.id
        ? 'bg-red-900/30 border-red-800/60'
        : 'border-transparent hover:bg-neutral-800'
    }`}>
      <button onClick={() => onLoad(preset)}
        className={`flex-1 text-left px-3 py-2.5 text-sm font-bold flex items-center gap-2.5 ${
          activeId === preset.id ? 'text-red-300' : 'text-neutral-400 hover:text-neutral-200'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          activeId === preset.id ? 'bg-red-400' : deletable ? 'bg-yellow-500/60' : 'bg-neutral-600'
        }`} />
        {preset.name}
      </button>
      {deletable && (
        <button onClick={() => onDelete(preset.id)}
          className="pr-3 text-neutral-600 hover:text-red-400 transition-colors text-base leading-none"
          title="Remove"
        >×</button>
      )}
    </div>
  );

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-30" onClick={onClose} />
      )}

      {/* Panel */}
      <aside className={`fixed left-0 top-0 h-screen w-72 bg-neutral-900 border-r border-neutral-800 z-40 flex flex-col transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      }`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-800 flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-neutral-400">Presets</span>
          <button onClick={onClose}
            className="text-neutral-600 hover:text-neutral-200 transition-colors p-1 rounded"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest px-2 pt-1 pb-1.5">
            Built-in
          </p>
          {builtins.map(p => <PresetRow key={p.id} preset={p} />)}

          {favorites.length > 0 && (
            <>
              <div className="pt-3 pb-1">
                <div className="border-t border-neutral-800 mb-3" />
                <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest px-2">
                  Saved
                </p>
              </div>
              {favorites.map(p => <PresetRow key={p.id} preset={p} deletable />)}
            </>
          )}
        </div>

        {/* Footer: save form */}
        <div className="px-3 py-3 border-t border-neutral-800 flex-shrink-0">
          {saving ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') { setSaving(false); setName(''); }
                }}
                placeholder="Preset name…"
                className="w-full bg-neutral-950 border border-neutral-700 text-neutral-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-red-700"
              />
              <div className="flex gap-2">
                <button onClick={submit}
                  className="flex-1 text-[10px] font-bold py-1.5 rounded bg-red-900/60 text-red-300 border border-red-700 hover:bg-red-900 transition-colors uppercase tracking-wide"
                >Save</button>
                <button onClick={() => { setSaving(false); setName(''); }}
                  className="text-xs text-neutral-600 hover:text-neutral-400 px-2 transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSaving(true)}
              className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-dashed border-neutral-700 text-neutral-600 hover:text-neutral-300 hover:border-neutral-500 transition-all"
            >
              + Save current setup
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

// ============================================================
// COMPONENT: MasterVisualizer
// Full-width frequency spectrum of all four layers combined.
// Uses additive mixing of the four AnalyserNodes so the bars
// grow with the number of active layers, not just the loudest one.
// ============================================================
function MasterVisualizer({ analysers }: { analysers: Record<AudioLayer, AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Start drawing only once at least one analyser is connected
    if (!canvas || !Object.values(analysers).some(Boolean)) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const BUF   = 256; // fftSize / 2 with fftSize = 512
    const tmp   = new Uint8Array(BUF);
    const mixed = new Float32Array(BUF); // float for smooth accumulation

    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      // Accumulate frequency energy from all active analysers
      mixed.fill(0);
      (Object.keys(analysers) as AudioLayer[]).forEach(layer => {
        const a = analysers[layer];
        if (!a) return;
        a.getByteFrequencyData(tmp);
        for (let i = 0; i < BUF; i++) mixed[i] += tmp[i] / 255;
      });

      ctx2d.clearRect(0, 0, w, h);

      const BAR_COUNT  = 72;
      const barW       = w / BAR_COUNT;
      // Clamp frequency range to the musically relevant lower 70% of the spectrum
      const freqRange  = Math.floor(BUF * 0.7);
      const cy         = h / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const idx = Math.floor((i / BAR_COUNT) * freqRange);
        // Divide by 4 (max 4 layers) so bars reach full height only when all are loud
        const val   = Math.min(1, mixed[idx] / 4);
        const barH  = val * cy * 0.92;

        if (barH < 0.5) continue; // skip silent bins

        // Gradient: warm reds/oranges in the bass, cooler yellows in the highs
        const hue   = 8 + (i / BAR_COUNT) * 38;   // 8° → 46° (deep red → amber)
        const light = 45 + val * 20;               // dim until loud
        const alpha = 0.3 + val * 0.7;

        // Mirrored bars — grow from centre up and down
        const grad = ctx2d.createLinearGradient(0, cy - barH, 0, cy + barH);
        grad.addColorStop(0,   `hsla(${hue}, 90%, ${light}%, 0)`);
        grad.addColorStop(0.3, `hsla(${hue}, 90%, ${light}%, ${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue + 6}, 95%, ${light + 10}%, ${alpha})`);
        grad.addColorStop(0.7, `hsla(${hue}, 90%, ${light}%, ${alpha})`);
        grad.addColorStop(1,   `hsla(${hue}, 90%, ${light}%, 0)`);

        ctx2d.fillStyle = grad;
        ctx2d.fillRect(i * barW, cy - barH, barW - 1, barH * 2);

        // Bright centre spark line
        if (val > 0.15) {
          ctx2d.fillStyle = `hsla(${hue + 10}, 100%, 80%, ${val * 0.6})`;
          ctx2d.fillRect(i * barW, cy - 1, barW - 1, 2);
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [analysers]);

  return <canvas ref={canvasRef} className="w-full h-20 rounded-b-xl" />;
}

// ============================================================
// COMPONENT: CurveGraph
// SVG line chart of all 4 layer volumes across closeness 0–100.
// Uses allVolumes() — the same pure function as the audio engine —
// so the graph is always an exact picture of what the system does.
// ============================================================
const LAYER_COLORS: Record<AudioLayer, string> = {
  l1: '#22c55e', l2: '#eab308', l3: '#f97316', chase: '#ef4444',
};
const LAYER_LABELS: Record<AudioLayer, string> = {
  l1: 'L1 Far', l2: 'L2 Mid', l3: 'L3 Close', chase: 'Chase',
};

function CurveGraph({ mixMode, crossfadeMode, closeness }: {
  mixMode: MixMode; crossfadeMode: CrossfadeMode; closeness: number;
}) {
  // Sample 101 points (one per integer closeness value).
  // Curves depend only on mix/crossfade mode — NOT on closeness — so they
  // won't recompute every frame when smooth approach is animating.
  const curves = useMemo(() => {
    const result: Record<AudioLayer, string[]> = { l1: [], l2: [], l3: [], chase: [] };
    for (let c = 0; c <= 100; c++) {
      const v = allVolumes(c, mixMode, crossfadeMode);
      (Object.keys(v) as AudioLayer[]).forEach(k => {
        result[k].push(`${c},${(1 - v[k]) * 100}`);
      });
    }
    return result;
  }, [mixMode, crossfadeMode]);

  // Playhead dot — updates with closeness but is cheap (single allVolumes call).
  const playVols = useMemo(
    () => allVolumes(closeness, mixMode, crossfadeMode),
    [closeness, mixMode, crossfadeMode],
  );

  const layers = ['l1', 'l2', 'l3', 'chase'] as AudioLayer[];

  return (
    <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-600 font-bold uppercase tracking-widest">
          Volume Curves
        </span>
        <div className="flex items-center gap-4">
          {layers.map(k => (
            <span key={k} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: LAYER_COLORS[k] }}>
              <span className="inline-block w-3 border-t-2" style={{ borderColor: LAYER_COLORS[k] }} />
              {LAYER_LABELS[k]}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative bg-neutral-950 rounded-lg px-2 pt-2 pb-5">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-28">
          {/* Horizontal gridlines at 25 / 50 / 75 % */}
          {[25, 50, 75].map(y => (
            <line key={y} x1="0" y1={y} x2="100" y2={y}
              stroke="#1f1f1f" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          {/* DBD zone boundaries */}
          {mixMode === 'dbd' && [DBD_B2, DBD_B3, DBD_END].map((b, i) => (
            <line key={i} x1={b} y1="0" x2={b} y2="100"
              stroke="#2d2d2d" strokeWidth="0.5" strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke" />
          ))}
          {/* Layer curves */}
          {layers.map(k => (
            <polyline key={k}
              points={curves[k].join(' ')}
              fill="none"
              stroke={LAYER_COLORS[k]}
              strokeWidth="1.5"
              opacity="0.85"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Playhead */}
          <line x1={closeness} y1="0" x2={closeness} y2="100"
            stroke="rgba(255,255,255,0.25)" strokeWidth="1"
            vectorEffect="non-scaling-stroke" />
          {/* Live dots on curves at current closeness */}
          {layers.map(k => {
            const v = playVols[k];
            if (v < 0.01) return null;
            return <circle key={k} cx={closeness} cy={(1 - v) * 100} r="2"
              fill={LAYER_COLORS[k]} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {/* X-axis labels */}
        <div className="absolute bottom-1 left-2 right-2 flex justify-between
                        text-[9px] text-neutral-700 font-bold select-none">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMPONENT: CompactView  (mini floating bar for use while gaming)
// ============================================================
interface CompactViewProps {
  closeness:    number;
  setCloseness: (v: number) => void;
  isPlaying:    boolean;
  togglePlay:   () => void;
  isMuted:      boolean;
  setIsMuted:   (v: boolean) => void;
  zoneName:     string;
  isChase:      boolean;
  activePreset: Preset | null;
  onExpand:     () => void;
}

function CompactView({
  closeness, setCloseness, isPlaying, togglePlay,
  isMuted, setIsMuted, zoneName, isChase,
  activePreset, onExpand,
}: CompactViewProps) {
  return (
    // data-tauri-drag-region lets the user drag the window by the empty parts of the bar
    <div
      data-tauri-drag-region
      className="h-screen bg-neutral-950 border-t-2 border-red-950 flex items-center gap-3 px-3 select-none overflow-hidden"
    >
      {/* Expand */}
      <button onClick={onExpand} title="Expand  (Ctrl+M)"
        className="text-neutral-600 hover:text-neutral-300 transition-colors flex-shrink-0 pointer-events-auto"
        data-tauri-drag-region=""  // exclude the button itself from drag
      >
        <Maximize2 size={13} />
      </button>

      {/* Preset name + zone */}
      <div className="flex-shrink-0 pointer-events-none" style={{ minWidth: 0 }}>
        <div className="text-[10px] font-black uppercase tracking-wider text-red-800 truncate"
          style={{ maxWidth: 110 }}>
          {activePreset?.name ?? '—'}
        </div>
        <div className={`text-[8px] font-bold uppercase tracking-widest leading-tight ${
          isChase ? 'text-red-500 animate-pulse' : 'text-neutral-600'
        }`}>
          {zoneName}
        </div>
      </div>

      {/* Proximity slider */}
      <input
        type="range" min="0" max="100" step="1" value={closeness}
        onChange={e => setCloseness(parseInt(e.target.value))}
        className="flex-1 accent-red-600 cursor-pointer pointer-events-auto"
        style={{ minWidth: 60 }}
      />

      {/* Closeness % */}
      <span className={`text-[11px] font-black tabular-nums w-7 text-right flex-shrink-0 pointer-events-none ${
        isChase ? 'text-red-500' : 'text-neutral-500'
      }`}>
        {isChase ? 'CH' : closeness}
      </span>

      {/* Play / Stop */}
      <button onClick={togglePlay}
        className={`flex-shrink-0 pointer-events-auto transition-colors ${
          isPlaying ? 'text-red-400' : 'text-green-500'
        }`}
      >
        {isPlaying
          ? <Square size={13} fill="currentColor" />
          : <Play   size={13} fill="currentColor" />}
      </button>

      {/* Mute */}
      <button onClick={() => setIsMuted(!isMuted)}
        className="text-neutral-600 hover:text-neutral-300 flex-shrink-0 pointer-events-auto transition-colors"
      >
        {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
    </div>
  );
}

// ============================================================
// COMPONENT: SettingsPanel  (right-side drawer, mirrors Sidebar)
// ============================================================
interface SettingsPanelProps {
  isOpen:               boolean;
  onClose:              () => void;
  // Playback
  smoothPlayStop:       boolean;
  onToggleSmoothPlay:   () => void;
  smoothApproach:       boolean;
  onToggleSmoothApproach: () => void;
  forsakenSpeed:        ForsakenSpeed;
  onSetForsakenSpeed:   (s: ForsakenSpeed) => void;
  // Display
  vignetteEnabled:      boolean;
  onToggleVignette:     () => void;
  showWaveforms:        boolean;
  onToggleWaveforms:    () => void;
  showSpectrum:         boolean;
  onToggleSpectrum:     () => void;
  showCurveGraph:       boolean;
  onToggleCurveGraph:   () => void;
  // Window
  alwaysOnTop:          boolean;
  onToggleAlwaysOnTop:  () => void;
  // Export
  onExportConfig:   () => void;
  onImportConfig:   (text: string) => boolean;
  onResetSettings:  () => void;
}

function SettingsPanel({
  isOpen, onClose,
  smoothPlayStop, onToggleSmoothPlay,
  smoothApproach, onToggleSmoothApproach,
  forsakenSpeed, onSetForsakenSpeed,
  vignetteEnabled, onToggleVignette,
  showWaveforms, onToggleWaveforms,
  showSpectrum, onToggleSpectrum,
  showCurveGraph, onToggleCurveGraph,
  alwaysOnTop, onToggleAlwaysOnTop,
  onExportConfig,
  onImportConfig,
  onResetSettings,
}: SettingsPanelProps) {
  const [copied,       setCopied]       = useState(false);
  const [importText,   setImportText]   = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [showImport,   setShowImport]   = useState(false);

  const handleExport = () => {
    onExportConfig();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Row = ({ label, hint, checked, onToggle }: {
    label: string; hint: string; checked: boolean; onToggle: () => void;
  }) => (
    <div className="flex items-center justify-between py-3 border-b border-neutral-800 last:border-0">
      <div className="pr-4">
        <p className="text-sm font-bold text-neutral-300">{label}</p>
        <p className="text-[11px] text-neutral-600 mt-0.5">{hint}</p>
      </div>
      <button onClick={onToggle} title={checked ? 'Disable' : 'Enable'}
        className={`relative w-10 h-6 rounded-full flex-shrink-0 transition-colors duration-200 ${
          checked ? 'bg-red-900' : 'bg-neutral-700'
        }`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
          checked ? 'left-5' : 'left-1'
        }`} />
      </button>
    </div>
  );

  const Section = ({ title }: { title: string }) => (
    <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest pt-1 pb-1">
      {title}
    </p>
  );

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-30" onClick={onClose} />}
      <aside className={`fixed right-0 top-0 h-screen w-72 bg-neutral-900 border-l border-neutral-800 z-40 flex flex-col transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
      }`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-800 flex-shrink-0">
          <button onClick={onClose}
            className="text-neutral-600 hover:text-neutral-200 transition-colors p-1 rounded"
          ><X size={15} /></button>
          <span className="text-xs font-black uppercase tracking-widest text-neutral-400">Settings</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

          {/* ── Playback ─────────────────────────────── */}
          <div>
            <Section title="Playback" />
            <Row label="Smooth Play / Stop"
              hint="Fade in on play and fade out on stop instead of hard cuts"
              checked={smoothPlayStop} onToggle={onToggleSmoothPlay} />
            <Row label="Smooth Approach"
              hint="Animate proximity toward the slider target instead of jumping instantly"
              checked={smoothApproach} onToggle={onToggleSmoothApproach} />
            {/* Forsaken transition speed */}
            <div className="py-3 border-b border-neutral-800">
              <p className="text-sm font-bold text-neutral-300">Forsaken Speed</p>
              <p className="text-[11px] text-neutral-600 mt-0.5 mb-2">
                How fast layers crossfade when the zone changes
              </p>
              <div className="bg-neutral-950 p-0.5 rounded-lg inline-flex w-full">
                {(['slow', 'normal', 'fast'] as ForsakenSpeed[]).map(s => (
                  <button key={s} onClick={() => onSetForsakenSpeed(s)}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                      forsakenSpeed === s
                        ? 'bg-red-900 text-white'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >{s}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Display ──────────────────────────────── */}
          <div>
            <Section title="Display" />
            <Row label="Proximity Vignette"
              hint="Red overlay on screen edges that intensifies as the killer closes in"
              checked={vignetteEnabled} onToggle={onToggleVignette} />
            <Row label="Layer Waveforms"
              hint="Oscilloscope waveform on each layer card"
              checked={showWaveforms} onToggle={onToggleWaveforms} />
            <Row label="Frequency Spectrum"
              hint="Combined frequency bars at the bottom of the controls card"
              checked={showSpectrum} onToggle={onToggleSpectrum} />
            <Row label="Volume Curve Graph"
              hint="SVG chart of the 4 layer volume curves — useful for porting"
              checked={showCurveGraph} onToggle={onToggleCurveGraph} />
          </div>

          {/* ── Window ───────────────────────────────── */}
          <div>
            <Section title="Window" />
            <Row label="Always on Top"
              hint="Keep the window above all other apps — useful while gaming"
              checked={alwaysOnTop} onToggle={onToggleAlwaysOnTop} />
            <div className="py-3 border-b border-neutral-800">
              <p className="text-sm font-bold text-neutral-300">Compact Mode</p>
              <p className="text-[11px] text-neutral-600 mt-0.5">
                Resize to a mini floating bar.{' '}
                <kbd className="bg-neutral-800 text-neutral-400 px-1 rounded text-[9px]">Ctrl+M</kbd>
              </p>
            </div>
          </div>

          {/* ── Export / Import ──────────────────────── */}
          <div>
            <Section title="Config" />
            <div className="py-3 border-b border-neutral-800">
              <p className="text-[11px] text-neutral-600 mb-2">
                Export all settings + URLs as JSON, or paste one back to restore.
              </p>
              <div className="flex gap-2 mb-2">
                <button onClick={handleExport}
                  className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all ${
                    copied
                      ? 'bg-green-900/30 text-green-400 border-green-800'
                      : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-neutral-700 hover:border-neutral-500'
                  }`}
                >
                  {copied ? '✓ Copied!' : 'Export JSON'}
                </button>
                <button onClick={() => { setShowImport(v => !v); setImportStatus('idle'); }}
                  className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all ${
                    showImport
                      ? 'bg-red-900/30 text-red-300 border-red-800'
                      : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border-neutral-700 hover:border-neutral-500'
                  }`}
                >
                  Import JSON
                </button>
              </div>
              {showImport && (
                <div className="space-y-1.5">
                  <textarea
                    autoFocus
                    rows={5}
                    value={importText}
                    onChange={e => {
                      setImportText(e.target.value);
                      if (e.target.value.trim()) {
                        const ok = onImportConfig(e.target.value);
                        setImportStatus(ok ? 'ok' : 'err');
                      } else {
                        setImportStatus('idle');
                      }
                    }}
                    placeholder={'Paste exported JSON here…\n\nSettings are applied live\nas you type.'}
                    className={`w-full bg-neutral-950 text-neutral-400 text-[10px] font-mono rounded p-2 border resize-none focus:outline-none transition-colors ${
                      importStatus === 'ok'  ? 'border-green-700 text-green-400' :
                      importStatus === 'err' ? 'border-red-800' :
                      'border-neutral-800 focus:border-neutral-600'
                    }`}
                  />
                  <p className={`text-[10px] font-bold ${
                    importStatus === 'ok'  ? 'text-green-500' :
                    importStatus === 'err' ? 'text-red-500' :
                    'text-neutral-700'
                  }`}>
                    {importStatus === 'ok'  ? '✓ Settings applied' :
                     importStatus === 'err' ? '✗ Invalid JSON'     : 'Waiting for input…'}
                  </p>
                </div>
              )}
            </div>

            {/* Reset */}
            <div className="py-3">
              <p className="text-[11px] text-neutral-600 mb-2">
                Clear all saved settings and reload with defaults.
              </p>
              <button onClick={onResetSettings}
                className="w-full text-xs font-bold py-2 rounded-lg border border-neutral-800 text-neutral-600 hover:text-red-400 hover:border-red-900 transition-all"
              >
                Reset to defaults
              </button>
            </div>
          </div>

        </div>
      </aside>
    </>
  );
}

// ============================================================
// APP
// ============================================================

// Default to empty — user picks a preset or pastes URLs manually
const EMPTY_URLS: AudioUrls = { l1: '', l2: '', l3: '', chase: '' };

// ── Built-in presets ────────────────────────────────────────────────────────
const BUILTIN_PRESETS: Preset[] = [
  {
    id:   'curtains-call',
    name: 'CURTAINS_CALL',
    defaultMixMode: 'forsaken',
    urls: {
      l1:    'https://static.wikia.nocookie.net/forsaken2024/images/3/39/CURTAINS_CALLLayer1.ogg',
      l2:    'https://static.wikia.nocookie.net/forsaken2024/images/8/88/CURTAINS_CALLLayer2.ogg',
      l3:    'https://static.wikia.nocookie.net/forsaken2024/images/8/89/CURTAINS_CALLLayer3.ogg',
      chase: 'https://static.wikia.nocookie.net/forsaken2024/images/6/67/CURTAINS_CALLChase.ogg',
    },
  },
  {
    id:   'nil-incident',
    name: 'Nil.Incident',
    defaultMixMode: 'forsaken',
    urls: {
      l1:    'https://static.wikia.nocookie.net/forsaken2024/images/2/22/JX1Layer1_%281%29.ogg',
      l2:    'https://static.wikia.nocookie.net/forsaken2024/images/2/2f/JX1Layer2_%281%29.ogg',
      l3:    'https://static.wikia.nocookie.net/forsaken2024/images/1/1b/JX1Layer3_%281%29.ogg',
      chase: 'https://static.wikia.nocookie.net/forsaken2024/images/1/16/JX1CHASE_%281%29.ogg',
    },
  },
  {
    id:   'singularity',
    name: 'The Singularity',
    defaultMixMode: 'dbd',
    urls: {
      l1:    'https://raw.githubusercontent.com/Masusder/DBDSounds/main/Converted%20Files/Output_Deprecated/SFX/Music/TerrorRadius/mu_terrorradius_k32_layer_01.ogg',
      l2:    'https://raw.githubusercontent.com/Masusder/DBDSounds/main/Converted%20Files/Output_Deprecated/SFX/Music/TerrorRadius/mu_terrorradius_k32_layer_02.ogg',
      l3:    'https://raw.githubusercontent.com/Masusder/DBDSounds/main/Converted%20Files/Output_Deprecated/SFX/Music/TerrorRadius/mu_terrorradius_k32_layer_03.ogg',
      chase: 'https://raw.githubusercontent.com/Masusder/DBDSounds/main/Converted%20Files/Output_Deprecated/SFX/Music/TerrorRadius/mu_terrorradius_k32_layer_04.ogg',
    },
  },
];

export default function App() {
  const [closeness,    setCloseness]    = useState(0);
  const [sliderTarget, setSliderTarget] = useState(0); // where the user aims; closeness animates toward it
  const [isMuted,      setIsMuted]      = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactMode,  setCompactMode]  = useState(false);
  const [showHelp,     setShowHelp]     = useState(false);
  // Per-layer solo/mute — not persisted; reset on reload is intentional
  const [mutedLayers,  setMutedLayers]  = useState<Partial<Record<AudioLayer, boolean>>>({});
  const [soloedLayers, setSoloedLayers] = useState<Partial<Record<AudioLayer, boolean>>>({});

  // Persisted across page refreshes via localStorage
  const [mixMode,          setMixMode]          = usePersistedState<MixMode>('tr_mixMode',      'dbd');
  const [masterVolume,     setMasterVolume]      = usePersistedState<number>('tr_masterVolume',  1);
  const [crossfadeMode,    setCrossfadeMode]     = usePersistedState<CrossfadeMode>('tr_xfade',  'linear');
  const [audioUrls,        setAudioUrls]         = usePersistedState<AudioUrls>('tr_audioUrls',  EMPTY_URLS);
  const [userFavorites,    setUserFavorites]     = usePersistedState<Preset[]>('tr_favorites',   []);
  const [vignetteEnabled,  setVignetteEnabled]   = usePersistedState<boolean>('tr_vignette',     true);
  const [alwaysOnTop,      setAlwaysOnTop]       = usePersistedState<boolean>('tr_aot',          false);
  const [showCurveGraph,   setShowCurveGraph]    = usePersistedState<boolean>('tr_curve',        true);
  const [smoothApproach,   setSmoothApproach]    = usePersistedState<boolean>('tr_smooth',       false);
  const [smoothPlayStop,   setSmoothPlayStop]    = usePersistedState<boolean>('tr_smooth_play',  true);
  const [showWaveforms,    setShowWaveforms]     = usePersistedState<boolean>('tr_waveforms',    true);
  const [showSpectrum,     setShowSpectrum]      = usePersistedState<boolean>('tr_spectrum',     true);
  const [forsakenSpeed,    setForsakenSpeed]     = usePersistedState<ForsakenSpeed>('tr_fspeed', 'normal');

  // ── Tauri window helpers (no-op when running as a plain web page) ──────────
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const tauriWindow = useCallback(async () => {
    if (!isTauri) return null;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }, [isTauri]);

  // Sync always-on-top with Tauri whenever it changes
  useEffect(() => {
    tauriWindow().then(win => win?.setAlwaysOnTop(alwaysOnTop));
  }, [alwaysOnTop, tauriWindow]);

  const enterCompact = useCallback(async () => {
    setCompactMode(true);
    const win = await tauriWindow();
    if (win) {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      await win.setAlwaysOnTop(true);
      await win.setSize(new LogicalSize(480, 96));
    }
  }, [tauriWindow]);

  const exitCompact = useCallback(async () => {
    setCompactMode(false);
    const win = await tauriWindow();
    if (win) {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      await win.setAlwaysOnTop(alwaysOnTop); // restore user's preference
      await win.setSize(new LogicalSize(900, 640));
    }
  }, [alwaysOnTop, tauriWindow]);

  // Solo/mute overrides: if any layer is soloed only soloed layers are heard
  const layerOverrides = useMemo<Record<AudioLayer, number>>(() => {
    const hasSolo = Object.values(soloedLayers).some(Boolean);
    return {
      l1:    mutedLayers.l1    ? 0 : hasSolo && !soloedLayers.l1    ? 0 : 1,
      l2:    mutedLayers.l2    ? 0 : hasSolo && !soloedLayers.l2    ? 0 : 1,
      l3:    mutedLayers.l3    ? 0 : hasSolo && !soloedLayers.l3    ? 0 : 1,
      chase: mutedLayers.chase ? 0 : hasSolo && !soloedLayers.chase ? 0 : 1,
    };
  }, [mutedLayers, soloedLayers]);

  const {
    isPlaying, errors, loadingLayers, analysers,
    volL1, volL2, volL3, volChase,
    togglePlay,
  } = useAudioEngine({ closeness, mixMode, audioUrls, masterVolume, isMuted, crossfadeMode, layerOverrides, smoothPlayStop, forsakenSpeed });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Space — play/pause  |  ← / → — proximity ±1%  |  Shift+← / → — ±5%  |  Ctrl+M — compact
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (e.code === 'KeyM' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        compactMode ? exitCompact() : enterCompact();
        return;
      }
      const step = e.shiftKey ? 5 : 1;
      if (e.code === 'ArrowRight') { e.preventDefault(); setSliderTarget(t => Math.min(100, t + step)); }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); setSliderTarget(t => Math.max(0,   t - step)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlay, compactMode, enterCompact, exitCompact]);

  // ── Smooth approach — animate closeness toward the slider target ─────────
  // When OFF: effect below syncs immediately (one-render delay, imperceptible).
  // When ON:  RAF loop lerps at 12% per frame (~60fps → full travel in ~300ms).
  useEffect(() => {
    if (smoothApproach) return;
    setCloseness(sliderTarget);
  }, [sliderTarget, smoothApproach]);

  useEffect(() => {
    if (!smoothApproach) return;
    let rafId = 0;
    const step = () => {
      rafId = requestAnimationFrame(step);
      startTransition(() => {
        setCloseness(prev => {
          const diff = sliderTarget - prev;
          if (Math.abs(diff) < 0.25) return sliderTarget;
          return prev + diff * 0.12;
        });
      });
    };
    step();
    return () => cancelAnimationFrame(rafId);
  }, [sliderTarget, smoothApproach]);

  // ── Screen Wake Lock — keep display on while playing (critical for Android) ─
  useEffect(() => {
    type WL = { request: (type: string) => Promise<{ release: () => void }> };
    if (!('wakeLock' in navigator)) return;
    let sentinel: { release: () => void } | null = null;
    let cancelled = false; // guards the async gap: if cleanup fires before await resolves, release immediately
    const acquire = async () => {
      if (!isPlaying || document.visibilityState !== 'visible') return;
      try {
        const wl = await (navigator as unknown as { wakeLock: WL }).wakeLock.request('screen');
        if (cancelled) { wl.release(); return; }
        sentinel = wl;
      }
      catch { /* permission denied or not supported */ }
    };
    const onVisibility = () => { if (isPlaying) acquire(); };
    if (isPlaying) acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release();
    };
  }, [isPlaying]);
  const activePreset = useMemo(() =>
    [...BUILTIN_PRESETS, ...userFavorites].find(p =>
      (Object.keys(p.urls) as AudioLayer[]).every(k => p.urls[k] === audioUrls[k])
    ) ?? null,
  [audioUrls, userFavorites]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play',  () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    return () => {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.setActionHandler('play',  null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [togglePlay]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  activePreset?.name ?? 'Custom Setup',
      artist: 'Terror Radius System',
    });
  }, [activePreset]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const loadPreset = useCallback((p: Preset) => {
    setAudioUrls(p.urls);
    if (p.defaultMixMode) setMixMode(p.defaultMixMode);
  }, [setAudioUrls, setMixMode]);
  const deleteFav  = useCallback((id: string) =>
    setUserFavorites(prev => prev.filter(f => f.id !== id)), [setUserFavorites]);
  const saveFav    = useCallback((name: string) =>
    setUserFavorites(prev => [...prev, {
      id: `fav-${Date.now()}`, name,
      urls: { ...audioUrls },
      defaultMixMode: mixMode,  // remember which mode this preset was made in
    }]),
  [audioUrls, mixMode, setUserFavorites]);

  const exportConfig = useCallback(() => {
    // Read localStorage directly for arrays to avoid stale-closure issues
    // in browsers (e.g. Thorium) that don't always recreate the callback.
    const readLS = <T,>(key: string, fallback: T): T => {
      try {
        const item = localStorage.getItem(key);
        return item !== null ? (JSON.parse(item) as T) : fallback;
      } catch { return fallback; }
    };

    const cfg = {
      version:        1,
      mixMode,
      crossfadeMode,
      forsakenSpeed,
      smoothPlayStop,
      smoothApproach,
      vignetteEnabled,
      showWaveforms,
      showSpectrum,
      showCurveGraph,
      activePreset:   activePreset?.name ?? null,
      savedPresets:   readLS<Preset[]>('tr_favorites', []),
      dbd_boundaries: { start: DBD_START, b2: +DBD_B2.toFixed(2), b3: +DBD_B3.toFixed(2), end: DBD_END },
      dbd_zone_width: +DBD_ZONE.toFixed(2),
      urls:           readLS<AudioUrls>('tr_audioUrls', audioUrls),
    };
    navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).catch(() => {
      prompt('Copy this config:', JSON.stringify(cfg, null, 2));
    });
  }, [mixMode, crossfadeMode, forsakenSpeed, smoothPlayStop, smoothApproach,
      vignetteEnabled, showWaveforms, showSpectrum, showCurveGraph,
      activePreset, audioUrls]);

  // Restore all validated fields from a pasted JSON string. Returns true on success.
  const importConfig = useCallback((text: string): boolean => {
    try {
      const c = JSON.parse(text);
      if (c.mixMode       && ['dbd','forsaken'].includes(c.mixMode))               setMixMode(c.mixMode);
      if (c.crossfadeMode && ['linear','equal-power'].includes(c.crossfadeMode))  setCrossfadeMode(c.crossfadeMode);
      if (c.forsakenSpeed && ['slow','normal','fast'].includes(c.forsakenSpeed))  setForsakenSpeed(c.forsakenSpeed);
      if (typeof c.smoothPlayStop  === 'boolean') setSmoothPlayStop(c.smoothPlayStop);
      if (typeof c.smoothApproach  === 'boolean') setSmoothApproach(c.smoothApproach);
      if (typeof c.vignetteEnabled === 'boolean') setVignetteEnabled(c.vignetteEnabled);
      if (typeof c.showWaveforms   === 'boolean') setShowWaveforms(c.showWaveforms);
      if (typeof c.showSpectrum    === 'boolean') setShowSpectrum(c.showSpectrum);
      if (typeof c.showCurveGraph  === 'boolean') setShowCurveGraph(c.showCurveGraph);
      if (c.urls && typeof c.urls === 'object') {
        const layers: AudioLayer[] = ['l1','l2','l3','chase'];
        if (layers.every(l => typeof c.urls[l] === 'string')) setAudioUrls(c.urls as AudioUrls);
      }
      if (Array.isArray(c.savedPresets)) {
        const layers: AudioLayer[] = ['l1','l2','l3','chase'];
        const valid = (c.savedPresets as unknown[]).filter((p): p is Preset =>
          typeof p === 'object' && p !== null &&
          typeof (p as Preset).id   === 'string' &&
          typeof (p as Preset).name === 'string' &&
          typeof (p as Preset).urls === 'object' &&
          layers.every(l => typeof (p as Preset).urls[l] === 'string')
        );
        if (valid.length > 0) setUserFavorites(valid);
      }
      return true;
    } catch { return false; }
  }, [setMixMode, setCrossfadeMode, setForsakenSpeed, setSmoothPlayStop, setSmoothApproach,
      setVignetteEnabled, setShowWaveforms, setShowSpectrum, setShowCurveGraph,
      setAudioUrls, setUserFavorites]);

  const resetSettings = useCallback(() => {
    ['tr_mixMode','tr_masterVolume','tr_xfade','tr_audioUrls','tr_favorites',
     'tr_vignette','tr_aot','tr_curve','tr_smooth','tr_smooth_play',
     'tr_waveforms','tr_spectrum','tr_fspeed'].forEach(k => localStorage.removeItem(k));
    window.location.reload();
  }, []);

  const toggleMute = useCallback((layer: AudioLayer) => {
    setMutedLayers(prev  => ({ ...prev,  [layer]: !prev[layer]  }));
    setSoloedLayers(prev => ({ ...prev,  [layer]: false         })); // muting clears solo
  }, []);
  const toggleSolo = useCallback((layer: AudioLayer) => {
    setSoloedLayers(prev => ({ ...prev,  [layer]: !prev[layer]  }));
    setMutedLayers(prev  => ({ ...prev,  [layer]: false         })); // soloing clears mute
  }, []);

  const handleUrlChange = useCallback((layer: AudioLayer, value: string) => {
    setAudioUrls(prev => ({ ...prev, [layer]: value }));
  }, [setAudioUrls]);

  const volumes  = { l1: volL1, l2: volL2, l3: volL3, chase: volChase } as Record<AudioLayer, number>;
  const isChase  = getZone(closeness) === 4;
  const zoneName = ZONE_LABELS[getZone(closeness)];

  // ── Compact mode — render a single tiny bar, skip the full UI ────────────
  if (compactMode) {
    return (
      <CompactView
        closeness={sliderTarget}  setCloseness={setSliderTarget}
        isPlaying={isPlaying}    togglePlay={togglePlay}
        isMuted={isMuted}        setIsMuted={setIsMuted}
        zoneName={zoneName}      isChase={isChase}
        activePreset={activePreset}
        onExpand={exitCompact}
      />
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans p-6 selection:bg-red-900">

      {/* ── Keyboard shortcuts help ─────────────────────────────── */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}>
          <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 w-full max-w-xs shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-black uppercase tracking-widest text-neutral-300">
                Shortcuts
              </span>
              <button onClick={() => setShowHelp(false)}
                className="text-neutral-600 hover:text-neutral-200 transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-0">
              {([
                ['Space',       'Play / Pause'],
                ['← →',         'Proximity ±1%'],
                ['Shift + ← →', 'Proximity ±5%'],
                ['Ctrl + M',    'Toggle compact mode'],
              ] as [string, string][]).map(([key, desc]) => (
                <div key={key}
                  className="flex items-center justify-between py-2.5 border-b border-neutral-800 last:border-0">
                  <span className="text-xs text-neutral-500">{desc}</span>
                  <kbd className="bg-neutral-800 border border-neutral-700 text-neutral-300
                                  px-2 py-0.5 rounded text-[10px] font-mono ml-3 flex-shrink-0">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Proximity vignette — intensifies as the killer closes in ─── */}
      {vignetteEnabled && (
        <div
          className="fixed inset-0 pointer-events-none z-10 transition-all duration-300"
          style={{
            background: `radial-gradient(ellipse at center, transparent 35%, rgba(180,0,0,${
              Math.pow(Math.min(closeness, 99) / 99, 2.2) * 0.38
            }) 100%)`,
          }}
        />
      )}

      {/* ── Presets sidebar ─────────────────────────────── */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        builtins={BUILTIN_PRESETS}
        favorites={userFavorites}
        activeId={activePreset?.id ?? null}
        onLoad={loadPreset}
        onDelete={deleteFav}
        onSave={saveFav}
      />

      {/* ── Settings panel ───────────────────────────────── */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        smoothPlayStop={smoothPlayStop}
        onToggleSmoothPlay={() => setSmoothPlayStop(v => !v)}
        smoothApproach={smoothApproach}
        onToggleSmoothApproach={() => setSmoothApproach(v => !v)}
        forsakenSpeed={forsakenSpeed}
        onSetForsakenSpeed={setForsakenSpeed}
        vignetteEnabled={vignetteEnabled}
        onToggleVignette={() => setVignetteEnabled(v => !v)}
        showWaveforms={showWaveforms}
        onToggleWaveforms={() => setShowWaveforms(v => !v)}
        showSpectrum={showSpectrum}
        onToggleSpectrum={() => setShowSpectrum(v => !v)}
        showCurveGraph={showCurveGraph}
        onToggleCurveGraph={() => setShowCurveGraph(v => !v)}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={() => setAlwaysOnTop(v => !v)}
        onExportConfig={exportConfig}
        onImportConfig={importConfig}
        onResetSettings={resetSettings}
      />

      <div className="max-w-4xl mx-auto space-y-6">

        {/* ── Header ────────────────────────────────────────── */}
        <header className="border-b border-red-900/40 pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setSidebarOpen(true)}
                title="Presets"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0"
              >
                <PanelLeft size={18} />
              </button>
              {/* Compact mode — only useful as a Tauri app */}
              {isTauri && (
                <button onClick={enterCompact} title="Compact mode  (Ctrl+M)"
                  className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0"
                >
                  <Maximize2 size={16} className="rotate-180" />
                </button>
              )}
              <div className="min-w-0">
                <h1 className="text-4xl font-black text-red-600 tracking-tighter uppercase">
                  Terror Radius System
                </h1>
                {activePreset ? (
                  <p className="text-neutral-600 mt-1 text-sm">
                    <span className="text-red-800 font-bold uppercase tracking-wider">{activePreset.name}</span>
                    <span className="text-neutral-700"> · </span>
                    <span>Dynamic "X" crossfade</span>
                  </p>
                ) : (
                  <p className="text-neutral-500 mt-1 text-sm">
                    Dynamic "X" crossfade — the outgoing layer fades out as the incoming one fades in.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setShowHelp(true)}
                title="Keyboard shortcuts"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-600 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <HelpCircle size={16} />
              </button>
              <button onClick={() => setSettingsOpen(true)}
                title="Settings"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <PanelRight size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* ── Main controls card ──────────────────────────── */}
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl overflow-hidden">

          {/* Mix mode + crossfade curve */}
          <div className="flex flex-col items-center px-8 pt-6 pb-5 gap-5 border-b border-neutral-800">
            <div className="flex flex-col md:flex-row items-center gap-5 md:gap-10 w-full justify-center">

              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-neutral-600 font-bold uppercase tracking-widest">Mix Mode</span>
                <div className="bg-neutral-950 p-1 rounded-lg inline-flex">
                  {(['dbd', 'forsaken'] as MixMode[]).map(mode => (
                    <button key={mode} onClick={() => setMixMode(mode)}
                      className={`px-5 py-2 rounded-md text-xs font-bold uppercase tracking-wide transition-all ${
                        mixMode === mode
                          ? 'bg-red-900 text-white shadow-[0_0_12px_rgba(220,38,38,0.25)]'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {mode === 'dbd' ? 'Dead by Daylight' : 'Forsaken'}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`flex flex-col items-center gap-2 transition-opacity duration-300 ${
                mixMode === 'dbd' ? 'opacity-100' : 'opacity-25'
              }`}>
                <span className="text-xs text-neutral-600 font-bold uppercase tracking-widest">Crossfade Curve</span>
                <div className="bg-neutral-950 p-1 rounded-lg inline-flex">
                  {(['linear', 'equal-power'] as CrossfadeMode[]).map(mode => (
                    <button key={mode} onClick={() => setCrossfadeMode(mode)}
                      className={`px-3 py-2 rounded-md text-xs font-bold uppercase tracking-wide transition-all ${
                        crossfadeMode === mode
                          ? 'bg-red-900 text-white shadow-[0_0_12px_rgba(220,38,38,0.25)]'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {mode === 'linear' ? 'Linear' : 'Equal-Power'}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Play + proximity slider + volume */}
          <div className="flex flex-col md:flex-row items-center gap-6 px-8 py-6">

            <button onClick={togglePlay} title="Play / Pause  (Space)"
              className={`flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 flex-shrink-0 ${
                isPlaying
                  ? 'bg-red-950 text-red-400 hover:bg-red-900 border border-red-800 shadow-[0_0_24px_rgba(220,38,38,0.25)]'
                  : 'bg-neutral-800 text-green-400 hover:bg-neutral-700 border border-neutral-700'
              }`}
            >
              {isPlaying
                ? <Square size={20} fill="currentColor" />
                : <Play   size={24} fill="currentColor" className="ml-1" />}
            </button>

            <div className="flex-1 w-full space-y-2">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide">Killer Proximity</h2>
                  <p className="text-xs text-neutral-600">Drag to simulate distance</p>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-black tabular-nums leading-none ${
                    isChase ? 'text-red-500 animate-pulse' : 'text-neutral-300'
                  }`}>
                    {isChase ? 'CHASE' : `${Math.round(closeness)}%`}
                  </div>
                  <div className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${
                    isChase ? 'text-red-500' : 'text-neutral-500'
                  }`}>
                    {zoneName}
                    {smoothApproach && sliderTarget !== Math.round(closeness) && (
                      <span className="text-neutral-700 ml-1">→{sliderTarget}%</span>
                    )}
                  </div>
                </div>
              </div>
              <input type="range" min="0" max="100" step="1"
                value={sliderTarget}
                onChange={e => setSliderTarget(parseInt(e.target.value))}
                className="w-full h-2 bg-neutral-800 rounded-full appearance-none cursor-pointer accent-red-600"
                title="← → fine adjust  ·  Shift+← → coarse adjust"
              />
              {/* Zone color band — shows the active layer boundaries at a glance */}
              <div className="w-full h-1 rounded-full overflow-hidden opacity-40"
                style={{ background: mixMode === 'forsaken'
                  ? 'linear-gradient(to right, transparent 0%, transparent 1%, #22c55e 1%, #22c55e 33%, #eab308 34%, #eab308 66%, #f97316 67%, #f97316 99%, #ef4444 99%, #ef4444 100%)'
                  : 'linear-gradient(to right, transparent 0%, transparent 1%, #22c55e 1%, #22c55e 33.67%, #eab308 66.33%, #f97316 99%, #ef4444 99%, #ef4444 100%)'
                }}
              />
              <div className="flex justify-between text-[10px] text-neutral-600 font-bold uppercase">
                <span>Safe — 0%</span>
                <span>Chase — 100%</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <button onClick={() => setIsMuted(!isMuted)}
                className="p-3 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={masterVolume}
                onChange={e => setMasterVolume(parseFloat(e.target.value))}
                className="w-14 accent-red-600 cursor-pointer" title="Master volume"
              />
              <span className="text-[10px] text-neutral-600 font-bold tabular-nums">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>
          </div>

          {/* Master frequency spectrum — only when enabled */}
          {showSpectrum && <MasterVisualizer analysers={analysers} />}
        </div>

        {/* ── Volume curves graph — shows the design, not the output ───── */}
        {showCurveGraph && (
          <CurveGraph
            mixMode={mixMode}
            crossfadeMode={crossfadeMode}
            closeness={closeness}
          />
        )}

        {/* ── Layer cards ───────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LAYERS.map(layer => (
            <LayerCard
              key={layer.key}
              config={layer}
              mixMode={mixMode}
              volume={volumes[layer.key]}
              url={audioUrls[layer.key]}
              onUrlChange={v => handleUrlChange(layer.key, v)}
              hasError={!!errors[layer.key]}
              analyser={analysers[layer.key]}
              isLoading={!!loadingLayers[layer.key]}
              isLayerMuted={!!mutedLayers[layer.key]}
              isLayerSoloed={!!soloedLayers[layer.key]}
              onMute={() => toggleMute(layer.key)}
              onSolo={() => toggleSolo(layer.key)}
              showWaveform={showWaveforms}
            />
          ))}
        </div>
      </div>
    </div>
  );
}