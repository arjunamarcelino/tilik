import type { Metadata } from 'next';
import { CaseStatus, DetectorType, Role, Severity } from '@tilik/shared';
import { CaseFilters } from '@/components/cases/case-filters';
import { CaseTable } from '@/components/cases/case-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Pager } from '@/components/ui/pager';
import { getCases, requireRole, type CaseListFilters } from '@/lib/dal';

export const metadata: Metadata = { title: 'Cases — Tilik' };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

// Only pass a filter through if it's a known enum value — a hand-edited/garbage querystring is ignored
// (defaults), never 400s the API or 500s the page.
const oneOf = <T extends string>(values: readonly T[], v: string | undefined): T | undefined =>
  v && (values as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function CasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireRole(Role.REVIEWER);
  const sp = await searchParams;

  const page = Math.max(1, Number(first(sp.page)) || 1);
  const filters: CaseListFilters = {
    status: oneOf(Object.values(CaseStatus), first(sp.status)),
    severity: oneOf(Object.values(Severity), first(sp.severity)),
    detector: oneOf(Object.values(DetectorType), first(sp.detector)),
    page,
  };
  const hasFilters = Boolean(filters.status || filters.severity || filters.detector);

  const { items, total, pageSize } = await getCases(filters);

  return (
    <section className="flex flex-col gap-5">
      <h1 tabIndex={-1} className="text-xl font-semibold text-brand-ink outline-none">
        Cases
      </h1>

      <CaseFilters />

      <p role="status" aria-live="polite" className="text-sm text-muted">
        {total} case{total === 1 ? '' : 's'}
        {hasFilters ? ' match your filters' : ''}
      </p>

      {items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No cases match these filters"
            message="Try widening or clearing the filters to see more cases."
            action={
              <a href="/cases" className="text-sm font-medium text-brand-blue underline">
                Clear filters
              </a>
            }
          />
        ) : (
          <EmptyState
            title="No cases yet"
            message="Cases appear here after an import runs and the detectors complete."
          />
        )
      ) : (
        <>
          <CaseTable items={items} />
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            params={{
              status: filters.status,
              severity: filters.severity,
              detector: filters.detector,
            }}
          />
        </>
      )}
    </section>
  );
}
