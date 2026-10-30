/** Label · big mono value · optional sub, with a colored top rule. No icon chip, no fake trend delta. */
export function StatCard({
  label,
  value,
  sub,
  accentClass = 'border-t-brand-navy',
  emphasize = false,
}: {
  label: string;
  value: number;
  sub?: string;
  accentClass?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border border-t-[3px] bg-surface p-4 shadow-sm ${accentClass}`}
    >
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div
        className={`mt-1 font-mono tabular-nums ${emphasize ? 'text-4xl text-brand-ink' : 'text-3xl text-brand-ink'}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
