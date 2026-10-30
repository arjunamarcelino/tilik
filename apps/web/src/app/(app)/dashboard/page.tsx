import type { Metadata } from 'next';
import { CaseStatus } from '@tilik/shared';
import { getCaseStats, requireSession } from '@/lib/dal';
import { EmptyState } from '@/components/ui/empty-state';
import { SeverityBar } from '@/components/ui/severity-bar';
import { StatCard } from '@/components/ui/stat-card';

export const metadata: Metadata = { title: 'Dashboard — Tilik' };

const PIPELINE: { key: CaseStatus; label: string; accent: string }[] = [
  { key: CaseStatus.OPEN, label: 'Open', accent: 'border-t-brand-blue' },
  { key: CaseStatus.IN_REVIEW, label: 'In review', accent: 'border-t-brand-navy' },
  { key: CaseStatus.PENDING, label: 'Pending', accent: 'border-t-sev-low' },
  { key: CaseStatus.ESCALATED, label: 'Escalated', accent: 'border-t-sev-high' },
  { key: CaseStatus.CLOSED, label: 'Closed', accent: 'border-t-brand-green' },
];

export default async function DashboardPage() {
  await requireSession(); // structural gate, first-line — consistent with cases/import (review P3-3)
  const stats = await getCaseStats();

  return (
    <section>
      <h1 tabIndex={-1} className="text-xl font-semibold text-brand-ink outline-none">
        Dashboard
      </h1>
      <p className="mt-1 text-sm text-muted">Snapshot of the case review pipeline.</p>

      {stats.total === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No cases yet"
            message="Cases appear here after an import runs and the detectors complete."
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Open cases"
              value={stats.open}
              sub={`of ${stats.total} total`}
              accentClass="border-t-brand-blue"
              emphasize
            />
            <StatCard label="Total cases" value={stats.total} accentClass="border-t-brand-navy" />
          </div>

          <SeverityBar bySeverity={stats.bySeverity} />

          <div>
            <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Case pipeline
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {PIPELINE.map((s) => (
                <StatCard
                  key={s.key}
                  label={s.label}
                  value={stats.byStatus[s.key]}
                  accentClass={s.accent}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
