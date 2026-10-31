import type { CaseDetail } from '@tilik/shared/contracts';
import { SeverityBadge, StatusBadge, VerdictBadge } from '../ui/badge';
import { DecisionPanel } from './decision-panel';

/** Case detail header: id, severity, status, provenance, and the reviewer's decision (Prompt 12). */
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
        {/* The status is the lifecycle (escalated/closed/pending); the verdict badge is the authoritative
            outcome — essential so a decided NEEDS_MORE_INFO ("Pending") isn't misread as still actionable. */}
        {kase.decision && <VerdictBadge verdict={kase.decision.verdict} />}
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

      <DecisionPanel caseId={kase.id} decision={kase.decision} />
    </div>
  );
}
