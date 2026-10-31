'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'streaming' | 'done' | 'error';

const CARD = 'rounded-lg border border-border bg-surface';
const HEADER =
  'flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-brand-ink';
const BUTTON =
  'inline-flex h-9 items-center justify-center rounded-md bg-brand-green-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-green-800 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Streaming case-summary panel (Prompt 13). An assistant AID, not a decision: a cached summary renders
 * immediately with a "Buat ulang" (regenerate) action; otherwise a "Ringkas kasus ini" button starts a
 * same-origin POST to the BFF relay and renders tokens as they arrive.
 *
 * Streaming hygiene: tokens are buffered in a ref and flushed to state once per animation frame (no render
 * storm at 40–80 tok/s); the fetch is cancelled on unmount / case change via an AbortController; the text
 * is rendered as inert JSX (pre-wrap) — never a markdown/HTML renderer, which would reintroduce XSS from
 * attacker-influenceable evidence content. The streaming region is role="log" + aria-live="off" (per-token
 * aria-live stutters screen readers); a separate role="status" region announces completion once.
 */
export function SummaryPanel({
  caseId,
  initialSummary,
}: {
  caseId: string;
  initialSummary: string | null;
}) {
  const [text, setText] = useState(initialSummary ?? '');
  const [status, setStatus] = useState<Status>(initialSummary ? 'done' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const bufRef = useRef('');
  const rafRef = useRef<number | null>(null);

  // Cancel an in-flight stream + pending frame on unmount or case change.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [caseId],
  );

  function flushBuffer() {
    rafRef.current = null;
    const chunk = bufRef.current;
    bufRef.current = '';
    if (chunk) setText((prev) => prev + chunk);
  }

  function scheduleFlush() {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushBuffer);
  }

  async function run(regenerate: boolean) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufRef.current = '';
    setText('');
    setError(null);
    setAnnounce('');
    setStatus('streaming');

    try {
      const res = await fetch(`/cases/${caseId}/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerate }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setStatus('error');
        setError(
          res.status === 429
            ? 'Terlalu banyak permintaan — coba lagi dalam satu menit.'
            : 'Gagal membuat ringkasan. Coba lagi.',
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bufRef.current += decoder.decode(value, { stream: true });
        scheduleFlush();
      }
      bufRef.current += decoder.decode();
      flushBuffer();
      setStatus('done');
      setAnnounce('Ringkasan selesai.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // navigate-away, not an error
      setStatus('error');
      setError('Gagal membuat ringkasan. Coba lagi.');
    }
  }

  const streaming = status === 'streaming';
  const emptyResult = status === 'done' && text.trim().length === 0;

  return (
    <section aria-labelledby="summary-heading" className={CARD}>
      <h2 id="summary-heading" className={HEADER}>
        <span className="flex items-center gap-2">
          Ringkasan AI
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-normal text-muted">
            Bantuan asisten — bukan keputusan
          </span>
        </span>
        <button
          type="button"
          onClick={() => run(status === 'done')}
          disabled={streaming}
          aria-busy={streaming}
          className={BUTTON}
        >
          {streaming ? 'Meringkas…' : status === 'idle' ? 'Ringkas kasus ini' : 'Buat ulang'}
        </button>
      </h2>

      <div className="p-4 text-sm">
        {status === 'idle' && (
          <p className="text-muted">
            Buat ringkasan naratif kasus ini yang berdasar bukti (setiap pernyataan menyertakan
            evidence_id) dan tidak memberi putusan.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-sev-high-bg px-3 py-2 text-sev-high">
            {error}
          </p>
        )}

        {emptyResult && (
          <p className="text-muted">Tidak dapat meringkas kasus ini dari bukti yang tersedia.</p>
        )}

        {text.length > 0 && (
          <div
            role="log"
            aria-live="off"
            aria-busy={streaming}
            className="text-brand-ink"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {text}
            {streaming && <span className="ml-0.5 animate-pulse text-muted">▍</span>}
          </div>
        )}

        {/* Announce completion once — never per token. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>
    </section>
  );
}
