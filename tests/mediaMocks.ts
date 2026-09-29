import { vi } from 'vitest';

export function installMediaMocks() {
  const previousSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
  const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  const session = {
    metadata: null as MediaMetadata | null,
    playbackState: 'none',
    setPositionState: vi.fn(),
    setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    }),
  };
  const audios: MockMediaAudio[] = [];
  class MockMediaAudio extends EventTarget {
    src = '';
    loop = false;
    preload = '';
    muted = true;
    volume = 0;
    playbackRate = 1;
    paused = true;
    readyState = 4;
    currentTime = 0;
    error: MediaError | null = null;
    constructor() { super(); audios.push(this); }
    play = vi.fn((): Promise<void> => { this.paused = false; return Promise.resolve(); });
    pause = vi.fn(() => { this.paused = true; });
    load = vi.fn(() => { this.error = null; });
    removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  }
  vi.stubGlobal('Audio', MockMediaAudio);
  vi.stubGlobal('MediaMetadata', class {
    title: string; artist: string; album: string;
    constructor(init: MediaMetadataInit) {
      this.title = init.title ?? ''; this.artist = init.artist ?? ''; this.album = init.album ?? '';
    }
  });
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
  const create = vi.fn(() => `blob:carrier-${audios.length}`);
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });
  return {
    session, handlers, audios, create, revoke,
    action(action: MediaSessionAction, details = {} as Partial<MediaSessionActionDetails>) {
      const handler = handlers.get(action);
      if (!handler) throw new Error(`No handler registered for ${action}`);
      handler({ action, ...details });
    },
    restore() {
      for (const [object, key, descriptor] of [
        [navigator, 'mediaSession', previousSession],
        [URL, 'createObjectURL', previousCreate],
        [URL, 'revokeObjectURL', previousRevoke],
      ] as const) {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else Reflect.deleteProperty(object, key);
      }
    },
  };
}
