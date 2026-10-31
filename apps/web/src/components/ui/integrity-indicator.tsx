import type { EvidenceIntegrity } from '@tilik/shared/contracts';
import { CopyButton } from './copy-button';

// Icon + text on every state (never color-alone). role="alert" only for the one state a reviewer must not
// miss (tampered); the rest are polite. `unavailable` (amber) reads distinct from `mismatch` (red ramp).
const META: Record<
  EvidenceIntegrity['status'],
  { label: string; glyph: string; cls: string; alert: boolean }
> = {
  verified: {
    label: 'Hash verified',
    glyph: '✓',
    cls: 'bg-brand-green/10 text-brand-green-700',
    alert: false,
  },
  mismatch: {
    label: 'Hash mismatch — tampered',
    glyph: '⚠',
    cls: 'bg-sev-high-bg text-sev-high',
    alert: true,
  },
  unavailable: {
    label: 'Cannot verify',
    glyph: '?',
    cls: 'bg-sev-med-bg text-sev-med',
    alert: false,
  },
  display_only: {
    label: 'Stored hash',
    glyph: '•',
    cls: 'border border-border bg-canvas text-muted',
    alert: false,
  },
  pending: {
    label: 'Verifying…',
    glyph: '…',
    cls: 'border border-border bg-canvas text-muted',
    alert: false,
  },
};

/** Integrity verdict + the recorded content hash (truncated for display, full value kept in the DOM). */
export function IntegrityIndicator({ integrity }: { integrity: EvidenceIntegrity }) {
  const m = META[integrity.status];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        role={m.alert ? 'alert' : 'status'}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}
      >
        <span aria-hidden="true">{m.glyph}</span>
        {m.label}
      </span>
      <code
        className="max-w-[20rem] truncate font-mono text-[11px] text-muted"
        title={`${integrity.hashAlgo}:${integrity.contentHash}`}
      >
        {integrity.hashAlgo}:{integrity.contentHash}
      </code>
      <CopyButton value={integrity.contentHash} label="content hash" />
    </div>
  );
}
