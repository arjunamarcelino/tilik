import { Severity } from '@tilik/shared';
import type { CaseStats } from '@tilik/shared/contracts';

const ROWS: { key: Severity; label: string; bar: string; text: string }[] = [
  { key: Severity.HIGH, label: 'High', bar: 'bg-sev-high', text: 'text-sev-high' },
  { key: Severity.MEDIUM, label: 'Medium', bar: 'bg-sev-med', text: 'text-sev-med' },
  { key: Severity.LOW, label: 'Low', bar: 'bg-sev-low', text: 'text-sev-low' },
];

/** Open cases by severity: one stacked bar + a labelled legend (never color-alone). */
export function SeverityBar({ bySeverity }: { bySeverity: CaseStats['bySeverity'] }) {
  const total = ROWS.reduce((sum, r) => sum + bySeverity[r.key], 0);
  const summary = ROWS.map((r) => `${bySeverity[r.key]} ${r.label.toLowerCase()}`).join(', ');

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        Open cases by severity
      </h2>

      <div
        role="img"
        aria-label={`Open cases by severity: ${summary}`}
        className="mt-3 flex h-3 overflow-hidden rounded-full bg-canvas"
      >
        {total > 0 &&
          ROWS.map((r) => {
            const pct = (bySeverity[r.key] / total) * 100;
            return pct > 0 ? (
              <span key={r.key} className={r.bar} style={{ width: `${pct}%` }} />
            ) : null;
          })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${r.bar}`} aria-hidden="true" />
            <span className="text-brand-ink/80">{r.label}</span>
            <span className={`font-mono tabular-nums font-semibold ${r.text}`}>
              {bySeverity[r.key]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
