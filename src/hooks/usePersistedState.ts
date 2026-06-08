// ============================================================
// usePersistedState — useState que sincroniza com localStorage
// ============================================================

import { useState, useEffect } from 'react';

/**
 * Idêntico a useState mas persiste o valor em localStorage.
 * Usa lazy initializer para ler o storage apenas uma vez no mount.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item !== null ? (JSON.parse(item) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);

  return [state, setState];
}
