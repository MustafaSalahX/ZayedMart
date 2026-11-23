import React from 'react';

export function SkeletonKpiStrip({ count = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-2.5 ${className}`} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="g-card h-[84px] p-4 animate-pulse flex flex-col justify-between gap-2"
        >
          <div className="h-3 w-16 rounded bg-surface-2" />
          <div className="h-6 w-12 rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ count, rows, className = '' }) {
  const n = count ?? rows ?? 4;
  return (
    <div className={`g-grouped-list divide-y divide-line-subtle ${className}`} aria-busy="true">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-3.5 animate-pulse flex items-center justify-between gap-3"
        >
          <div className="space-y-2 flex-1">
            <div className="h-3.5 w-2/5 rounded bg-surface-2" />
            <div className="h-3 w-3/5 rounded bg-surface-2" />
          </div>
          <div className="h-7 w-14 rounded-[var(--g-radius-sm)] bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
