'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Verdict } from '@tilik/shared';
import type { CaseDecision } from '@tilik/shared/contracts';
import { VerdictBadge } from '@/components/ui/badge';
import { decide, type DecideState } from '@/app/(app)/cases/[id]/actions';
import { VERDICT_LABEL } from './labels';

const MAX = 2000;
const NEAR_LIMIT = MAX - 200;
const VERDICTS: Verdict[] = [Verdict.CONFIRMED_FRAUD, Verdict.NOT_FRAUD, Verdict.NEEDS_MORE_INFO];

// Pre-commit confirmation copy. CONFIRMED_FRAUD / NOT_FRAUD are accusatory + permanent; NEEDS_MORE_INFO is
// softer but still final (one Decision per case, ever).
const CONFIRM_COPY: Record<Verdict, string> = {
  [Verdict.CONFIRMED_FRAUD]:
    'Confirm fraud for this case. This is final and cannot be changed or undone.',
  [Verdict.NOT_FRAUD]:
    'Clear this case as not fraud. This is final and cannot be changed or undone.',
  [Verdict.NEEDS_MORE_INFO]:
    'Flag this case as needing more information. This is recorded and cannot be changed.',
};

const CARD = 'rounded-lg border border-border bg-surface';
const HEADER =
  'flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-brand-ink outline-none';

/**
 * The reviewer's decision surface (Prompt 12). Undecided → a verdict radio group + required rationale, gated
 * by an inline two-step confirm (the verdicts are irreversible). Decided → a locked, read-only summary.
 * All hooks run unconditionally (before the decided/undecided branch) to satisfy the rules of hooks.
 */
