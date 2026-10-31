import type { Metadata } from 'next';
import Link from 'next/link';
import { CaseHeader } from '@/components/cases/case-header';
import { ClaimsPanel } from '@/components/cases/claims-panel';
import { ContradictionsPanel } from '@/components/cases/contradictions-panel';
import { EvidencePanel } from '@/components/cases/evidence-panel';
import { FindingsPanel } from '@/components/cases/findings-panel';
import { SummaryPanel } from '@/components/cases/summary-panel';
import { Timeline } from '@/components/cases/timeline';
import { Role } from '@tilik/shared';
import { getCase, requireRole } from '@/lib/dal';

export const metadata: Metadata = { title: 'Case — Tilik' };

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(Role.REVIEWER);
  const { id } = await params;
  const kase = await getCase(id); // a 404 becomes Next's not-found

  return (
    <div className="flex flex-col gap-6">
      <Link href="/cases" className="text-sm font-medium text-brand-blue hover:underline">
        ← Back to cases
      </Link>

      <CaseHeader kase={kase} />

      <SummaryPanel caseId={kase.id} initialSummary={kase.summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FindingsPanel findings={kase.findings} />
        <ContradictionsPanel kase={kase} />
        <EvidencePanel caseId={kase.id} evidence={kase.evidence} />
        <Timeline events={kase.timeline} />
      </div>

      <ClaimsPanel claimVersions={kase.claimVersions} />
    </div>
  );
}
