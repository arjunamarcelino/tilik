// Skeleton for the case list (also the prefetch boundary for this segment).
export default function CasesLoading() {
  return (
    <div aria-busy="true" className="flex animate-pulse flex-col gap-5">
      <p role="status" className="sr-only">
        Loading cases…
      </p>
      <div className="h-7 w-32 rounded bg-border" />
      <div className="h-9 w-80 rounded bg-surface" />
      <div className="rounded-lg border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 border-t border-border first:border-t-0" />
        ))}
      </div>
    </div>
  );
}
