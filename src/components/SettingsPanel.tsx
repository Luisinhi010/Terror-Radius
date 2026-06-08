// ============================================================
// SettingsPanel — drawer lateral direito de configurações
// ============================================================

import { useState } from 'react';
import { X } from 'lucide-react';
import type { ForsakenSpeed } from '../types';

interface SettingsPanelProps {
  isOpen:                 boolean;
  onClose:                () => void;
  // Playback
  smoothPlayStop:         boolean;
  onToggleSmoothPlay:     () => void;
  smoothApproach:         boolean;
  onToggleSmoothApproach: () => void;
  forsakenSpeed:          ForsakenSpeed;
  onSetForsakenSpeed:     (s: ForsakenSpeed) => void;
  // Display
  vignetteEnabled:        boolean;
  onToggleVignette:       () => void;
  showWaveforms:          boolean;
  onToggleWaveforms:      () => void;
  showSpectrum:           boolean;
  onToggleSpectrum:       () => void;
  showCurveGraph:         boolean;
  onToggleCurveGraph:     () => void;
  // Window
  alwaysOnTop:            boolean;
  onToggleAlwaysOnTop:    () => void;
  // Config
  onExportConfig:         () => void;
  onImportConfig:         (text: string) => boolean;
  onResetSettings:        () => void;
}

// ── Sub-componentes internos ───────────────────────────────

function ToggleRow({
  label, hint, checked, onToggle,
}: { label: string; hint: string; checked: boolean; onToggle: () => void }) {
  return (
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
}

function SectionLabel({ title }: { title: string }) {
  return (
    <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest pt-1 pb-1">
      {title}
    </p>
  );
}

// ── Componente principal ───────────────────────────────────

export function SettingsPanel({
  isOpen, onClose,
  smoothPlayStop, onToggleSmoothPlay,
  smoothApproach, onToggleSmoothApproach,
  forsakenSpeed, onSetForsakenSpeed,
  vignetteEnabled, onToggleVignette,
  showWaveforms, onToggleWaveforms,
  showSpectrum, onToggleSpectrum,
  showCurveGraph, onToggleCurveGraph,
  alwaysOnTop, onToggleAlwaysOnTop,
  onExportConfig, onImportConfig, onResetSettings,
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
            <SectionLabel title="Playback" />
            <ToggleRow
              label="Smooth Play / Stop"
              hint="Fade in on play and fade out on stop instead of hard cuts"
              checked={smoothPlayStop} onToggle={onToggleSmoothPlay}
            />
            <ToggleRow
              label="Smooth Approach"
              hint="Animate proximity toward the slider target instead of jumping instantly"
              checked={smoothApproach} onToggle={onToggleSmoothApproach}
            />
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
            <SectionLabel title="Display" />
            <ToggleRow
              label="Proximity Vignette"
              hint="Red overlay on screen edges that intensifies as the killer closes in"
              checked={vignetteEnabled} onToggle={onToggleVignette}
            />
            <ToggleRow
              label="Layer Waveforms"
              hint="Oscilloscope waveform on each layer card"
              checked={showWaveforms} onToggle={onToggleWaveforms}
            />
            <ToggleRow
              label="Frequency Spectrum"
              hint="Combined frequency bars at the bottom of the controls card"
              checked={showSpectrum} onToggle={onToggleSpectrum}
            />
            <ToggleRow
              label="Volume Curve Graph"
              hint="SVG chart of the 4 layer volume curves — useful for porting"
              checked={showCurveGraph} onToggle={onToggleCurveGraph}
            />
          </div>

          {/* ── Window ───────────────────────────────── */}
          <div>
            <SectionLabel title="Window" />
            <ToggleRow
              label="Always on Top"
              hint="Keep the window above all other apps — useful while gaming"
              checked={alwaysOnTop} onToggle={onToggleAlwaysOnTop}
            />
            <div className="py-3 border-b border-neutral-800">
              <p className="text-sm font-bold text-neutral-300">Compact Mode</p>
              <p className="text-[11px] text-neutral-600 mt-0.5">
                Resize to a mini floating bar.{' '}
                <kbd className="bg-neutral-800 text-neutral-400 px-1 rounded text-[9px]">Ctrl+M</kbd>
              </p>
            </div>
          </div>

          {/* ── Config ───────────────────────────────── */}
          <div>
            <SectionLabel title="Config" />
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
                    importStatus === 'err' ? 'text-red-500'   :
                    'text-neutral-700'
                  }`}>
                    {importStatus === 'ok'  ? '✓ Settings applied' :
                     importStatus === 'err' ? '✗ Invalid JSON'     : 'Waiting for input…'}
                  </p>
                </div>
              )}
            </div>

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
