// ============================================================
// CONSTANTS — dados estáticos, presets, config de layers
// ============================================================

import builtinPresets from './data/builtin-presets.json';
import type { AudioLayer, AudioUrls, LayerConfig, Preset } from './types';

// ── DBD zone boundaries ────────────────────────────────────
// L1 fades in from 0 to DBD_B2; DBD_START is the first nonzero integer step.
// Keep DBD_START as the anchor for the existing later transition boundaries.
// DBD_END (99) = L3 full; 100 = chase.
// DBD_ZONE preserves the existing spacing of ≈32.67 between those boundaries.
export const DBD_START = 1;
export const DBD_END   = 99;
export const DBD_ZONE  = (DBD_END - DBD_START) / 3; // ≈ 32.67
export const DBD_B2    = DBD_START + DBD_ZONE;       // ≈ 33.67
export const DBD_B3    = DBD_START + DBD_ZONE * 2;   // ≈ 66.33

// ── Labels de zona (0 = silence … 4 = chase) ──────────────
export const ZONE_LABELS: Record<number, string> = {
  0: 'Safe', 1: 'Far', 2: 'Mid', 3: 'Close', 4: 'Chase',
};

// ── Configuração de cada layer ─────────────────────────────
export const LAYERS: LayerConfig[] = [
  {
    key: 'l1', label: 'Layer 1 — Far',
    colorClass: 'bg-green-500', color: '#22c55e',
    dbdRange: 'Active: 1% – 66%  (peak at ~34%)',
    forsakenRange: 'Exclusive zone: 1% – 33%',
  },
  {
    key: 'l2', label: 'Layer 2 — Mid',
    colorClass: 'bg-yellow-500', color: '#eab308',
    dbdRange: 'Active: 34% – 99%  (peak at ~66%)',
    forsakenRange: 'Exclusive zone: 34% – 66%',
  },
  {
    key: 'l3', label: 'Layer 3 — Close',
    colorClass: 'bg-orange-500', color: '#f97316',
    dbdRange: 'Active: 66% – 99%  (full at 99%)',
    forsakenRange: 'Exclusive zone: 67% – 99%',
  },
  {
    key: 'chase', label: 'Chase Music',
    colorClass: 'bg-red-500', color: '#ef4444',
    dbdRange: '100% — Line of Sight',
    forsakenRange: '100%',
  },
];

// ── Cores e labels usados pelo CurveGraph ─────────────────
export const LAYER_COLORS: Record<AudioLayer, string> = {
  l1: '#22c55e', l2: '#eab308', l3: '#f97316', chase: '#ef4444',
};

export const LAYER_LABELS_SHORT: Record<AudioLayer, string> = {
  l1: 'L1 Far', l2: 'L2 Mid', l3: 'L3 Close', chase: 'Chase',
};

// ── URLs vazias (estado inicial sem preset carregado) ───────
export const EMPTY_URLS: AudioUrls = { l1: '', l2: '', l3: '', chase: '' };

// ── Presets built-in ──────────────────────────────────────
export const BUILTIN_PRESETS: Preset[] = builtinPresets.map(preset => {
  const { defaultMixMode } = preset;
  if (defaultMixMode !== 'dbd' && defaultMixMode !== 'forsaken') {
    throw new Error(`Invalid defaultMixMode for built-in preset: ${preset.id}`);
  }
  return { ...preset, defaultMixMode };
});
