'use client';

/** Friendly error surface — fixed copy (never the raw error), optional retry. */
export function ErrorState({
  title = 'Something went wrong',
  message = 'We couldn’t load this just now. Please try again.',
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-sev-high/30 bg-sev-high-bg px-6 py-10 text-center"
    >
      <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-brand-ink hover:bg-canvas"
        >
          Try again
        </button>
      )}
    </div>
  );
}
