'use client';

import { useActionState, useEffect, useRef } from 'react';
import { runImport, type ImportState } from '@/app/(app)/import/actions';
import type { ImportResultDTO } from '@/lib/schemas';

const CARD = 'rounded-lg border border-border bg-surface';
const LABEL = 'text-xs font-semibold tracking-wide text-muted uppercase';

const RECORD_TYPE_LABEL: Record<ImportResultDTO['rejected'][number]['recordType'], string> = {
  episode: 'Episode',
  'claim-version': 'Claim version',
  'evidence-record': 'Evidence record',
  'evidence-link': 'Evidence link',
};

/**
 * Admin claim-import surface (Prompt 14 follow-up). Uploads a combined records manifest (the four record
 * arrays) plus optional evidence files, forwarded by the `runImport` Server Action to POST /v1/imports.
 * The file inputs degrade gracefully (the form submits without JS; the server validates). On success the
 * accepted/rejected summary + any per-record rejections render below; `useActionState`'s `pending` gates
 * the submit (no useFormStatus — this component owns the form).
 */
export function ImportForm() {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(runImport, {
    kind: 'idle',
  });

  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // On each result: a success clears the file selection (so a follow-up submit can't silently re-send the
  // previous bundle) and moves focus to the result; an error moves focus to the alert. One effect, one dep.
  useEffect(() => {
    if (state.kind === 'success') {
      formRef.current?.reset();
      resultRef.current?.focus();
    } else if (state.kind === 'error') {
      errorRef.current?.focus();
    }
  }, [state]);

  const inputClass =
    'block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-brand-ink outline-none file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-ink focus:border-brand-blue focus:ring-2 focus:ring-brand-blue disabled:opacity-60';

  return (
    <div className="flex flex-col gap-5">
      <form ref={formRef} action={formAction} className={`${CARD} flex flex-col gap-5 p-5`}>
        <fieldset disabled={pending} className="flex flex-col gap-5 border-0 p-0">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="manifest" className={LABEL}>
              Manifest <span className="text-muted normal-case">(required, JSON)</span>
            </label>
            <input
              id="manifest"
              name="manifest"
              type="file"
              required
              accept="application/json,.json"
              aria-describedby="manifest-hint"
              className={inputClass}
            />
            <p id="manifest-hint" className="text-xs text-muted">
              The combined records bundle with <code>episodes</code>, <code>claimVersions</code>,{' '}
              <code>evidenceRecords</code> and <code>evidenceLinks</code> arrays, not the generator{' '}
              <code>manifest.json</code> (that one carries ground-truth labels).
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="evidence" className={LABEL}>
              Evidence files <span className="text-muted normal-case">(optional, PNG/PDF)</span>
            </label>
            <input
              id="evidence"
              name="evidence"
              type="file"
              multiple
              accept="image/png,application/pdf,.png,.pdf"
              aria-describedby="evidence-hint"
              className={inputClass}
            />
            <p id="evidence-hint" className="text-xs text-muted">
              Attach the files referenced by file-backed evidence records. File names must match
              each record&rsquo;s <code>file</code>. Omit them and those records are reported as
              rejected; payload-backed evidence imports without any files.
            </p>
          </div>
        </fieldset>

        {state.kind === 'error' && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md bg-sev-high-bg px-3 py-2 text-sm text-sev-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            {state.message}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-green-700 px-4 font-semibold text-white transition-colors hover:bg-brand-green-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Importing…' : 'Import bundle'}
          </button>
        </div>
      </form>

      {state.kind === 'success' && (
        <ImportSummary ref={resultRef} result={state.result} replayed={state.replayed} />
      )}
    </div>
  );
}

function ImportSummary({
  ref,
  result,
  replayed,
}: {
  ref: React.Ref<HTMLDivElement>;
  result: ImportResultDTO;
  replayed: boolean;
}) {
  const { summary, rejected, status, batchId } = result;
  const headline = replayed
    ? 'This bundle was already imported. Showing the recorded result.'
    : status === 'PARTIAL'
      ? 'Imported with some records rejected.'
      : 'Import complete.';

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className={`${CARD} flex flex-col gap-4 p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue`}
    >
      <div>
        <h2 className="text-base font-semibold text-brand-ink">{headline}</h2>
        <p className="mt-1 text-xs text-muted">
          Batch <code className="break-all">{batchId}</code>
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Received" value={summary.received} />
        <Stat label="Accepted" value={summary.accepted} tone="good" />
        <Stat
          label="Rejected"
          value={summary.rejected}
          tone={summary.rejected > 0 ? 'warn' : undefined}
        />
      </dl>

      {rejected.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className={LABEL}>Rejected records</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas text-xs text-muted">
                  <th className="px-3 py-2 font-semibold">Ref</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((r) => (
                  <tr
                    key={`${r.position}:${r.ref}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 align-top font-mono text-xs break-all">{r.ref}</td>
                    <td className="px-3 py-2 align-top text-muted">
                      {RECORD_TYPE_LABEL[r.recordType]}
                    </td>
                    <td className="px-3 py-2 align-top text-muted">
                      {r.errors.map((e) => `${e.field}: ${e.constraint}`).join('; ') || 'rejected'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  const color =
    tone === 'good' ? 'text-brand-green-700' : tone === 'warn' ? 'text-sev-high' : 'text-brand-ink';
  return (
    <div className="rounded-md border border-border bg-canvas px-3 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}