export function DecisionPanel({
  caseId,
  decision,
}: {
  caseId: string;
  decision: CaseDecision | null;
}) {
  const [state, formAction, pending] = useActionState<DecideState, FormData>(
    decide.bind(null, caseId),
    { kind: 'idle' },
  );

  const [verdict, setVerdict] = useState<Verdict | ''>('');
  const [rationale, setRationale] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [clientError, setClientError] = useState<{ verdict?: string; rationale?: string } | null>(
    null,
  );

  const headingRef = useRef<HTMLHeadingElement>(null);
  const recordRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasDecided = useRef(decision !== null);

  // On the undecided→decided transition (after the action revalidates), move focus to the locked heading —
  // but NOT on a fresh load of an already-decided case (don't steal focus on navigation).
  useEffect(() => {
    if (!wasDecided.current && decision) headingRef.current?.focus();
    wasDecided.current = decision !== null;
  }, [decision]);

  // Entering the confirm step moves focus to the confirm button; a server error drops back to the edit view.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (state.kind === 'error') setConfirming(false);
  }, [state]);

  if (decision) {
    return (
      <section aria-labelledby="decision-heading" className={CARD}>
        <h2 id="decision-heading" ref={headingRef} tabIndex={-1} className={HEADER}>
          Decision
          <VerdictBadge verdict={decision.verdict} />
        </h2>
        <div className="flex flex-col gap-3 p-4 text-sm">
          {state.kind === 'reconciled' && (
            <p role="status" className="rounded-md bg-brand-navy/10 px-3 py-2 text-brand-navy">
              {state.message}
            </p>
          )}
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                Rationale
              </dt>
              <dd
                className="mt-1 text-brand-ink"
                style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {decision.rationale}
              </dd>
            </div>
            <div className="text-muted">
              <dt className="inline font-medium">Decided by:</dt>{' '}
              <dd className="inline">{decision.decidedByLabel}</dd>
              {' · '}
              <time dateTime={decision.decidedAt}>
                {new Date(decision.decidedAt).toLocaleString()}
              </time>
            </div>
          </dl>
        </div>
      </section>
    );
  }

  const verdictError =
    clientError?.verdict ?? (state.kind === 'error' ? state.fieldErrors?.verdict : undefined);
  const rationaleError =
    clientError?.rationale ?? (state.kind === 'error' ? state.fieldErrors?.rationale : undefined);
  const generalError = state.kind === 'error' && !state.fieldErrors ? state.message : undefined;

  function handleRecord() {
    const errs: { verdict?: string; rationale?: string } = {};
    if (!verdict) errs.verdict = 'Choose a verdict.';
    if (rationale.trim().length === 0) errs.rationale = 'Rationale is required.';
    if (errs.verdict || errs.rationale) {
      setClientError(errs);
      return;
    }
    setClientError(null);
    setConfirming(true);
  }

  const label = 'text-xs font-semibold tracking-wide text-muted uppercase';
  const errorText = 'text-sm text-sev-high';

  return (
    <section aria-labelledby="decision-heading" className={CARD}>
      <h2 id="decision-heading" ref={headingRef} tabIndex={-1} className={HEADER}>
        Decision
      </h2>
      <form action={formAction} className="flex flex-col gap-5 p-4">
        <fieldset
          disabled={pending}
          aria-describedby={verdictError ? 'verdict-error' : undefined}
          aria-invalid={verdictError ? true : undefined}
          className="flex flex-col gap-2 border-0 p-0"
        >
          <legend className={label}>
            Verdict <span className="text-muted normal-case">(required)</span>
          </legend>
          {VERDICTS.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm text-brand-ink">
              <input
                type="radio"
                name="verdict"
                value={v}
                checked={verdict === v}
                onChange={() => {
                  setVerdict(v);
                  setConfirming(false);
                  setClientError(null);
                }}
                className="accent-brand-blue"
              />
              {VERDICT_LABEL[v]}
            </label>
          ))}
          {verdictError && (
            <p id="verdict-error" role="alert" className={errorText}>
              {verdictError}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rationale" className={label}>
            Rationale <span className="text-muted normal-case">(required)</span>
          </label>
          <textarea
            id="rationale"
            name="rationale"
            required
            maxLength={MAX}
            rows={4}
            disabled={pending}
            aria-required="true"
            aria-invalid={rationaleError ? true : undefined}
            aria-describedby={`rationale-hint rationale-count${rationaleError ? ' rationale-error' : ''}`}
            value={rationale}
            onChange={(e) => {
              setRationale(e.target.value);
              setConfirming(false);
              setClientError(null);
            }}
            className="rounded-md border border-border bg-surface px-3 py-2 text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue disabled:opacity-60"
          />
          <div className="flex items-center justify-between">
            <p id="rationale-hint" className="text-xs text-muted">
              Explain your reasoning — recorded in the audit trail.
            </p>
            <p
              id="rationale-count"
              aria-live={rationale.length >= NEAR_LIMIT ? 'polite' : 'off'}
              className="text-xs text-muted tabular-nums"
            >
              {rationale.length} / {MAX}
            </p>
          </div>
          {rationaleError && (
            <p id="rationale-error" role="alert" className={errorText}>
              {rationaleError}
            </p>
          )}
        </div>

        {generalError && (
          <p role="alert" className="rounded-md bg-sev-high-bg px-3 py-2 text-sm text-sev-high">
            {generalError}
          </p>
        )}

        {!confirming ? (
          <button
            ref={recordRef}
            type="button"
            onClick={handleRecord}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-green-700 px-4 font-semibold text-white transition-colors hover:bg-brand-green disabled:cursor-not-allowed disabled:opacity-60"
          >
            Record decision
          </button>
        ) : (
          <div
            role="group"
            aria-label="Confirm decision"
            className="flex flex-col gap-3 rounded-md border border-border-strong bg-canvas p-3"
          >
            <p aria-live="assertive" className="text-sm font-medium text-brand-ink">
              {verdict ? CONFIRM_COPY[verdict] : ''}
            </p>
            <div className="flex gap-3">
              <button
                ref={confirmRef}
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className="inline-flex h-11 items-center justify-center rounded-md bg-brand-green-700 px-4 font-semibold text-white transition-colors hover:bg-brand-green disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending
                  ? 'Recording…'
                  : `Yes — ${verdict ? VERDICT_LABEL[verdict].toLowerCase() : ''}`}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  recordRef.current?.focus();
                }}
                className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-surface px-4 font-semibold text-brand-ink transition-colors hover:bg-canvas disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
