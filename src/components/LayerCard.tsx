// ============================================================
// LayerCard — card de cada layer de áudio
// React.memo: só re-renderiza quando suas props mudam.
// Principal benefício: com smooth approach ativo (RAF a 60fps),
// apenas o card com volume diferente re-renderiza, não todos os 4.
// ============================================================

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Link as LinkIcon, AlertCircle, FolderOpen, X } from 'lucide-react';
import type { AudioLayer, LayerConfig, MixMode } from '../types';
import { useFilePicker } from '../hooks/useFilePicker';
import type { LocalAudioFile } from '../utils/localAudio';

export interface LayerCardProps {
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
  isPlaying:     boolean;
  localFile:     LocalAudioFile | null;
  onFilePick:    (file: LocalAudioFile) => void;
}

// Extrai só o nome do arquivo de uma URL qualquer
function extractFilename(url: string) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? url); }
  catch { return url.split('/').pop() ?? url; }
}

export const LayerCard = React.memo(function LayerCard({
  config, mixMode, volume, url, onUrlChange,
  hasError, analyser, isLoading,
  isLayerMuted, isLayerSoloed,
  onMute, onSolo, showWaveform, isPlaying, localFile, onFilePick,
}: LayerCardProps) {
  const percent      = Math.round(volume * 100);
  const isActive     = volume > 0.01;
  const isChaseLayer = config.key === 'chase';

  // App owns local URLs/names, so compact-mode unmounts don't lose them.
  const clearLocalFile = useCallback(() => {
    onUrlChange('');
  }, [onUrlChange]);

  const { pick, isPicking, pickerError } = useFilePicker(onFilePick, url);

  // Keep typing responsive, without decoding a new URL on every keystroke.
  const [draft, setDraft] = useState({ source: url, value: url });
  const draftUrl = draft.source === url ? draft.value : url;
  useEffect(() => { setDraft({ source: url, value: url }); }, [url]);
  const onUrlChangeRef = useRef(onUrlChange);
  useEffect(() => { onUrlChangeRef.current = onUrlChange; }, [onUrlChange]);
  useEffect(() => {
    if (localFile || draftUrl === url) return;
    const timer = setTimeout(() => onUrlChangeRef.current(draftUrl), 350);
    return () => clearTimeout(timer);
  }, [draftUrl, url, localFile]);

  // ── Waveform visualizer ────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    let rafId    = 0;

    // Pre-computa componentes RGB uma vez por efeito — evita parseInt a cada frame
    const cr   = parseInt(config.color.slice(1, 3), 16);
    const cg   = parseInt(config.color.slice(3, 5), 16);
    const cb   = parseInt(config.color.slice(5, 7), 16);
    const rgba = (a: number) => `rgba(${cr},${cg},${cb},${a})`;

    const draw = () => {
      const vol = isPlaying ? volumeRef.current : 0;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      if (vol < 0.001)
      {
        // Estado idle: fundo sutil + flat line
        if (w && h)
        {
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          ctx2d.clearRect(0, 0, w, h);
          ctx2d.fillStyle = rgba(0.04);
          ctx2d.fillRect(0, 0, w, h);
          ctx2d.globalAlpha = 0.14;
          ctx2d.strokeStyle = config.color;
          ctx2d.lineWidth   = 1;
          ctx2d.beginPath();
          ctx2d.moveTo(0, h / 2);
          ctx2d.lineTo(w, h / 2);
          ctx2d.stroke();
          ctx2d.globalAlpha = 1;
        }

        // Pausado + silencioso: para o RAF — reiniciado quando isPlaying muda (effect re-run via dep)
        if (!isPlaying) return;
        // Tocando mas ainda silencioso (fade-in): mantém RAF vivo aguardando áudio
        rafId = requestAnimationFrame(draw);
        return;
      }

      if (w === 0 || h === 0) { rafId = requestAnimationFrame(draw); return; }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      analyser.getByteTimeDomainData(data);
      ctx2d.clearRect(0, 0, w, h);

      const alpha  = 0.15 + vol * 0.85;
      const scaleX = w / (bufLen - 1);
      const scaleY = h / 255;

      const grad = ctx2d.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(alpha * 0.45));
      grad.addColorStop(1, rgba(0));
      ctx2d.beginPath();
      ctx2d.moveTo(0, h);
      for (let i = 0; i < bufLen; i++) {
        ctx2d.lineTo(i * scaleX, (255 - data[i]) * scaleY);
      }
      ctx2d.lineTo(w, h);
      ctx2d.closePath();
      ctx2d.fillStyle = grad;
      ctx2d.fill();

      // Waveform line com glow quando audível
      ctx2d.globalAlpha = alpha;
      ctx2d.strokeStyle = config.color;
      ctx2d.lineWidth   = 1.5;
      if (vol > 0.03) { ctx2d.shadowBlur = 7; ctx2d.shadowColor = config.color; }
      ctx2d.beginPath();
      ctx2d.moveTo(0, (255 - data[0]) * scaleY);
      for (let i = 1; i < bufLen; i++) {
        ctx2d.lineTo(i * scaleX, (255 - data[i]) * scaleY);
      }
      ctx2d.stroke();
      ctx2d.shadowBlur  = 0;
      ctx2d.globalAlpha = 1;

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [analyser, config.color, isPlaying, showWaveform]);

  // ── Render ────────────────────────────────────────────────────────────────
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
            <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              isLoading    ? 'bg-neutral-500 animate-pulse' :
              isLayerMuted ? 'bg-neutral-700' :
              isActive     ? config.colorClass : 'bg-neutral-700'
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
          {/* TODO(mobile): aumentar touch target para min-h-[44px] */}
          <button onClick={onSolo} title="Solo this layer"
            className={`text-[9px] font-black w-5 h-5 rounded flex items-center justify-center transition-all ${
              isLayerSoloed
                ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/50'
                : 'text-neutral-600 hover:text-neutral-300 bg-neutral-800'
            }`}
          >S</button>
          <button onClick={onMute} title="Mute this layer"
            className={`text-[9px] font-black w-5 h-5 rounded flex items-center justify-center transition-all ${
              isLayerMuted
                ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50'
                : 'text-neutral-600 hover:text-neutral-300 bg-neutral-800'
            }`}
          >M</button>
          <span className={`text-2xl font-black tabular-nums transition-colors duration-300 ml-1 ${
            isLayerMuted ? 'text-neutral-700' : isActive ? 'text-neutral-100' : 'text-neutral-600'
          }`}>
            {percent}<span className="text-sm font-normal text-neutral-500">%</span>
          </span>
        </div>
      </div>

      {showWaveform && <canvas ref={canvasRef} className="w-full h-14 mb-3 rounded" />}

      <div className="w-full h-3 bg-neutral-950 rounded-full overflow-hidden mb-5 relative">
        <div
          className={`h-full ${config.colorClass} transition-all duration-150 ease-out`}
          style={{ width: `${percent}%` }}
        />
        <div className="absolute inset-0 flex justify-between opacity-20 px-1">
          {[0, 1, 2, 3].map(i => <div key={i} className="w-px h-full bg-white" />)}
        </div>
      </div>

      {/* ── Badge de arquivo local ───────────────────────────────────────── */}
      {localFile && (
        <div className="flex items-center justify-between mb-1.5 px-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen size={11} className="text-neutral-500 flex-shrink-0" />
            <span className="text-[11px] text-neutral-400 truncate" title={localFile.filename}>
              {localFile.filename}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            {/* Neither blobs nor native dialog scopes persist across sessions. */}
            {(
              <span
                className="text-[9px] text-yellow-600/70 font-bold uppercase tracking-wide"
                title="Reselect local files after reopening. JSON exports do not include audio files."
              >
                session only
              </span>
            )}
            <button
              onClick={clearLocalFile}
              title="Remove local file"
              className="text-neutral-600 hover:text-red-400 transition-colors"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ── Input de URL + botão de arquivo ─────────────────────────────── */}
      <div className="relative flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-neutral-600">
            <LinkIcon size={13} />
          </div>
          <input
            type="text"
            placeholder={
              localFile
                ? extractFilename(url)
                : 'Paste audio URL (.ogg, .mp3) or /audio/file.ogg'
            }
            value={localFile ? '' : draftUrl}
            aria-label={`${config.label} audio URL`}
            readOnly={!!localFile}
            onChange={e => {
              if (localFile) return;
              const value = e.target.value;
              setDraft({ source: url, value });
              if (!value.trim()) onUrlChange('');
            }}
            className={`w-full bg-neutral-950 border text-neutral-400 text-xs rounded pl-8 pr-3 py-2
              focus:ring-1 focus:ring-red-600 focus:border-red-600 focus:text-neutral-200
              transition-colors placeholder-neutral-700 ${
              localFile  ? 'opacity-0 pointer-events-none absolute' :
              hasError   ? 'border-red-900' : 'border-neutral-800'
            }`}
          />
          {/* Display visual quando há arquivo local (o input real fica oculto acima) */}
          {localFile && (
            <div className={`w-full bg-neutral-950 border text-neutral-600 text-xs rounded pl-8 pr-3 py-2 ${
              hasError ? 'border-red-900' : 'border-neutral-800'
            }`}>
              {localFile.filename}
            </div>
          )}
        </div>

        {/* Botão de file picker */}
        <button
          onClick={pick}
          title="Open local audio file"
          aria-label={`Open local audio file for ${config.label}`}
          disabled={isPicking}
          aria-busy={isPicking}
          className="flex-shrink-0 p-2 rounded bg-neutral-800 border border-neutral-700
                     text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700
                     transition-colors"
        >
          <FolderOpen size={13} />
        </button>
      </div>

      {hasError && !isLoading && (
        <p className="text-[11px] text-red-500/80 mt-1.5 flex items-center gap-1">
          <AlertCircle size={10} />
          Audio could not be loaded. Check the URL or select a supported audio file.
        </p>
      )}
      {pickerError && <p role="alert" className="text-[11px] text-red-500/80 mt-1.5">{pickerError}</p>}
    </div>
  );
});

export type { AudioLayer };
