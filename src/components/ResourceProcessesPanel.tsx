import React, { useMemo, useState } from 'react';
import { Cpu, HardDrive, ListChecks, MemoryStick, Monitor, Network } from 'lucide-react';
import { MetricsPayload } from '../types/telemetry';
import { formatBytes, formatPct, formatSpeed } from '../utils/formatters';
import { formatGpuProcessName, useI18n } from '../i18n';

export type ResourceProcessKind = 'cpu' | 'ram' | 'gpu' | 'storage' | 'net';

interface ResourceProcessesPanelProps {
  kind: ResourceProcessKind;
  metrics: MetricsPayload | null;
  compact?: boolean;
  onViewAllProcesses?: () => void;
}

interface NormalizedResourceRow {
  pid: string | number;
  name: string;
  user: string;
  pct: number;
  pctLabel: string;
  consumeLabel: string;
  metaLabel?: string;
  sortScore: number;
  barPct: number;
}

export const ResourceProcessesPanel: React.FC<ResourceProcessesPanelProps> = ({
  kind,
  metrics,
  compact = false,
  onViewAllProcesses,
}) => {
  const { t, locale } = useI18n();
  const [expandedList, setExpandedList] = useState(false);

  const defaultLimit = compact ? 8 : 10;
  const maxLimit = compact ? 20 : 25;

  const { rows, accentClass, pillClass, iconEl, titleKey, subKey, emptyKey } = useMemo(() => {
    const sysProcs = metrics?.system_processes ?? [];
    const gpuProcs = metrics?.gpu?.processes ?? [];
    const totalVramMb = Number(metrics?.gpu?.vram_total_mb || 0);

    let outRows: NormalizedResourceRow[] = [];

    if (kind === 'cpu') {
      outRows = sysProcs
        .filter((p) => Number(p.cpu_percent || 0) > 0 || Number(p.cpu_norm_percent || 0) > 0)
        .map((p) => {
          const rawCpu = Number(p.cpu_percent || 0);
          const normPct = Number(p.cpu_norm_percent ?? Math.min(100, rawCpu));
          const coresUsed = Number(p.cpu_cores_used ?? rawCpu / 100);
          const threads = Number(p.num_threads || 1);
          return {
            pid: p.pid,
            name: p.name,
            user: p.user || t('equipment.user_system'),
            pct: normPct,
            pctLabel: formatPct(normPct),
            consumeLabel: t('equipment.active_procs.cpu_consume_val', {
              cores: coresUsed.toFixed(2),
              threads,
              raw: Math.round(rawCpu),
            }),
            sortScore: rawCpu,
            barPct: Math.min(100, Math.max(2, normPct * 2.5)),
          };
        })
        .sort((a, b) => b.sortScore - a.sortScore);
    } else if (kind === 'ram') {
      outRows = sysProcs
        .filter((p) => Number(p.priv_mb ?? p.mem_mb ?? 0) >= 1)
        .map((p) => {
          const privMb = Number(p.priv_mb ?? p.mem_mb ?? 0);
          const sharedMb = Number(p.shared_mb || 0);
          const pct = Number(p.mem_percent || 0);
          const privText = formatBytes(privMb * 1024 * 1024);
          const sharedNote =
            sharedMb >= 5
              ? ` · ${t('equipment.active_procs.ram_shared_note', {
                  shared: formatBytes(sharedMb * 1024 * 1024),
                })}`
              : '';
          return {
            pid: p.pid,
            name: p.name,
            user: p.user || t('equipment.user_system'),
            pct,
            pctLabel: formatPct(pct),
            consumeLabel: `${privText}${sharedNote}`,
            sortScore: privMb,
            barPct: Math.min(100, Math.max(2, pct * 4)),
          };
        })
        .sort((a, b) => b.sortScore - a.sortScore);
    } else if (kind === 'gpu') {
      const mergedMap = new Map<string, NormalizedResourceRow>();

      const resolveGpuType = (rawType?: string) => {
        const up = String(rawType || '').toUpperCase().trim();
        if (up === 'C+G') return t('equipment.active_procs.gpu_type_cg');
        if (up === 'C') return t('equipment.active_procs.gpu_type_c');
        if (up === 'G') return t('equipment.active_procs.gpu_type_g');
        return rawType || '';
      };

      for (const gp of gpuProcs) {
        const pidKey = String(gp.pid || gp.name || '');
        if (!pidKey) continue;
        const vramMb = Number(gp.vram_mb || 0);
        const vramPct =
          Number(gp.vram_percent || 0) ||
          (totalVramMb > 0 && vramMb > 0 ? Math.round((vramMb / totalVramMb) * 1000) / 10 : 0);
        const gpuUtil = gp.gpu_util_percent !== undefined ? gp.gpu_util_percent : null;
        const primaryPct = gpuUtil !== null && gpuUtil !== undefined ? Number(gpuUtil) : vramPct;
        const vramFormatted = formatBytes(vramMb * 1024 * 1024);
        const displayName = formatGpuProcessName(gp, locale);
        const pctLabel =
          gpuUtil !== null && gpuUtil !== undefined
            ? `${formatPct(gpuUtil)} · ${formatPct(vramPct)} VRAM`
            : `${formatPct(vramPct)} VRAM`;

        mergedMap.set(pidKey, {
          pid: gp.pid || '--',
          name: displayName || t('hardware.gpu.proc.gpu_process'),
          user: t('equipment.user_system'),
          pct: primaryPct,
          pctLabel,
          consumeLabel:
            gpuUtil !== null && gpuUtil !== undefined
              ? t('equipment.active_procs.gpu_consume_full', { vram: vramFormatted, gpu: gpuUtil })
              : t('equipment.active_procs.gpu_vram_only', { vram: vramFormatted }),
          metaLabel: resolveGpuType(gp.type),
          sortScore: (gpuUtil !== null && gpuUtil !== undefined ? gpuUtil * 10000 : 0) + vramMb,
          barPct: Math.min(100, Math.max(3, Math.max(Number(gpuUtil || 0), vramPct * 2))),
        });
      }

      for (const p of sysProcs) {
        const vramMb = Number(p.vram_mb || 0);
        const gpuUtil = p.gpu_util_percent;
        if (vramMb <= 0 && (gpuUtil === null || gpuUtil === undefined)) continue;
        const pidKey = String(p.pid);
        const existing = mergedMap.get(pidKey);
        if (existing) {
          existing.user = p.user || existing.user;
          continue;
        }
        const vramPct =
          Number(p.vram_percent || 0) ||
          (totalVramMb > 0 && vramMb > 0 ? Math.round((vramMb / totalVramMb) * 1000) / 10 : 0);
        const vramFormatted = formatBytes(vramMb * 1024 * 1024);
        const primaryPct = gpuUtil !== null && gpuUtil !== undefined ? Number(gpuUtil) : vramPct;
        const pctLabel =
          gpuUtil !== null && gpuUtil !== undefined
            ? `${formatPct(gpuUtil)} · ${formatPct(vramPct)} VRAM`
            : `${formatPct(vramPct)} VRAM`;

        mergedMap.set(pidKey, {
          pid: p.pid,
          name: p.name,
          user: p.user || t('equipment.user_system'),
          pct: primaryPct,
          pctLabel,
          consumeLabel:
            gpuUtil !== null && gpuUtil !== undefined
              ? t('equipment.active_procs.gpu_consume_full', { vram: vramFormatted, gpu: gpuUtil })
              : t('equipment.active_procs.gpu_vram_only', { vram: vramFormatted }),
          metaLabel: resolveGpuType(p.gpu_type),
          sortScore: (gpuUtil !== null && gpuUtil !== undefined ? gpuUtil * 10000 : 0) + vramMb,
          barPct: Math.min(100, Math.max(3, Math.max(Number(gpuUtil || 0), vramPct * 2))),
        });
      }

      outRows = Array.from(mergedMap.values()).sort((a, b) => b.sortScore - a.sortScore);
    } else if (kind === 'storage') {
      const liveIo = sysProcs.filter((p) => Number(p.io_total_bps || 0) > 0);
      const source =
        liveIo.length > 0
          ? liveIo
          : sysProcs.filter(
              (p) => Number(p.io_read_total_bytes || 0) + Number(p.io_write_total_bytes || 0) >= 1024 * 1024
            );
      outRows = source
        .map((p) => {
          const rBps = Number(p.io_read_bps || 0);
          const wBps = Number(p.io_write_bps || 0);
          const totBps = Number(p.io_total_bps || 0);
          const ioPct = Number(p.io_percent || 0);
          const rTot = Number(p.io_read_total_bytes || 0);
          const wTot = Number(p.io_write_total_bytes || 0);
          const consumeText =
            totBps > 0
              ? `↓ ${formatSpeed(rBps)} · ↑ ${formatSpeed(wBps)}`
              : t('equipment.active_procs.storage_accumulated', {
                  read: formatBytes(rTot),
                  write: formatBytes(wTot),
                });
          const metaText =
            totBps > 0 && rTot + wTot > 0
              ? t('equipment.active_procs.storage_accumulated', {
                  read: formatBytes(rTot),
                  write: formatBytes(wTot),
                })
              : undefined;
          return {
            pid: p.pid,
            name: p.name,
            user: p.user || t('equipment.user_system'),
            pct: ioPct,
            pctLabel: formatPct(ioPct),
            consumeLabel: consumeText,
            metaLabel: metaText,
            sortScore: totBps > 0 ? totBps * 1e6 + rTot + wTot : rTot + wTot,
            barPct: totBps > 0 ? Math.min(100, Math.max(4, ioPct)) : 3,
          };
        })
        .sort((a, b) => b.sortScore - a.sortScore);
    } else {
      outRows = sysProcs
        .filter((p) => Number(p.net_connections || 0) > 0)
        .map((p) => {
          const conns = Number(p.net_connections || 0);
          const est = Number(p.net_established || 0);
          const pct = Number(p.net_percent || 0);
          return {
            pid: p.pid,
            name: p.name,
            user: p.user || t('equipment.user_system'),
            pct,
            pctLabel: formatPct(pct),
            consumeLabel: t('equipment.active_procs.net_consume_val', { est, total: conns }),
            metaLabel: p.net_ports || undefined,
            sortScore: est * 100 + conns,
            barPct: Math.min(100, Math.max(3, pct * 1.5)),
          };
        })
        .sort((a, b) => b.sortScore - a.sortScore);
    }

    const stylesMap: Record<
      ResourceProcessKind,
      {
        accentClass: string;
        pillClass: string;
        iconEl: React.ReactNode;
        titleKey: string;
        subKey: string;
        emptyKey: string;
      }
    > = {
      cpu: {
        accentClass: 'bg-[#1e6b38] dark:bg-[#c6f19d]',
        pillClass: 'cockpit-pill-cyan',
        iconEl: <Cpu className="h-4 w-4" />,
        titleKey: 'equipment.active_procs.cpu_title',
        subKey: 'equipment.active_procs.subtitle_cpu',
        emptyKey: 'equipment.active_procs.empty_cpu',
      },
      ram: {
        accentClass: 'bg-[#10b981] dark:bg-[#34d399]',
        pillClass: 'cockpit-pill-emerald',
        iconEl: <MemoryStick className="h-4 w-4" />,
        titleKey: 'equipment.active_procs.ram_title',
        subKey: 'equipment.active_procs.subtitle_ram',
        emptyKey: 'equipment.active_procs.empty_ram',
      },
      gpu: {
        accentClass: 'bg-[#7c3aed] dark:bg-[#a78bfa]',
        pillClass: 'cockpit-pill-violet',
        iconEl: <Monitor className="h-4 w-4" />,
        titleKey: 'equipment.active_procs.gpu_title',
        subKey: 'equipment.active_procs.subtitle_gpu',
        emptyKey: 'equipment.active_procs.empty_gpu',
      },
      storage: {
        accentClass: 'bg-[#f59e0b] dark:bg-[#fbbf24]',
        pillClass: 'cockpit-pill-amber',
        iconEl: <HardDrive className="h-4 w-4" />,
        titleKey: 'equipment.active_procs.storage_title',
        subKey: 'equipment.active_procs.subtitle_storage',
        emptyKey: 'equipment.active_procs.empty_storage',
      },
      net: {
        accentClass: 'bg-[#1e6b38] dark:bg-[#c6f19d]',
        pillClass: 'cockpit-pill-cyan',
        iconEl: <Network className="h-4 w-4" />,
        titleKey: 'equipment.active_procs.net_title',
        subKey: 'equipment.active_procs.subtitle_net',
        emptyKey: 'equipment.active_procs.empty_net',
      },
    };

    return {
      rows: outRows,
      ...stylesMap[kind],
    };
  }, [kind, metrics?.system_processes, metrics?.gpu?.processes, metrics?.gpu?.vram_total_mb, t]);

  const visibleLimit = expandedList ? maxLimit : defaultLimit;
  const visibleRows = rows.slice(0, visibleLimit);

  return (
    <div className={compact ? 'cockpit-subtile mt-3 p-3.5' : 'cockpit-bento p-5'}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`${pillClass} inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl`}>
            {iconEl}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                {t(titleKey)}
              </h3>
              <span className={`${pillClass} rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums`}>
                {t('equipment.active_procs.count_badge', { count: rows.length })}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{t(subKey)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {rows.length > defaultLimit && (
            <button
              type="button"
              onClick={() => setExpandedList((v) => !v)}
              className="cockpit-subtile min-h-[34px] rounded-xl px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-sky-300"
            >
              {expandedList
                ? t('equipment.active_procs.show_less', { count: defaultLimit })
                : t('equipment.active_procs.show_more', { count: Math.min(rows.length, maxLimit) })}
            </button>
          )}
          {onViewAllProcesses && (
            <button
              type="button"
              onClick={onViewAllProcesses}
              className="cockpit-subtile inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-slate-100 dark:text-sky-300 dark:hover:bg-slate-800"
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span>{t('equipment.active_procs.open_full_table')}</span>
            </button>
          )}
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">{t(emptyKey)}</div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/70 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="py-2 pr-3 font-medium">{t('equipment.col_program')}</th>
                <th className="py-2 px-3 font-medium">{t('equipment.active_procs.col_consume')}</th>
                <th className="py-2 pl-3 text-right font-medium">{t('equipment.active_procs.col_share')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
              {visibleRows.map((row) => (
                <tr key={`${kind}-${row.pid}-${row.name}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-2 pr-3 min-w-[140px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-semibold text-slate-900 dark:text-slate-100 max-w-[220px] sm:max-w-[300px]">
                        {row.name}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-slate-400">
                      {t('equipment.pid_label', { pid: row.pid })} · {row.user}
                      {row.metaLabel ? ` · ${row.metaLabel}` : ''}
                    </p>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    <div>{row.consumeLabel}</div>
                    <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${accentClass}`}
                        style={{ width: `${Math.min(100, Math.max(3, row.barPct))}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    <span className={`${pillClass} inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums`}>
                      {row.pctLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

