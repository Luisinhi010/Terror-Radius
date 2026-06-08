// ============================================================
// CONSTANTS — dados estáticos, presets, config de layers
// ============================================================

import type { AudioLayer, AudioUrls, LayerConfig, Preset } from './types';

// ── DBD zone boundaries ────────────────────────────────────
// Active range: [DBD_START, DBD_END) — abaixo de start é silêncio;
// DBD_END (99) = L3 full; 100 = chase.
// Três zonas iguais de ≈32.67 unidades dividem [1, 99].
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
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'curtains-call',
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
    id: 'nil-incident',
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
    id: 'singularity',
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
