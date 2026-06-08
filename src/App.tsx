// ============================================================
// App.tsx — orquestra estado e conecta os componentes.
// Sub-componentes vivem em src/components/
// Lógica de áudio em src/hooks/useAudioEngine.ts
// Funções puras em src/utils/audioMath.ts
// Constantes em src/constants.ts
// ============================================================

import React, {
  useState, useEffect, useMemo, useCallback,
  useRef, startTransition,
} from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import {
  Play, Square, Volume2, VolumeX,
  PanelLeft, PanelRight, Maximize2, HelpCircle, X,
} from 'lucide-react';

import type { AudioLayer, AudioUrls, CrossfadeMode, ForsakenSpeed, MixMode, Preset } from './types';
import {
  LAYERS, BUILTIN_PRESETS, EMPTY_URLS, ZONE_LABELS,
  DBD_START, DBD_B2, DBD_B3, DBD_END, DBD_ZONE,
} from './constants';
import { getZone } from './utils/audioMath';
import { usePersistedState } from './hooks/usePersistedState';
import { useAudioEngine }    from './hooks/useAudioEngine';

import { LayerCard }       from './components/LayerCard';
import { MasterVisualizer } from './components/MasterVisualizer';
import { CurveGraph }       from './components/CurveGraph';
import { Sidebar }          from './components/Sidebar';
import { SettingsPanel }    from './components/SettingsPanel';
import { CompactView }      from './components/CompactView';

