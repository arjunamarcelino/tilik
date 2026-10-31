'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DETECTOR_LABEL, SEVERITY_LABEL, STATUS_LABEL } from './labels';

const FILTERS = [
  { name: 'status', label: 'Status', labels: STATUS_LABEL },
  { name: 'severity', label: 'Severity', labels: SEVERITY_LABEL },
  { name: 'detector', label: 'Detector', labels: DETECTOR_LABEL },
] satisfies ReadonlyArray<{ name: string; label: string; labels: Record<string, string> }>;

/** Filter controls that only rewrite the URL (the server page re-queries). router.replace keeps filter
 * churn out of history; `page` resets on any change so you never land on an empty page of a smaller set. */
export function CaseFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function update(name: string, value: string): void {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete('page');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  const active = FILTERS.some((f) => sp.get(f.name));

  return (
    <div className="flex flex-wrap items-end gap-3">
      {FILTERS.map((f) => (
        <div key={f.name} className="flex flex-col gap-1">
          <label htmlFor={`filter-${f.name}`} className="text-xs font-medium text-muted">
            {f.label}
          </label>
          <select
            id={`filter-${f.name}`}
            value={sp.get(f.name) ?? ''}
            onChange={(e) => update(f.name, e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-brand-ink"
          >
            <option value="">All</option>
            {Object.entries(f.labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
      {active && (
        <button
          type="button"
          onClick={() => router.replace(pathname)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium text-brand-blue hover:bg-canvas"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
