// ============================================================
// MasterVisualizer — frequência combinada de todos os 4 layers
// Mistura aditiva dos AnalyserNodes: barras crescem com o
// número de layers ativos, não apenas com o mais alto.
// ============================================================

import { useRef, useEffect } from 'react';
import type { AudioLayer } from '../types';

interface MasterVisualizerProps {
  analysers: Record<AudioLayer, AnalyserNode | null>;
}

export function MasterVisualizer({ analysers }: MasterVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !Object.values(analysers).some(Boolean)) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const BUF   = 256;
    const tmp   = new Uint8Array(BUF);
    const mixed = new Float32Array(BUF);
    let rafId   = 0;

    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      mixed.fill(0);
      (Object.keys(analysers) as AudioLayer[]).forEach(layer => {
        const a = analysers[layer];
        if (!a) return;
        a.getByteFrequencyData(tmp);
        for (let i = 0; i < BUF; i++) mixed[i] += tmp[i] / 255;
      });

      ctx2d.clearRect(0, 0, w, h);

      const BAR_COUNT = 72;
      const barW      = w / BAR_COUNT;
      const freqRange = Math.floor(BUF * 0.7); // limita ao range musicalmente relevante
      const cy        = h / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const idx  = Math.floor((i / BAR_COUNT) * freqRange);
        const val  = Math.min(1, mixed[idx] / 4);
        const barH = val * cy * 0.92;

        if (barH < 0.5) continue;

        const hue   = 8 + (i / BAR_COUNT) * 38;
        const light = 45 + val * 20;
        const alpha = 0.3 + val * 0.7;

        const grad = ctx2d.createLinearGradient(0, cy - barH, 0, cy + barH);
        grad.addColorStop(0,   `hsla(${hue}, 90%, ${light}%, 0)`);
        grad.addColorStop(0.3, `hsla(${hue}, 90%, ${light}%, ${alpha})`);
        grad.addColorStop(0.5, `hsla(${hue + 6}, 95%, ${light + 10}%, ${alpha})`);
        grad.addColorStop(0.7, `hsla(${hue}, 90%, ${light}%, ${alpha})`);
        grad.addColorStop(1,   `hsla(${hue}, 90%, ${light}%, 0)`);

        ctx2d.fillStyle = grad;
        ctx2d.fillRect(i * barW, cy - barH, barW - 1, barH * 2);

        if (val > 0.15) {
          ctx2d.fillStyle = `hsla(${hue + 10}, 100%, 80%, ${val * 0.6})`;
          ctx2d.fillRect(i * barW, cy - 1, barW - 1, 2);
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [analysers]);

  return <canvas ref={canvasRef} className="w-full h-20 rounded-b-xl" />;
}
