// ============================================================
// CompactView — mini barra flutuante para usar durante o jogo
// Tauri: data-tauri-drag-region permite arrastar a janela pelo bar.
// TODO(mobile): este é o principal candidato a virar a UI padrão
//               em telas pequenas (< 480px).
// ============================================================

import { Play, Square, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import type { Preset } from '../types';

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

export function CompactView({
  closeness, setCloseness,
  isPlaying, togglePlay,
  isMuted, setIsMuted,
  zoneName, isChase,
  activePreset, onExpand,
}: CompactViewProps) {
  return (
    <div
      data-tauri-drag-region
      className="h-screen bg-neutral-950 border-t-2 border-red-950 flex items-center gap-3 px-3 select-none overflow-hidden"
    >
      <button onClick={onExpand} title="Expand  (Ctrl+M)"
        className="text-neutral-600 hover:text-neutral-300 transition-colors flex-shrink-0 pointer-events-auto"
        data-tauri-drag-region=""
      >
        <Maximize2 size={13} />
      </button>

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

      <input
        type="range" min="0" max="100" step="1" value={closeness}
        onChange={e => setCloseness(parseInt(e.target.value))}
        className="flex-1 accent-red-600 cursor-pointer pointer-events-auto"
        style={{ minWidth: 60 }}
      />

      <span className={`text-[11px] font-black tabular-nums w-7 text-right flex-shrink-0 pointer-events-none ${
        isChase ? 'text-red-500' : 'text-neutral-500'
      }`}>
        {isChase ? 'CH' : closeness}
      </span>

      <button onClick={togglePlay}
        className={`flex-shrink-0 pointer-events-auto transition-colors ${
          isPlaying ? 'text-red-400' : 'text-green-500'
        }`}
      >
        {isPlaying
          ? <Square size={13} fill="currentColor" />
          : <Play   size={13} fill="currentColor" />}
      </button>

      <button onClick={() => setIsMuted(!isMuted)}
        className="text-neutral-600 hover:text-neutral-300 flex-shrink-0 pointer-events-auto transition-colors"
      >
        {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
    </div>
  );
}
