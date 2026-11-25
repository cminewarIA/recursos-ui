import React, { useEffect, useRef } from 'react';
import { MetricsPayload, ThemeMode } from '../types/telemetry';
import { ThemeBackgroundEffect } from '../themes/types';

interface MatrixTelemetryBackdropProps {
  metrics: MetricsPayload | null;
  effect?: ThemeBackgroundEffect;
  mode: ThemeMode;
}

interface RainColumn {
  y: number;
  speed: number;
  stream: string;
  charIndex: number;
  length: number;
}

function buildLiveTelemetryStreams(metrics: MetricsPayload | null): string[] {
  const streams: string[] = [];
  if (!metrics) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return [
      `SYNC ${hh}:${mm}:${ss}`,
      'TELEMETRY::LINK',
      'SYS::PROBE',
      'KERNEL::INIT',
    ];
  }

  const cpuPct = metrics.cpu?.usage_percent;
  const cpuTemp = metrics.cpu?.temp_c;
  const cpuFreq = metrics.cpu?.freq_mhz;
  const cpuPower = metrics.cpu?.power_watts;
  const load1 = metrics.cpu?.load_1m;
  const load5 = metrics.cpu?.load_5m;

  if (typeof cpuPct === 'number' && Number.isFinite(cpuPct)) {
    const tempPart = typeof cpuTemp === 'number' && Number.isFinite(cpuTemp) ? ` ${cpuTemp.toFixed(1)}C` : '';
    streams.push(`CPU ${cpuPct.toFixed(1)}%${tempPart}`);
  }
  if (typeof cpuFreq === 'number' && Number.isFinite(cpuFreq) && cpuFreq > 0) {
    streams.push(`CLK ${(cpuFreq / 1000).toFixed(2)}GHz`);
  }
  if (typeof cpuPower === 'number' && Number.isFinite(cpuPower) && cpuPower > 0) {
    streams.push(`RAPL ${cpuPower.toFixed(1)}W`);
  }
  if (typeof load1 === 'number' && Number.isFinite(load1)) {
    const l5 = typeof load5 === 'number' && Number.isFinite(load5) ? ` ${load5.toFixed(2)}` : '';
    streams.push(`LOAD ${load1.toFixed(2)}${l5}`);
  }

  const ramPct = metrics.ram?.percent;
  const ramUsedGb =
    typeof metrics.ram?.used_bytes === 'number' ? metrics.ram.used_bytes / (1024 * 1024 * 1024) : null;
  const ramTotalGb =
    typeof metrics.ram?.total_bytes === 'number' ? metrics.ram.total_bytes / (1024 * 1024 * 1024) : null;
  if (typeof ramPct === 'number' && Number.isFinite(ramPct)) {
    const gbPart =
      ramUsedGb !== null && ramTotalGb !== null && ramTotalGb > 0
        ? ` ${ramUsedGb.toFixed(1)}/${ramTotalGb.toFixed(0)}GB`
        : '';
    streams.push(`RAM ${ramPct.toFixed(0)}%${gbPart}`);
  }

  const rxBytes = Number(metrics.net?.rx_bytes_sec ?? 0);
  const txBytes = Number(metrics.net?.tx_bytes_sec ?? 0);
  const fmtRate = (bps: number) => {
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(0)}KB/s`;
    return `${Math.round(bps)}B/s`;
  };
  streams.push(`NET RX:${fmtRate(rxBytes)} TX:${fmtRate(txBytes)}`);

  if (typeof metrics.net?.wan_rx_bytes_sec === 'number' || typeof metrics.net?.wan_tx_bytes_sec === 'number') {
    streams.push(
      `WAN ↓${fmtRate(Number(metrics.net.wan_rx_bytes_sec || 0))} ↑${fmtRate(
        Number(metrics.net.wan_tx_bytes_sec || 0)
      )}`
    );
  }
  if (typeof metrics.net?.lan_rx_bytes_sec === 'number' || typeof metrics.net?.lan_tx_bytes_sec === 'number') {
    streams.push(
      `LAN ↓${fmtRate(Number(metrics.net.lan_rx_bytes_sec || 0))} ↑${fmtRate(
        Number(metrics.net.lan_tx_bytes_sec || 0)
      )}`
    );
  }

  const dReadMb = Number(metrics.disk_io?.read_bytes_sec ?? 0) / (1024 * 1024);
  const dWriteMb = Number(metrics.disk_io?.write_bytes_sec ?? 0) / (1024 * 1024);
  const rootDisk = Array.isArray(metrics.disks)
    ? metrics.disks.find((d) => d.mountpoint === '/') || metrics.disks[0]
    : undefined;
  streams.push(`IO R:${dReadMb.toFixed(1)} W:${dWriteMb.toFixed(1)}MB/s`);
  if (typeof rootDisk?.percent === 'number' && Number.isFinite(rootDisk.percent)) {
    streams.push(`DISK ${rootDisk.percent.toFixed(0)}%`);
  }

  const gpuLoad = metrics.gpu?.gpu_util_percent;
  const gpuTemp = metrics.gpu?.temp_c;
  if (metrics.gpu?.available && typeof gpuLoad === 'number' && Number.isFinite(gpuLoad)) {
    const gt = typeof gpuTemp === 'number' && Number.isFinite(gpuTemp) ? ` ${gpuTemp.toFixed(0)}C` : '';
    streams.push(`GPU ${gpuLoad.toFixed(0)}%${gt}`);
  }

  if (metrics.system?.hostname) {
    streams.push(`HOST:${String(metrics.system.hostname).toUpperCase().slice(0, 18)}`);
  }

  const procs = Array.isArray(metrics.system_processes) ? metrics.system_processes : [];
  for (const p of procs.slice(0, 6)) {
    const name = String(p.name || '').replace(/\s+/g, '').slice(0, 12);
    const pCpu = typeof p.cpu_percent === 'number' ? p.cpu_percent.toFixed(1) : '0.0';
    if (name) {
      streams.push(`PID:${p.pid} ${name} ${pCpu}%`);
    }
  }

  const cores = Array.isArray(metrics.cpu?.per_core_percent) ? metrics.cpu.per_core_percent : [];
  if (cores.length > 0) {
    const sample = cores
      .slice(0, 4)
      .map((v, i) => `C${i}:${Math.round(Number(v || 0))}%`)
      .join(' ');
    if (sample) streams.push(sample);
  }

  return streams.length > 0 ? streams : ['TELEMETRY::ACTIVE'];
}

function hexToRgba(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const raw = c.slice(1);
    const full = raw.length === 3 ? raw.split('').map((x) => x + x).join('') : raw;
    if (full.length === 6) {
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }
  return c;
}

export const MatrixTelemetryBackdrop: React.FC<MatrixTelemetryBackdropProps> = ({
  metrics,
  effect,
  mode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamsRef = useRef<string[]>(buildLiveTelemetryStreams(metrics));

  useEffect(() => {
    streamsRef.current = buildLiveTelemetryStreams(metrics);
  }, [metrics]);

  const isMatrix = effect?.type === 'matrix-telemetry';

  useEffect(() => {
    if (!isMatrix) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = mode === 'dark' ? effect?.dark : effect?.light;
    const baseFill = pal?.baseFill || (mode === 'dark' ? '#061007' : '#eaf2e6');
    const fadeAlpha = pal?.fadeAlpha ?? (mode === 'dark' ? 0.13 : 0.14);
    const trailColor = pal?.trailColor || (mode === 'dark' ? 'rgba(56, 178, 92, 0.42)' : 'rgba(24, 114, 58, 0.36)');
    const midColor = pal?.midColor || (mode === 'dark' ? 'rgba(114, 224, 132, 0.68)' : 'rgba(22, 98, 49, 0.58)');
    const headColor = pal?.headColor || (mode === 'dark' ? 'rgba(206, 252, 168, 0.96)' : 'rgba(14, 70, 34, 0.88)');
    const glowColor = pal?.glowColor || (mode === 'dark' ? 'rgba(198, 241, 157, 0.36)' : 'rgba(30, 107, 56, 0.2)');
    const speedMultiplier = pal?.speedMultiplier ?? 1.0;
    const targetFps = Math.max(12, Math.min(45, effect?.fps ?? 28));
    const frameIntervalMs = 1000 / targetFps;
    const fontSize = Math.max(10, Math.min(18, effect?.fontSizePx ?? 13));
    const colSpacing = Math.max(16, Math.min(42, effect?.columnSpacingPx ?? 22));
    const fadeFill = hexToRgba(baseFill, fadeAlpha);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let columns: RainColumn[] = [];
    let rafId = 0;
    let lastTick = 0;

    const pickStream = () => {
      const pool = streamsRef.current;
      const item = pool[Math.floor(Math.random() * pool.length)] || 'SYS::OK';
      return `${item}   `;
    };

    const rebuildColumns = (w: number, h: number) => {
      const count = Math.max(12, Math.ceil(w / colSpacing));
      const rows = Math.max(16, Math.ceil(h / (fontSize * 1.32)));
      const next: RainColumn[] = [];
      for (let i = 0; i < count; i++) {
        const stream = pickStream();
        next.push({
          y: Math.random() * rows - rows * 0.35,
          speed: (0.28 + Math.random() * 0.44) * speedMultiplier,
          stream,
          charIndex: Math.floor(Math.random() * stream.length),
          length: 8 + Math.floor(Math.random() * 14),
        });
      }
      columns = next;
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = baseFill;
      ctx.fillRect(0, 0, width, height);
      rebuildColumns(width, height);
    };

    const drawStaticReducedFrame = () => {
      ctx.fillStyle = baseFill;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `600 ${fontSize}px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';
      const lineH = fontSize * 1.35;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const x = i * colSpacing + 4;
        const startRow = Math.max(0, Math.floor(col.y));
        for (let k = 0; k < col.length; k++) {
          const py = (startRow - k) * lineH;
          if (py < -lineH || py > height) continue;
          const ch = col.stream[(col.charIndex + k) % col.stream.length] || ' ';
          if (ch === ' ') continue;
          ctx.fillStyle = k === 0 ? headColor : k < 3 ? midColor : trailColor;
          ctx.fillText(ch, x, py);
        }
      }
    };

    resize();

    if (prefersReducedMotion) {
      drawStaticReducedFrame();
      const onResizeReduced = () => {
        resize();
        drawStaticReducedFrame();
      };
      window.addEventListener('resize', onResizeReduced, { passive: true });
      return () => {
        window.removeEventListener('resize', onResizeReduced);
      };
    }

    const step = (ts: number) => {
      rafId = window.requestAnimationFrame(step);
      if (
        document.hidden ||
        Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__)
      ) {
        return;
      }
      if (ts - lastTick < frameIntervalMs) return;
      lastTick = ts;

      const lineH = fontSize * 1.32;
      const maxRows = Math.ceil(height / lineH) + 6;

      // Soft veil clears previous frames smoothly into a classic vertical trail
      ctx.fillStyle = fadeFill;
      ctx.fillRect(0, 0, width, height);

      ctx.font = `600 ${fontSize}px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const prevRow = Math.floor(col.y);
        col.y += col.speed;
        const currRow = Math.floor(col.y);

        if (currRow !== prevRow) {
          col.charIndex = (col.charIndex + 1) % Math.max(1, col.stream.length);
        }

        const x = i * colSpacing + 4;
        const py = currRow * lineH;
        const ch = col.stream[col.charIndex] || ' ';

        if (ch !== ' ' && py >= -lineH && py <= height + lineH) {
          // Subtle soft mid-char just behind the bright lead glyph
          const prevChar = col.stream[(col.charIndex - 1 + col.stream.length) % col.stream.length] || ' ';
          if (prevChar !== ' ' && py - lineH >= -lineH) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = midColor;
            ctx.fillText(prevChar, x, py - lineH);
          }

          // Trailing dimmer accent two rows behind
          const trailChar = col.stream[(col.charIndex - 2 + col.stream.length) % col.stream.length] || ' ';
          if (trailChar !== ' ' && py - lineH * 2 >= -lineH) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = trailColor;
            ctx.fillText(trailChar, x, py - lineH * 2);
          }

          // Bright leading glyph with restrained glow
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = mode === 'dark' ? 8 : 3;
          ctx.fillStyle = headColor;
          ctx.fillText(ch, x, py);
          ctx.shadowBlur = 0;
        }

        if (currRow > maxRows && Math.random() > 0.94) {
          col.y = -Math.random() * 14;
          col.stream = pickStream();
          col.charIndex = 0;
          col.speed = (0.28 + Math.random() * 0.44) * speedMultiplier;
        }
      }
    };

    // Pre-seed a few steps so the Matrix rain is visible immediately on first paint
    for (let warm = 0; warm < 14; warm++) {
      ctx.fillStyle = fadeFill;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `600 ${fontSize}px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';
      const lineH = fontSize * 1.32;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        col.y += col.speed * 1.5;
        col.charIndex = (col.charIndex + 1) % Math.max(1, col.stream.length);
        const ch = col.stream[col.charIndex] || ' ';
        const py = Math.floor(col.y) * lineH;
        if (ch !== ' ' && py >= 0 && py <= height) {
          ctx.fillStyle = warm > 11 ? headColor : warm > 7 ? midColor : trailColor;
          ctx.fillText(ch, i * colSpacing + 4, py);
        }
      }
    }

    rafId = window.requestAnimationFrame(step);
    window.addEventListener('resize', resize, { passive: true });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [isMatrix, effect, mode]);

  if (!isMatrix) return null;

  const opacity = (mode === 'dark' ? effect?.dark?.opacity : effect?.light?.opacity) ?? (mode === 'dark' ? 0.92 : 0.88);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="matrix-telemetry-backdrop"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full select-none"
      style={{ opacity }}
    />
  );
};
