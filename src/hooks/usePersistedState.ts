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
  sanitize?: (value: unknown) => T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return defaultValue;
      const parsed = JSON.parse(item);
      return sanitize ? sanitize(parsed) : parsed as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(sanitize ? sanitize(state) : state));
    } catch {
      // Storage may be unavailable in private or restricted contexts.
    }
  }, [key, state, sanitize]);

  return [state, setState];
}
