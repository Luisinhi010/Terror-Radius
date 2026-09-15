import { describe, expect, it } from 'vitest';
import { DBD_B2, DBD_B3, DBD_END, DBD_ZONE } from '../src/constants';
import { allVolumes, dbdVolumes } from '../src/utils/audioMath';

describe.each(['linear', 'equal-power'] as const)('DBD %s curve', mode => {
  const fadeIn = (t: number) => mode === 'equal-power' ? Math.sin(t * Math.PI / 2) : t;
  const fadeOut = (t: number) => mode === 'equal-power' ? Math.cos(t * Math.PI / 2) : 1 - t;

  it('keeps every layer silent at 0% proximity', () => {
    expect(dbdVolumes(0, mode)).toEqual({ l1: 0, l2: 0, l3: 0 });
    expect(allVolumes(0, 'dbd', mode)).toEqual({ l1: 0, l2: 0, l3: 0, chase: 0 });
  });

  it('gives L1 a nonzero gain at the first 1% proximity step', () => {
    const volumes = dbdVolumes(1, mode);
    expect(volumes.l1).toBeGreaterThan(0);
    expect(volumes.l1).toBeCloseTo(fadeIn(1 / DBD_B2));
    expect(volumes.l2).toBe(0);
    expect(volumes.l3).toBe(0);
    // The graph must use the same corrected curve as the audio engine.
    expect(allVolumes(1, 'dbd', mode)).toEqual({ ...volumes, chase: 0 });
  });

  it.each([0.25, 0.5, 2, DBD_B2 / 2, DBD_B2 - 0.0001])(
    'fades L1 from zero toward its existing peak at proximity %s', c => {
      const volumes = dbdVolumes(c, mode);
      expect(volumes.l1).toBeGreaterThan(0);
      expect(volumes.l1).toBeLessThan(1);
      expect(volumes.l1).toBeCloseTo(fadeIn(c / DBD_B2), 10);
      expect(volumes.l2).toBe(0);
      expect(volumes.l3).toBe(0);
    },
  );

  it('preserves both subsequent crossfades and their existing boundaries', () => {
    expect(DBD_B2).toBeCloseTo(101 / 3, 10);
    expect(DBD_B3).toBeCloseTo(199 / 3, 10);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const first = dbdVolumes(DBD_B2 + t * DBD_ZONE, mode);
      expect(first.l1).toBeCloseTo(fadeOut(t), 10);
      expect(first.l2).toBeCloseTo(fadeIn(t), 10);
      expect(first.l3).toBe(0);
      const second = dbdVolumes(DBD_B3 + t * DBD_ZONE, mode);
      expect(second.l1).toBe(0);
      expect(second.l2).toBeCloseTo(fadeOut(t), 10);
      expect(second.l3).toBeCloseTo(fadeIn(t), 10);
    }
  });

  it('keeps L3 full at 99% and reserves 100% for Chase', () => {
    expect(DBD_END).toBe(99);
    for (const c of [99, 99.5]) {
      expect(allVolumes(c, 'dbd', mode)).toEqual({ l1: 0, l2: 0, l3: 1, chase: 0 });
    }
    expect(allVolumes(100, 'dbd', mode)).toEqual({ l1: 0, l2: 0, l3: 0, chase: 1 });
  });

  it('leaves Forsaken zone volumes unchanged', () => {
    for (const c of [0, 1, 33, 34, 66, 67, 99, 100]) {
      expect(allVolumes(c, 'forsaken', mode)).toEqual({
        l1: c > 0 && c <= 33 ? 1 : 0,
        l2: c > 33 && c <= 66 ? 1 : 0,
        l3: c > 66 && c < 100 ? 1 : 0,
        chase: c === 100 ? 1 : 0,
      });
    }
  });
});
