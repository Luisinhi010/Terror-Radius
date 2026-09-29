// A normal-speed, unmuted HTML audio element gives the Web Audio mixer a
// system media session. Only the PCM samples are silent (not audio.muted).
export function createSilentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * 10 * 2; // 10 seconds, mono, 16-bit PCM
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, dataSize, true);
  return buffer;
}

export function createMediaCarrier(onPause: () => void, onError: () => void) {
  const audio = new Audio();
  const url = URL.createObjectURL(new Blob([createSilentWav()], { type: 'audio/wav' }));
  let disposed = false;
  audio.loop = true;
  audio.preload = 'auto';
  audio.muted = false;
  audio.volume = 1;
  audio.src = url;

  // A pause queued by our previous Stop must not interrupt a newer Play.
  const paused = () => { if (audio.paused) onPause(); };
  audio.addEventListener('pause', paused);
  audio.addEventListener('error', onError);
  const rewind = () => {
    if (audio.readyState > 0) audio.currentTime = 0;
  };

  return {
    async play() {
      if (disposed) return;
      if (audio.error) audio.load();
      rewind();
      // Runs synchronously within the original click/media action gesture.
      await audio.play();
    },
    stop() {
      audio.pause();
      rewind();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      audio.removeEventListener('pause', paused);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    },
  };
}
