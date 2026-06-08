// ============================================================
// AUDIO MATH — funções puras de cálculo de volume
// Usadas tanto pelo engine quanto pelo CurveGraph,
// garantindo que os dois sempre estejam em sincronia.
// ============================================================

import type { AudioLayer, CrossfadeMode, MixMode } from '../types';
import { DBD_B2, DBD_B3, DBD_END, DBD_START, DBD_ZONE } from '../constants';

/**
 * Mapeia closeness (0–100) para uma das 5 zonas discretas:
 *   0 = silence | 1 = far | 2 = mid | 3 = close | 4 = chase
 */
export function getZone(c: number): number {
  if (c === 0)  return 0;
  if (c <= 33)  return 1;
  if (c <= 66)  return 2;
  if (c < 100)  return 3;
  return 4;
}

/**
 * Volumes dos três stems para o modo DBD em um dado closeness.
 * Extraído para que engine e CurveGraph produzam números idênticos.
 */
export function dbdVolumes(
  c: number,
  mode: CrossfadeMode,
): { l1: number; l2: number; l3: number } {
  let l1 = 0, l2 = 0, l3 = 0;

  const xfade = (t: number): [number, number] => {
    const h = t * Math.PI / 2;
    return mode === 'equal-power'
      ? [Math.cos(h), Math.sin(h)]
      : [1 - t, t];
  };

  if      (c >= DBD_START && c < DBD_B2) l1 = xfade((c - DBD_START) / DBD_ZONE)[1];
  else if (c >= DBD_B2    && c < DBD_B3) { const [o, i] = xfade((c - DBD_B2) / DBD_ZONE); l1 = o; l2 = i; }
  else if (c >= DBD_B3    && c < DBD_END){ const [o, i] = xfade((c - DBD_B3) / DBD_ZONE); l2 = o; l3 = i; }
  else if (c >= DBD_END)                  l3 = 1;

  return { l1, l2, l3 };
}

/**
 * Volume de todos os 4 layers em um dado closeness.
 * Usado pelo CurveGraph para samplear as curvas de design (0–100).
 */
export function allVolumes(
  c: number,
  mix: MixMode,
  cf: CrossfadeMode,
): Record<AudioLayer, number> {
  const zone = getZone(c);
  if (zone === 4) return { l1: 0, l2: 0, l3: 0, chase: 1 };
  if (mix === 'forsaken') return {
    l1: zone === 1 ? 1 : 0,
    l2: zone === 2 ? 1 : 0,
    l3: zone === 3 ? 1 : 0,
    chase: 0,
  };
  const { l1, l2, l3 } = dbdVolumes(c, cf);
  return { l1, l2, l3, chase: 0 };
}
