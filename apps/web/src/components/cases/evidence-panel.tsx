import type { EvidenceRecordDTO } from '@tilik/shared/contracts';
import { Badge } from '../ui/badge';
import { IntegrityIndicator } from '../ui/integrity-indicator';
import { labelKind, Panel, PanelEmpty } from './panel';

/** Evidence records with the live integrity verdict. Images render inline; other files download; payload-
 * backed records render their JSON inline. Note: the current seed is payload-only (file path untested). */
export function EvidencePanel({ evidence }: { evidence: EvidenceRecordDTO[] }) {
  return (
    <Panel title="Evidence" count={evidence.length}>
      {evidence.length === 0 ? (
        <PanelEmpty>No evidence attached (common for repeat-billing cases).</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-4">
          {evidence.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{labelKind(e.kind)}</Badge>
                <time dateTime={e.capturedAt} className="text-xs text-muted">
                  captured {e.capturedAt.slice(0, 10)}
                </time>
              </div>
              <div className="mt-2">
                <IntegrityIndicator integrity={e.integrity} />
              </div>

              {e.download?.isImage && (
                // Plain <img>, not next/image: a dynamic same-origin proxy route with no fixed dimensions.
                <img
                  src={e.download.href}
                  alt={`Evidence ${e.id} preview`}
                  className="mt-3 max-h-64 rounded border border-border"
                />
              )}
              {e.download && !e.download.isImage && (
                <a
                  href={e.download.href}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-blue underline"
                >
                  Download file
                </a>
              )}
              {!e.download && e.payload != null && (
                <pre className="mt-3 max-h-64 overflow-auto rounded border border-border bg-canvas p-3 font-mono text-xs text-brand-ink/90">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
