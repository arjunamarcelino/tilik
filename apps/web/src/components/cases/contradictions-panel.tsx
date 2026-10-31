import type { CaseDetail } from '@tilik/shared/contracts';
import { labelKind, Panel, PanelEmpty } from './panel';

/** Surfaces EvidenceLink(relation='bertentangan') as paired claim ↔ evidence "relationship cards". */
export function ContradictionsPanel({ kase }: { kase: CaseDetail }) {
  const links = kase.evidenceLinks.filter((l) => l.relation === 'bertentangan');

  return (
    <Panel title="Contradictions" count={links.length}>
      {links.length === 0 ? (
        <PanelEmpty>
          No contradicting evidence on this case (expected unless a contradiction finding fired).
        </PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-4">
          {links.map((l) => {
            const cv = kase.claimVersions.find((c) => c.id === l.claimVersionId);
            const ev = kase.evidence.find((e) => e.id === l.evidenceId);
            return (
              <li key={l.id} className="overflow-hidden rounded-lg border border-sev-high/30">
                <div className="flex items-center gap-2 bg-sev-high-bg px-3 py-2 text-sm font-semibold text-sev-high">
                  <span aria-hidden="true">⇄</span>
                  Contradiction — claim conflicts with evidence
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-2">
                  <section aria-label="Claim" className="bg-surface p-3">
                    <p className="text-xs tracking-wide text-muted uppercase">Claim</p>
                    {cv ? (
                      <>
                        <p className="font-medium text-brand-ink">{cv.claimNo}</p>
                        <p className="font-mono text-xs text-muted">{cv.inacbgCode}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted">(claim not in this case)</p>
                    )}
                  </section>
                  <section aria-label="Conflicting evidence" className="bg-surface p-3">
                    <p className="text-xs tracking-wide text-muted uppercase">Evidence</p>
                    {ev ? (
                      <p className="font-medium text-brand-ink">{labelKind(ev.kind)}</p>
                    ) : (
                      <p className="text-sm text-muted">(evidence not in this case)</p>
                    )}
                    {l.note && <p className="mt-1 text-sm text-brand-ink/80">{l.note}</p>}
                  </section>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
