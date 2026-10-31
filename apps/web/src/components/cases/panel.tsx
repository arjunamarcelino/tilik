/** A titled card section used for each case-detail panel, with an optional count chip. */
export function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-brand-ink">
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-normal text-muted">
            {count}
          </span>
        )}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** MEDICAL_RECORD → "Medical record". */
export function labelKind(kind: string): string {
  return (kind.charAt(0) + kind.slice(1).toLowerCase()).replace(/_/g, ' ');
}
