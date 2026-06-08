// ============================================================
// TYPES — compartilhados por todo o projeto
// ============================================================

export type MixMode      = 'dbd' | 'forsaken';
export type AudioLayer   = 'l1' | 'l2' | 'l3' | 'chase';
export type AudioUrls    = Record<AudioLayer, string>;
export type FVols        = Record<Exclude<AudioLayer, 'chase'>, number>;
export type AudioErrors  = Partial<Record<AudioLayer, boolean>>;
export type CrossfadeMode = 'linear' | 'equal-power';
export type ForsakenSpeed = 'slow' | 'normal' | 'fast';

export interface Preset {
  id:              string;
  name:            string;
  urls:            AudioUrls;
  defaultMixMode?: MixMode;
}

export interface LayerConfig {
  key:           AudioLayer;
  label:         string;
  dbdRange:      string;
  forsakenRange: string;
  /** Tailwind class para barra de volume e indicador dot */
  colorClass:    string;
  /** CSS hex para canvas drawing */
  color:         string;
}