export default function App() {
  const [closeness,    setCloseness]    = useState(0);
  const [sliderTarget, setSliderTarget] = useState(0);
  const [isMuted,      setIsMuted]      = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactMode,  setCompactMode]  = useState(false);
  const [showHelp,     setShowHelp]     = useState(false);
  const [mutedLayers,  setMutedLayers]  = useState<Partial<Record<AudioLayer, boolean>>>({});
  const [soloedLayers, setSoloedLayers] = useState<Partial<Record<AudioLayer, boolean>>>({});

  // ── Estado persistido ──────────────────────────────────────────────────────
  const [mixMode,         setMixMode]         = usePersistedState<MixMode>('tr_mixMode',      'dbd');
  const [masterVolume,    setMasterVolume]     = usePersistedState<number>('tr_masterVolume',  1);
  const [crossfadeMode,   setCrossfadeMode]    = usePersistedState<CrossfadeMode>('tr_xfade',  'linear');
  const [audioUrls,       setAudioUrls]        = usePersistedState<AudioUrls>('tr_audioUrls',  EMPTY_URLS);
  const [userFavorites,   setUserFavorites]    = usePersistedState<Preset[]>('tr_favorites',   []);
  const [vignetteEnabled, setVignetteEnabled]  = usePersistedState<boolean>('tr_vignette',     true);
  const [alwaysOnTop,     setAlwaysOnTop]      = usePersistedState<boolean>('tr_aot',          false);
  const [showCurveGraph,  setShowCurveGraph]   = usePersistedState<boolean>('tr_curve',        true);
  const [smoothApproach,  setSmoothApproach]   = usePersistedState<boolean>('tr_smooth',       false);
  const [smoothPlayStop,  setSmoothPlayStop]   = usePersistedState<boolean>('tr_smooth_play',  true);
  const [showWaveforms,   setShowWaveforms]    = usePersistedState<boolean>('tr_waveforms',    true);
  const [showSpectrum,    setShowSpectrum]     = usePersistedState<boolean>('tr_spectrum',     true);
  const [forsakenSpeed,   setForsakenSpeed]    = usePersistedState<ForsakenSpeed>('tr_fspeed', 'normal');

  // ── Tauri helpers (no-op no browser) ─────────────────────────────────────
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const tauriWindow = useCallback(async () => {
    if (!isTauri) return null;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }, [isTauri]);

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
      await win.setAlwaysOnTop(alwaysOnTop);
      await win.setSize(new LogicalSize(900, 640));
    }
  }, [alwaysOnTop, tauriWindow]);

  // ── Solo / Mute por layer ─────────────────────────────────────────────────
  const layerOverrides = useMemo<Record<AudioLayer, number>>(() => {
    const hasSolo = Object.values(soloedLayers).some(Boolean);
    return {
      l1:    mutedLayers.l1    ? 0 : hasSolo && !soloedLayers.l1    ? 0 : 1,
      l2:    mutedLayers.l2    ? 0 : hasSolo && !soloedLayers.l2    ? 0 : 1,
      l3:    mutedLayers.l3    ? 0 : hasSolo && !soloedLayers.l3    ? 0 : 1,
      chase: mutedLayers.chase ? 0 : hasSolo && !soloedLayers.chase ? 0 : 1,
    };
  }, [mutedLayers, soloedLayers]);

  // ── Audio engine ──────────────────────────────────────────────────────────
  const {
    isPlaying, errors, loadingLayers, analysers,
    volL1, volL2, volL3, volChase,
    togglePlay,
  } = useAudioEngine({
    closeness, mixMode, audioUrls, masterVolume,
    isMuted, crossfadeMode, layerOverrides,
    smoothPlayStop, forsakenSpeed,
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
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

  // ── Smooth approach ───────────────────────────────────────────────────────
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

  // ── Screen Wake Lock (Android / mobile) ───────────────────────────────────
  useEffect(() => {
    type WL = { request: (type: string) => Promise<{ release: () => void }> };
    if (!('wakeLock' in navigator)) return;
    let sentinel: { release: () => void } | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (!isPlaying || document.visibilityState !== 'visible') return;
      try {
        const wl = await (navigator as unknown as { wakeLock: WL }).wakeLock.request('screen');
        if (cancelled) { wl.release(); return; }
        sentinel = wl;
      } catch {}
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

  // ── activePreset ──────────────────────────────────────────────────────────
  const activePreset = useMemo(() =>
    [...BUILTIN_PRESETS, ...userFavorites].find(p =>
      (Object.keys(p.urls) as AudioLayer[]).every(k => p.urls[k] === audioUrls[k])
    ) ?? null,
  [audioUrls, userFavorites]);

  // ── Media Session ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play',  () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    return () => {
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

  // ── Helpers: presets ──────────────────────────────────────────────────────
  const loadPreset = useCallback((p: Preset) => {
    setAudioUrls(p.urls);
    if (p.defaultMixMode) setMixMode(p.defaultMixMode);
  }, [setAudioUrls, setMixMode]);

  const deleteFav = useCallback((id: string) =>
    setUserFavorites(prev => prev.filter(f => f.id !== id)),
  [setUserFavorites]);

  const saveFav = useCallback((name: string) =>
    setUserFavorites(prev => [...prev, {
      id: `fav-${Date.now()}`, name,
      urls: { ...audioUrls },
      defaultMixMode: mixMode,
    }]),
  [audioUrls, mixMode, setUserFavorites]);

  // ── Helpers: URL change ───────────────────────────────────────────────────
  const handleUrlChange = useCallback((layer: AudioLayer, value: string) => {
    setAudioUrls(prev => ({ ...prev, [layer]: value }));
  }, [setAudioUrls]);

  // ── Helpers: mute / solo ──────────────────────────────────────────────────
  const toggleMute = useCallback((layer: AudioLayer) => {
    setMutedLayers(prev  => ({ ...prev, [layer]: !prev[layer]  }));
    setSoloedLayers(prev => ({ ...prev, [layer]: false         }));
  }, []);

  const toggleSolo = useCallback((layer: AudioLayer) => {
    setSoloedLayers(prev => ({ ...prev, [layer]: !prev[layer]  }));
    setMutedLayers(prev  => ({ ...prev, [layer]: false         }));
  }, []);

  // ── Export / Import ───────────────────────────────────────────────────────
  // FIX: usando useRef para capturar os valores mais recentes sem stale closure.
  // Antes: lia localStorage diretamente como workaround.
  // Agora: ref sempre sincronizado com o estado atual via useEffect.
  const exportStateRef = useRef({
    mixMode, crossfadeMode, forsakenSpeed, smoothPlayStop, smoothApproach,
    vignetteEnabled, showWaveforms, showSpectrum, showCurveGraph,
    audioUrls, activePreset, userFavorites,
  });
  useEffect(() => {
    exportStateRef.current = {
      mixMode, crossfadeMode, forsakenSpeed, smoothPlayStop, smoothApproach,
      vignetteEnabled, showWaveforms, showSpectrum, showCurveGraph,
      audioUrls, activePreset, userFavorites,
    };
  });

  const exportConfig = useCallback(() => {
    const s = exportStateRef.current;
    const cfg = {
      version:        1,
      mixMode:        s.mixMode,
      crossfadeMode:  s.crossfadeMode,
      forsakenSpeed:  s.forsakenSpeed,
      smoothPlayStop: s.smoothPlayStop,
      smoothApproach: s.smoothApproach,
      vignetteEnabled: s.vignetteEnabled,
      showWaveforms:  s.showWaveforms,
      showSpectrum:   s.showSpectrum,
      showCurveGraph: s.showCurveGraph,
      activePreset:   s.activePreset?.name ?? null,
      savedPresets:   s.userFavorites,
      dbd_boundaries: {
        start: DBD_START,
        b2:    +DBD_B2.toFixed(2),
        b3:    +DBD_B3.toFixed(2),
        end:   DBD_END,
      },
      dbd_zone_width: +DBD_ZONE.toFixed(2),
      urls:           s.audioUrls,
    };
    navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).catch(() => {
      prompt('Copy this config:', JSON.stringify(cfg, null, 2));
    });
  }, []); // sem dependências — lê sempre do ref

  const importConfig = useCallback((text: string): boolean => {
    try {
      const c = JSON.parse(text);
      if (c.mixMode       && ['dbd','forsaken'].includes(c.mixMode))              setMixMode(c.mixMode);
      if (c.crossfadeMode && ['linear','equal-power'].includes(c.crossfadeMode)) setCrossfadeMode(c.crossfadeMode);
      if (c.forsakenSpeed && ['slow','normal','fast'].includes(c.forsakenSpeed)) setForsakenSpeed(c.forsakenSpeed);
      if (typeof c.smoothPlayStop  === 'boolean') setSmoothPlayStop(c.smoothPlayStop);
      if (typeof c.smoothApproach  === 'boolean') setSmoothApproach(c.smoothApproach);
      if (typeof c.vignetteEnabled === 'boolean') setVignetteEnabled(c.vignetteEnabled);
      if (typeof c.showWaveforms   === 'boolean') setShowWaveforms(c.showWaveforms);
      if (typeof c.showSpectrum    === 'boolean') setShowSpectrum(c.showSpectrum);
      if (typeof c.showCurveGraph  === 'boolean') setShowCurveGraph(c.showCurveGraph);
      if (c.urls && typeof c.urls === 'object') {
        const ls: AudioLayer[] = ['l1','l2','l3','chase'];
        if (ls.every(l => typeof c.urls[l] === 'string')) setAudioUrls(c.urls as AudioUrls);
      }
      if (Array.isArray(c.savedPresets)) {
        const ls: AudioLayer[] = ['l1','l2','l3','chase'];
        const valid = (c.savedPresets as unknown[]).filter((p): p is Preset =>
          typeof p === 'object' && p !== null &&
          typeof (p as Preset).id   === 'string' &&
          typeof (p as Preset).name === 'string' &&
          typeof (p as Preset).urls === 'object' &&
          ls.every(l => typeof (p as Preset).urls[l] === 'string')
        );
        if (valid.length > 0) setUserFavorites(valid);
      }
      return true;
    } catch { return false; }
  }, [
    setMixMode, setCrossfadeMode, setForsakenSpeed,
    setSmoothPlayStop, setSmoothApproach,
    setVignetteEnabled, setShowWaveforms, setShowSpectrum, setShowCurveGraph,
    setAudioUrls, setUserFavorites,
  ]);

  const resetSettings = useCallback(() => {
    [
      'tr_mixMode','tr_masterVolume','tr_xfade','tr_audioUrls','tr_favorites',
      'tr_vignette','tr_aot','tr_curve','tr_smooth','tr_smooth_play',
      'tr_waveforms','tr_spectrum','tr_fspeed',
    ].forEach(k => localStorage.removeItem(k));
    window.location.reload();
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const volumes  = useMemo(() => (
    { l1: volL1, l2: volL2, l3: volL3, chase: volChase } as Record<AudioLayer, number>
  ), [volL1, volL2, volL3, volChase]);

  const isChase  = getZone(closeness) === 4;
  const zoneName = ZONE_LABELS[getZone(closeness)];

  // ── Compact mode ──────────────────────────────────────────────────────────
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

  // ── Full UI ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans p-6 selection:bg-red-900">

      {/* Keyboard shortcuts modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}>
          <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 w-full max-w-xs shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-black uppercase tracking-widest text-neutral-300">Shortcuts</span>
              <button onClick={() => setShowHelp(false)} className="text-neutral-600 hover:text-neutral-200 transition-colors">
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
                <div key={key} className="flex items-center justify-between py-2.5 border-b border-neutral-800 last:border-0">
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

      {/* Proximity vignette */}
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

      <Sidebar
        isOpen={sidebarOpen}    onClose={() => setSidebarOpen(false)}
        builtins={BUILTIN_PRESETS} favorites={userFavorites}
        activeId={activePreset?.id ?? null}
        onLoad={loadPreset}    onDelete={deleteFav} onSave={saveFav}
      />

      <SettingsPanel
        isOpen={settingsOpen}   onClose={() => setSettingsOpen(false)}
        smoothPlayStop={smoothPlayStop}   onToggleSmoothPlay={() => setSmoothPlayStop(v => !v)}
        smoothApproach={smoothApproach}   onToggleSmoothApproach={() => setSmoothApproach(v => !v)}
        forsakenSpeed={forsakenSpeed}     onSetForsakenSpeed={setForsakenSpeed}
        vignetteEnabled={vignetteEnabled} onToggleVignette={() => setVignetteEnabled(v => !v)}
        showWaveforms={showWaveforms}     onToggleWaveforms={() => setShowWaveforms(v => !v)}
        showSpectrum={showSpectrum}       onToggleSpectrum={() => setShowSpectrum(v => !v)}
        showCurveGraph={showCurveGraph}   onToggleCurveGraph={() => setShowCurveGraph(v => !v)}
        alwaysOnTop={alwaysOnTop}         onToggleAlwaysOnTop={() => setAlwaysOnTop(v => !v)}
        onExportConfig={exportConfig}
        onImportConfig={importConfig}
        onResetSettings={resetSettings}
      />

      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        {/* TODO(mobile): reduzir padding p-6 → p-3 em telas < sm; título em text-2xl */}
        <header className="border-b border-red-900/40 pb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setSidebarOpen(true)} title="Presets"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0"
              >
                <PanelLeft size={18} />
              </button>
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
              <button onClick={() => setShowHelp(true)} title="Keyboard shortcuts"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-600 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <HelpCircle size={16} />
              </button>
              <button onClick={() => setSettingsOpen(true)} title="Settings"
                className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <PanelRight size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Main controls card */}
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 shadow-2xl overflow-hidden">

          {/* Mix mode + crossfade */}
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

          {/* Play + proximity + volume */}
          {/* TODO(mobile): empilhar verticalmente, slider full-width, botões em linha separada */}
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

          {showSpectrum && <MasterVisualizer analysers={analysers} />}
        </div>

        {showCurveGraph && (
          <CurveGraph mixMode={mixMode} crossfadeMode={crossfadeMode} closeness={closeness} />
        )}

        {/* Layer cards */}
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
      <SpeedInsights />
    </div>
  );
}