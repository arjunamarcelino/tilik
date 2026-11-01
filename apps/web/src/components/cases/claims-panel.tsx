import type { ClaimVersionDTO } from '@tilik/shared/contracts';
import { Panel, PanelEmpty } from './panel';

// Indonesian rupiah with grouped thousands (e.g. "Rp 5.762.000,00"). Amounts arrive as Decimal(2) strings
// from the API; parse to a number for grouping, fall back to the raw string if it is somehow non-numeric.
const RUPIAH = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatRupiah(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? `Rp ${RUPIAH.format(n)}` : `Rp ${amount}`;
}

/** Involved claim versions and their lines (diagnoses / procedures). */
export function ClaimsPanel({ claimVersions }: { claimVersions: ClaimVersionDTO[] }) {
  return (
    <Panel title="Claim versions" count={claimVersions.length}>
      {claimVersions.length === 0 ? (
        <PanelEmpty>No claim versions on this case.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-4">
          {claimVersions.map((cv) => (
            <li key={cv.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-mono font-medium text-brand-ink">{cv.claimNo}</span>
                <span className="text-muted">
                  v{cv.version}
                  {cv.isCurrent ? ' · current' : ''}
                </span>
                <span className="text-muted">INA-CBG {cv.inacbgCode}</span>
                <span className="ml-auto font-mono text-brand-ink">{formatRupiah(cv.amount)}</span>
              </div>
              {cv.lines.length > 0 && (
                <ul className="mt-2 divide-y divide-border text-xs">
                  {cv.lines.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 py-1">
                      <span className="w-24 shrink-0 text-muted">{l.type}</span>
                      <span className="font-mono">{l.code}</span>
                      <span className="flex-1 truncate text-muted">{l.description ?? ''}</span>
                      {l.amount && (
                        <span className="font-mono text-brand-ink">{formatRupiah(l.amount)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
