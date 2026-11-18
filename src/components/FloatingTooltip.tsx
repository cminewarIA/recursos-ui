import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipSeriesEntry {
  label: string;
  value: string;
  color: string;
}

export interface FloatingTooltipData {
  visible: boolean;
  clientX: number;
  clientY: number;
  title: string;
  subtitle?: string;
  entries: TooltipSeriesEntry[];
}

export const FloatingTooltip: React.FC<{ data: FloatingTooltipData | null }> = ({ data }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!data || !data.visible || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    let left = data.clientX + 14;
    if (left + rect.width + margin > vw) {
      left = Math.max(margin, data.clientX - rect.width - 14);
    }

    let top = data.clientY - rect.height - 12;
    if (top < margin) {
      top = Math.min(vh - rect.height - margin, data.clientY + 16);
    }

    setPos({ left, top });
  }, [data]);

  if (!data || !data.visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      className="cockpit-tooltip-enter pointer-events-none fixed z-[9999] min-w-[178px] max-w-[268px] rounded-xl border border-slate-700/80 bg-[#0f172a]/95 px-3 py-2.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md transition-opacity duration-100 dark:border-slate-600/80 dark:bg-[#020617]/95"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-slate-800 pb-1">
        <span className="font-mono text-[11px] font-semibold tabular-nums text-white">
          {data.title}
        </span>
        {data.subtitle ? (
          <span className="text-[11px] text-slate-400">{data.subtitle}</span>
        ) : null}
      </div>
      <div className="space-y-1">
        {data.entries.map((entry, idx) => (
          <div key={`${entry.label}-${idx}`} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate">{entry.label}</span>
            </span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-sky-300">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
};
