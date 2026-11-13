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
      className="pointer-events-none fixed z-[9999] min-w-[172px] max-w-[260px] rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-xs text-slate-900 shadow-lg backdrop-blur-md transition-opacity duration-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800">
        <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {data.title}
        </span>
        {data.subtitle ? (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{data.subtitle}</span>
        ) : null}
      </div>
      <div className="space-y-1">
        {data.entries.map((entry, idx) => (
          <div key={`${entry.label}-${idx}`} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate">{entry.label}</span>
            </span>
            <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-900 dark:text-white">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
};
