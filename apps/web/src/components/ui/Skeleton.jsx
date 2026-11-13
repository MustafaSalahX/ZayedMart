import React from 'react';

export function SkeletonKpiStrip({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[76px] rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] p-3.5 animate-pulse flex items-center justify-between"
        >
          <div className="space-y-2 flex-1">
            <div className="h-3 w-16 rounded bg-[var(--g-surface-variant)]" />
            <div className="h-6 w-10 rounded bg-[var(--g-surface-variant)]" />
          </div>
          <div className="w-10 h-10 rounded-xl bg-[var(--g-surface-variant)]" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ count = 4 }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="g-card p-4 animate-pulse flex items-center justify-between gap-3"
        >
          <div className="space-y-2 flex-1">
            <div className="h-4 w-2/5 rounded bg-[var(--g-surface-variant)]" />
            <div className="h-3 w-3/5 rounded bg-[var(--g-surface-variant)]" />
          </div>
          <div className="h-9 w-20 rounded-xl bg-[var(--g-surface-variant)]" />
        </div>
      ))}
    </div>
  );
}
