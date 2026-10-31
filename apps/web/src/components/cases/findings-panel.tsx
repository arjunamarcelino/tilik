import { Fragment } from 'react';
import type { FindingDTO } from '@tilik/shared/contracts';
import { DetectorBadge, SeverityBadge } from '../ui/badge';
import { Panel, PanelEmpty } from './panel';

const fmtDetail = (v: unknown): string =>
  typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);

/** Per-detector findings with human-readable reasons. `score` is detector-specific (not cross-comparable). */
export function FindingsPanel({ findings }: { findings: FindingDTO[] }) {
  return (
    <Panel title="Findings" count={findings.length}>
      {findings.length === 0 ? (
        <PanelEmpty>No findings on this case.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-4">
          {findings.map((f) => (
            <li key={f.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <DetectorBadge detector={f.detector} />
                <SeverityBadge severity={f.severity} />
                <span
                  className="ml-auto font-mono text-xs text-muted"
                  title="Score meaning is detector-specific (e.g. cosine for cloning, count for repeat billing)"
                >
                  score {f.score.toFixed(2)}
                </span>
              </div>
              {f.reasons.messages.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-brand-ink/90">
                  {f.reasons.messages.map((m, i) => (
                    <li key={`${i}-${m.slice(0, 32)}`}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">No readable reason text.</p>
              )}
              {Object.keys(f.reasons.detail).length > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Detector detail</summary>
                  <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
                    {Object.entries(f.reasons.detail).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt className="font-medium">{k}</dt>
                        <dd className="font-mono break-all">{fmtDetail(v)}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
