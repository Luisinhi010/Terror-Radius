import { describe, expect, it } from 'vitest';
import catalog from '../src/data/builtin-presets.json';
import { BUILTIN_PRESETS } from '../src/constants';

describe('built-in song catalog', () => {
  it('exposes the JSON catalog unchanged to existing preset consumers', () => {
    expect(BUILTIN_PRESETS).toEqual(catalog);
  });

  it('has unique nonempty IDs and names', () => {
    expect(new Set(catalog.map(preset => preset.id)).size).toBe(catalog.length);
    for (const preset of catalog) {
      expect(preset.id.trim()).not.toBe('');
      expect(preset.name.trim()).not.toBe('');
    }
  });

  it('provides a supported mode and all four remote layer URLs', () => {
    for (const preset of catalog) {
      expect(['dbd', 'forsaken']).toContain(preset.defaultMixMode);
      expect(Object.keys(preset.urls).sort()).toEqual(['chase', 'l1', 'l2', 'l3']);
      for (const url of Object.values(preset.urls)) {
        expect(['https:', 'http:']).toContain(new URL(url).protocol);
      }
    }
  });
});
