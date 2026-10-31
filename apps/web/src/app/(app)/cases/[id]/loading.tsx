// Skeleton for case detail. Crucially also the prefetch boundary: uncached work below it (the audited
// getCase read) is excluded from <Link> prefetch, so a prefetch never writes a phantom VIEW_CASE.
export default function CaseDetailLoading() {
  return (
    <div aria-busy="true" className="flex animate-pulse flex-col gap-6">
      <p role="status" className="sr-only">
        Loading case…
      </p>
      <div className="h-4 w-28 rounded bg-border" />
      <div className="h-7 w-64 rounded bg-border" />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 rounded-lg border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
