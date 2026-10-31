/** Dashed panel for a genuine "nothing here yet" state. Pass a role-aware action via `action`. */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-14 text-center"
    >
      <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
