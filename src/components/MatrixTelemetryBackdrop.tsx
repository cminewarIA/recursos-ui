import React, { useEffect, useRef } from 'react';
import { MetricsPayload, ThemeMode } from '../types/telemetry';
import { ThemeBackdropConfig, ThemeBackgroundEffect } from '../themes/types';

interface MatrixTelemetryBackdropProps {
  metrics: MetricsPayload | null;
  effect?: ThemeBackgroundEffect;
  backdropUrl?: string | null;
  backdropConfig?: ThemeBackdropConfig;
  mode: ThemeMode;
}

interface RainColumn {
  y: number;
  speed: number;
  stream: string;
  charIndex: number;
  length: number;
}

interface Snowflake {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  phase: number;
  depth: number;
}

interface UrbanRainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
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
  backdropUrl,
  backdropConfig,
  mode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamsRef = useRef<string[]>(buildLiveTelemetryStreams(metrics));

  useEffect(() => {
    streamsRef.current = buildLiveTelemetryStreams(metrics);
  }, [metrics]);

  const effectType = effect?.type || 'none';
  const hasCanvasEffect = effectType !== 'none';

  useEffect(() => {
    if (!hasCanvasEffect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = mode === 'dark' ? effect?.dark : effect?.light;
    const speedMultiplier = pal?.speedMultiplier ?? 1.0;
    const targetFps = Math.max(12, Math.min(45, effect?.fps ?? 28));
    const frameIntervalMs = 1000 / targetFps;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastTick = 0;

    // ------------------------------------------------------------------------
    // EFFECT 1: MATRIX TELEMETRY RAIN
    // ------------------------------------------------------------------------
    if (effectType === 'matrix-telemetry') {
      const baseFill = pal?.baseFill || (mode === 'dark' ? '#061007' : '#edf6e9');
      const fadeAlpha = pal?.fadeAlpha ?? (mode === 'dark' ? 0.13 : 0.12);
      const trailColor = pal?.trailColor || (mode === 'dark' ? 'rgba(56, 178, 92, 0.42)' : 'rgba(26, 146, 70, 0.48)');
      const midColor = pal?.midColor || (mode === 'dark' ? 'rgba(114, 224, 132, 0.68)' : 'rgba(18, 122, 56, 0.74)');
      const headColor = pal?.headColor || (mode === 'dark' ? 'rgba(206, 252, 168, 0.96)' : 'rgba(10, 78, 36, 0.96)');
      const glowColor = pal?.glowColor || (mode === 'dark' ? 'rgba(198, 241, 157, 0.36)' : 'rgba(34, 156, 78, 0.30)');
      const fontSize = Math.max(10, Math.min(18, effect?.fontSizePx ?? 13));
      const colSpacing = Math.max(16, Math.min(42, effect?.columnSpacingPx ?? 22));
      const fadeFill = hexToRgba(baseFill, fadeAlpha);

      let columns: RainColumn[] = [];
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
        return () => window.removeEventListener('resize', onResizeReduced);
      }

      const step = (ts: number) => {
        rafId = window.requestAnimationFrame(step);
        if (document.hidden || Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__)) {
          return;
        }
        if (ts - lastTick < frameIntervalMs) return;
        lastTick = ts;

        const lineH = fontSize * 1.32;
        const maxRows = Math.ceil(height / lineH) + 6;
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
            const prevChar = col.stream[(col.charIndex - 1 + col.stream.length) % col.stream.length] || ' ';
            if (prevChar !== ' ' && py - lineH >= -lineH) {
              ctx.shadowBlur = 0;
              ctx.fillStyle = midColor;
              ctx.fillText(prevChar, x, py - lineH);
            }
            const trailChar = col.stream[(col.charIndex - 2 + col.stream.length) % col.stream.length] || ' ';
            if (trailChar !== ' ' && py - lineH * 2 >= -lineH) {
              ctx.shadowBlur = 0;
              ctx.fillStyle = trailColor;
              ctx.fillText(trailChar, x, py - lineH * 2);
            }
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = mode === 'dark' ? 8 : 4;
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
    }

    // ------------------------------------------------------------------------
    // EFFECT 2: WINTER SNOWFALL (Navidad · Escarcha Invernal)
    // ------------------------------------------------------------------------
    if (effectType === 'snowfall') {
      const flakeColor = pal?.headColor || 'rgba(255, 255, 255, 0.94)';
      const midColor = pal?.midColor || 'rgba(186, 230, 253, 0.78)';
      const glowColor = pal?.glowColor || 'rgba(186, 230, 253, 0.5)';
      let flakes: Snowflake[] = [];

      const rebuildFlakes = (w: number, h: number) => {
        const count = Math.max(55, Math.min(140, Math.floor((w * h) / 14500)));
        flakes = Array.from({ length: count }, () => {
          const depth = 0.35 + Math.random() * 0.95; // 3-layer parallax feel
          return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: 1.1 + depth * 2.5,
            vy: (0.45 + depth * 1.25) * speedMultiplier,
            vx: (Math.random() - 0.5) * 0.45,
            phase: Math.random() * Math.PI * 2,
            depth,
          };
        });
      };

      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rebuildFlakes(width, height);
      };

      const drawFlakes = (timeSec: number, animate: boolean) => {
        ctx.clearRect(0, 0, width, height);
        for (const f of flakes) {
          if (animate) {
            f.y += f.vy;
            f.x += f.vx + Math.sin(timeSec * 0.8 + f.phase) * 0.42 * f.depth;
            if (f.y > height + 8) {
              f.y = -8;
              f.x = Math.random() * width;
            }
            if (f.x < -10) f.x = width + 10;
            if (f.x > width + 10) f.x = -10;
          }
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fillStyle = f.depth > 0.85 ? flakeColor : midColor;
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = f.depth > 0.95 ? 7 : 2;
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      };

      resize();
      if (prefersReducedMotion) {
        drawFlakes(0, false);
        const onResize = () => {
          resize();
          drawFlakes(0, false);
        };
        window.addEventListener('resize', onResize, { passive: true });
        return () => window.removeEventListener('resize', onResize);
      }

      const step = (ts: number) => {
        rafId = window.requestAnimationFrame(step);
        if (document.hidden || Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__)) {
          return;
        }
        if (ts - lastTick < frameIntervalMs) return;
        lastTick = ts;
        drawFlakes(ts / 1000, true);
      };
      rafId = window.requestAnimationFrame(step);
      window.addEventListener('resize', resize, { passive: true });
      return () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
      };
    }

    // ------------------------------------------------------------------------
    // EFFECT 3: CYBERPUNK 2077 NETRUNNER HUD GRID + SCANLINE SWEEP
    // ------------------------------------------------------------------------
    if (effectType === 'cyber-grid') {
      const scanColor = pal?.headColor || 'rgba(252, 238, 9, 0.36)';
      const gridColor = pal?.midColor || 'rgba(0, 240, 255, 0.14)';
      const crimsonColor = pal?.trailColor || 'rgba(255, 0, 60, 0.16)';

      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      const drawCyber = (ts: number) => {
        ctx.clearRect(0, 0, width, height);
        const stepPx = 56;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < width; x += stepPx) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, height);
        }
        for (let y = 0; y < height; y += stepPx) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(width, y + 0.5);
        }
        ctx.stroke();

        // Subtle scanline sweep
        const sweepY = ((ts * 0.08 * speedMultiplier) % (height + 160)) - 80;
        const grad = ctx.createLinearGradient(0, sweepY - 50, 0, sweepY + 14);
        grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
        grad.addColorStop(0.7, gridColor);
        grad.addColorStop(0.95, scanColor);
        grad.addColorStop(1, 'rgba(252, 238, 9, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, sweepY - 50, width, 64);

        // Tactical corner reticles
        ctx.strokeStyle = crimsonColor;
        ctx.lineWidth = 1.5;
        const m = 14;
        const l = 22;
        ctx.beginPath();
        ctx.moveTo(width - m - l, m);
        ctx.lineTo(width - m, m);
        ctx.lineTo(width - m, m + l);
        ctx.moveTo(width - m - l, height - m);
        ctx.lineTo(width - m, height - m);
        ctx.lineTo(width - m, height - m - l);
        ctx.stroke();
      };

      resize();
      if (prefersReducedMotion) {
        drawCyber(0);
        const onResize = () => {
          resize();
          drawCyber(0);
        };
        window.addEventListener('resize', onResize, { passive: true });
        return () => window.removeEventListener('resize', onResize);
      }

      const step = (ts: number) => {
        rafId = window.requestAnimationFrame(step);
        if (document.hidden || Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__)) {
          return;
        }
        if (ts - lastTick < frameIntervalMs) return;
        lastTick = ts;
        drawCyber(ts);
      };
      rafId = window.requestAnimationFrame(step);
      window.addEventListener('resize', resize, { passive: true });
      return () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
      };
    }

    // ------------------------------------------------------------------------
    // EFFECT 4: URBAN RAIN (GTA III / GTA IV Liberty City Noir)
    // ------------------------------------------------------------------------
    if (effectType === 'urban-rain') {
      const dropColor = pal?.headColor || 'rgba(186, 212, 232, 0.30)';
      let drops: UrbanRainDrop[] = [];

      const rebuildDrops = (w: number, h: number) => {
        const count = Math.max(45, Math.min(120, Math.floor(w / 14)));
        drops = Array.from({ length: count }, () => ({
          x: Math.random() * (w + 160) - 80,
          y: Math.random() * h,
          len: 14 + Math.random() * 22,
          speed: (9 + Math.random() * 7) * speedMultiplier,
          alpha: 0.25 + Math.random() * 0.65,
        }));
      };

      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rebuildDrops(width, height);
      };

      const drawRain = (animate: boolean) => {
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = dropColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const d of drops) {
          if (animate) {
            d.y += d.speed;
            d.x -= d.speed * 0.16;
            if (d.y > height + d.len) {
              d.y = -d.len - Math.random() * 60;
              d.x = Math.random() * (width + 160) - 40;
            }
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * 0.16, d.y + d.len);
        }
        ctx.stroke();
      };

      resize();
      if (prefersReducedMotion) {
        drawRain(false);
        const onResize = () => {
          resize();
          drawRain(false);
        };
        window.addEventListener('resize', onResize, { passive: true });
        return () => window.removeEventListener('resize', onResize);
      }

      const step = (ts: number) => {
        rafId = window.requestAnimationFrame(step);
        if (document.hidden || Boolean((window as unknown as { __RECURSOS_PAUSED__?: boolean }).__RECURSOS_PAUSED__)) {
          return;
        }
        if (ts - lastTick < frameIntervalMs) return;
        lastTick = ts;
        drawRain(true);
      };
      rafId = window.requestAnimationFrame(step);
      window.addEventListener('resize', resize, { passive: true });
      return () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
      };
    }

    return undefined;
  }, [hasCanvasEffect, effectType, effect, mode]);

  const opacity =
    (mode === 'dark' ? effect?.dark?.opacity : effect?.light?.opacity) ??
    (mode === 'dark' ? 0.92 : 0.90);
  const scrimColor =
    mode === 'dark'
      ? backdropConfig?.scrimDark || 'rgba(8, 12, 18, 0.52)'
      : backdropConfig?.scrimLight || 'rgba(240, 248, 255, 0.42)';
  const blurPx = backdropConfig?.blurPx ?? 0;

  if (!backdropUrl && !hasCanvasEffect) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="matrix-telemetry-backdrop"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {backdropUrl ? (
        <>
          <img
            src={backdropUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center transition-opacity duration-300"
            style={blurPx > 0 ? { filter: `blur(${blurPx}px)`, transform: 'scale(1.03)' } : undefined}
          />
          <div
            className="absolute inset-0 transition-colors duration-300"
            style={{ backgroundColor: scrimColor }}
          />
        </>
      ) : null}

      {hasCanvasEffect ? (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ opacity }}
        />
      ) : null}
    </div>
  );
};
