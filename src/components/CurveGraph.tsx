// ============================================================
// CurveGraph — gráfico SVG das curvas de volume dos 4 layers
// Usa allVolumes() — mesma função do engine — garantindo que
// o gráfico seja sempre a imagem exata do comportamento do sistema.
// ============================================================

import { useMemo } from 'react';
import type { AudioLayer, CrossfadeMode, MixMode } from '../types';
import { LAYER_COLORS, LAYER_LABELS_SHORT, DBD_B2, DBD_B3, DBD_END } from '../constants';
import { allVolumes } from '../utils/audioMath';

interface CurveGraphProps {
  mixMode:       MixMode;
  crossfadeMode: CrossfadeMode;
  closeness:     number;
}

const LAYERS_ORDER: AudioLayer[] = ['l1', 'l2', 'l3', 'chase'];

export function CurveGraph({ mixMode, crossfadeMode, closeness }: CurveGraphProps) {
  // Amostra 101 pontos (um por closeness inteiro).
  // Curvas dependem só de mix/crossfade mode — NÃO de closeness —
  // então não recomputam a cada frame do smooth approach.
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

  // Playhead — atualiza com closeness mas é uma chamada barata
  const playVols = useMemo(
    () => allVolumes(closeness, mixMode, crossfadeMode),
    [closeness, mixMode, crossfadeMode],
  );

  return (
    <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-600 font-bold uppercase tracking-widest">
          Volume Curves
        </span>
        <div className="flex items-center gap-4">
          {LAYERS_ORDER.map(k => (
            <span key={k}
              className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: LAYER_COLORS[k] }}>
              <span className="inline-block w-3 border-t-2" style={{ borderColor: LAYER_COLORS[k] }} />
              {LAYER_LABELS_SHORT[k]}
            </span>
          ))}
        </div>
      </div>

      <div className="relative bg-neutral-950 rounded-lg px-2 pt-2 pb-5">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-28">
          {/* Gridlines horizontais */}
          {[25, 50, 75].map(y => (
            <line key={y} x1="0" y1={y} x2="100" y2={y}
              stroke="#1f1f1f" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Zone boundaries do DBD */}
          {mixMode === 'dbd' && [DBD_B2, DBD_B3, DBD_END].map((b, i) => (
            <line key={i} x1={b} y1="0" x2={b} y2="100"
              stroke="#2d2d2d" strokeWidth="0.5" strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke" />
          ))}
          {/* Curvas dos layers */}
          {LAYERS_ORDER.map(k => (
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
          {/* Dots no closeness atual */}
          {LAYERS_ORDER.map(k => {
            const v = playVols[k];
            if (v < 0.01) return null;
            return (
              <circle key={k}
                cx={closeness} cy={(1 - v) * 100} r="2"
                fill={LAYER_COLORS[k]} vectorEffect="non-scaling-stroke" />
            );
          })}
        </svg>
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
