import Link from 'next/link';
import type { CaseListItem } from '@tilik/shared/contracts';
import { DetectorBadge, SeverityBadge, StatusBadge } from '../ui/badge';

/** The case list. A real <table> (fixed order, no sort UI), in a labelled scroll region; collapses to
 * cards on small screens (see `.case-table` in globals.css). Row links use prefetch={false} so a prefetch
 * never triggers the audited detail read. */
export function CaseTable({ items }: { items: CaseListItem[] }) {
  return (
    <div
      role="region"
      aria-label="Cases"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border"
    >
      <table className="case-table w-full border-collapse text-sm">
        <caption className="sr-only">Fraud cases, ordered by severity then most recent.</caption>
        <thead className="bg-canvas text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">
              Case
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Severity
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Detectors
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Status
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-canvas/60">
              <td data-label="Case" className="px-4 py-3">
                <Link
                  prefetch={false}
                  href={`/cases/${c.id}`}
                  className="font-mono text-brand-blue hover:underline"
                  title={c.id}
                >
                  {c.id.slice(0, 10)}…
                </Link>
                <span className="ml-2 text-xs text-muted">
                  {c.findingCount} finding{c.findingCount === 1 ? '' : 's'}
                </span>
              </td>
              <td data-label="Severity" className="px-4 py-3">
                <SeverityBadge severity={c.severity} />
              </td>
              <td data-label="Detectors" className="px-4 py-3">
                <span className="flex flex-wrap gap-1">
                  {c.detectors.map((d) => (
                    <DetectorBadge key={d} detector={d} />
                  ))}
                </span>
              </td>
              <td data-label="Status" className="px-4 py-3">
                <StatusBadge status={c.status} />
              </td>
              <td data-label="Created" className="px-4 py-3 font-mono text-muted">
                {c.createdAt.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
