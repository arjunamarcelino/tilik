import type { CaseDetail } from '@tilik/shared/contracts';
import { SeverityBadge, StatusBadge } from '../ui/badge';

/** Case detail header: id, severity, status, provenance, and a placeholder for Prompt 12's decision. */
export function CaseHeader({ kase }: { kase: CaseDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1
          tabIndex={-1}
          className="font-mono text-xl font-semibold text-brand-ink outline-none"
          title={kase.id}
        >
          Case {kase.id.slice(0, 10)}…
        </h1>
        <SeverityBadge severity={kase.severity} />
        <StatusBadge status={kase.status} />
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
        <div>
          <dt className="inline font-medium">Facility:</dt>{' '}
          <dd className="inline">{kase.facilityId}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Patient token:</dt>{' '}
          <dd className="inline font-mono" title={kase.patientToken}>
            {kase.patientToken.slice(0, 16)}…
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Assigned:</dt>{' '}
          <dd className="inline">{kase.assignedTo ?? 'Unassigned'}</dd>
        </div>
      </dl>

      <div className="rounded-md border border-dashed border-border bg-canvas px-3 py-2 text-xs text-muted">
        Decision actions (confirm / reject / escalate) land in Prompt 12.
      </div>
    </div>
  );
}
