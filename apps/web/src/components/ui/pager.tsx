import Link from 'next/link';

/** Offset pager. Rendered only when there's more than one page. Preserves active filters in each href. */
export function Pager({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);

  const href = (p: number): string => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    return qs ? `/cases?${qs}` : '/cases';
  };

  const linkCls =
    'rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-brand-blue hover:bg-canvas';
  const disabledCls =
    'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted opacity-50';

  return (
    <nav aria-label="Cases pagination" className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted">
        Page {page} of {pages} · {total} cases
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkCls}>
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledCls}>
            Previous
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={linkCls}>
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledCls}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
