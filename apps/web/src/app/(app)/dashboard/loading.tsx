// Structural skeleton mirroring the dashboard grid (not a page spinner). Inlined here — App Router's
// loading.tsx is exactly the home for this single-use markup (review P3-17).
export default function DashboardLoading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <p role="status" className="sr-only">
        Loading case statistics…
      </p>
      <div className="h-7 w-48 rounded bg-border" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-32 rounded-lg border border-border bg-surface" />
    </div>
  );
}
