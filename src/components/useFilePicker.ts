// ============================================================
// useFilePicker — abstrai seleção de arquivo local
//
// Web:   input[type=file] → blob URL (não persiste entre sessões)
// Tauri: plugin-dialog → convertFileSrc → asset URL (persiste)
//
// PARA ATIVAR NO TAURI, antes de usar:
//   1. npm install @tauri-apps/plugin-dialog
//   2. Em Cargo.toml:  tauri-plugin-dialog = "2"
//   3. Em lib.rs:      .plugin(tauri_plugin_dialog::init())
//   4. Em capabilities/default.json: "dialog:allow-open"
//
// O hook importa os módulos Tauri dinamicamente (lazy),
// então o bundle web não carrega nada relacionado ao Tauri.
// ============================================================

import { useCallback } from 'react';

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FilePickResult {
  /** URL pronta para uso no useAudioEngine (blob: ou asset://) */
  url:      string;
  /** Nome legível do arquivo para exibir na UI */
  filename: string;
  /** true = blob URL (web) — não sobrevive ao reload da aba */
  isBlob:   boolean;
}

const AUDIO_EXTENSIONS = ['ogg', 'mp3', 'wav', 'flac', 'm4a', 'opus', 'aac'];
const AUDIO_ACCEPT = 'audio/ogg,audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/*';

export function useFilePicker(onPick: (result: FilePickResult) => void) {
  const pick = useCallback(async () => {
    if (isTauri) {
      await pickTauri(onPick);
    } else {
      pickWeb(onPick);
    }
  }, [onPick]);

  return { pick };
}

// ── Web ────────────────────────────────────────────────────
function pickWeb(onPick: (r: FilePickResult) => void) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = AUDIO_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    onPick({
      url:      URL.createObjectURL(file),
      filename: file.name,
      isBlob:   true,
    });
  };
  input.click();
}

// ── Tauri ──────────────────────────────────────────────────
// Import dinâmico: o bundle web nunca carrega isso.
async function pickTauri(onPick: (r: FilePickResult) => void) {
  try {
    const [{ open }, { convertFileSrc }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ]);

    const path = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    });

    if (typeof path === 'string') {
      onPick({
        url:      convertFileSrc(path),
        filename: path.split(/[\\/]/).pop() ?? path,
        isBlob:   false,
      });
    }
  } catch (err) {
    // plugin-dialog não instalado ainda → avisa no console, não quebra
    console.warn('[useFilePicker] Tauri dialog unavailable:', err);
  }
}
