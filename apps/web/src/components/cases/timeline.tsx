import type { AuditEventDTO } from '@tilik/shared/contracts';
import { Panel, PanelEmpty } from './panel';

const ACTION_LABEL: Record<string, string> = {
  IMPORT_STARTED: 'Import started',
  IMPORT: 'Imported claim bundle',
  DETECT: 'Detectors ran',
  VIEW_CASE: 'Viewed case',
  EVIDENCE_INTEGRITY_FAILED: 'Evidence integrity check failed',
};

// Deterministic UTC rendering — no locale/tz, so SSR and client agree (no hydration drift).
const fmt = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/** Chronological audit trail (import → detect → views). Ordered list: the order is the meaning. */
export function Timeline({ events }: { events: AuditEventDTO[] }) {
  return (
    <Panel title="Audit timeline" count={events.length}>
      {events.length === 0 ? (
        <PanelEmpty>No audit events for this case.</PanelEmpty>
      ) : (
        <ol className="relative flex flex-col gap-4 border-s border-border ps-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -start-[1.55rem] mt-1 size-3 rounded-full ring-4 ring-surface ${
                  e.actorKind === 'system' ? 'bg-brand-navy' : 'bg-brand-blue'
                }`}
              />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-brand-ink">
                  {e.actorKind === 'system' ? 'System · Detector' : 'Reviewer'}
                </span>
                <span className="text-sm text-muted">{ACTION_LABEL[e.action] ?? e.action}</span>
                <time dateTime={e.at} className="ms-auto font-mono text-xs text-muted">
                  {fmt(e.at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
