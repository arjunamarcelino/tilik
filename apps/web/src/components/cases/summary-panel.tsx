'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Status = 'idle' | 'streaming' | 'done' | 'error';

// Strip inline markdown emphasis so no raw ** / ` characters reach the screen. Plain text only.
const stripInline = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*`]/g, '')
    .trim();

/**
 * Give the model's plain-text summary light visual structure WITHOUT a markdown/HTML renderer: we only map
 * recognized LINE shapes (a `**heading**` line, a `- ` bullet) to styled JSX whose content is a plain,
 * React-escaped text child. No HTML is injected, so attacker-influenceable evidence text can never execute
 * (the inert-text guarantee from Prompt 13 holds). Section labels reuse the portal's uppercase-muted label
 * style; bullets become a real list. During streaming a half-arrived `**heading` is detected by its `**`
 * prefix so it never flickers as a paragraph first.
 */
function parseSummaryBlocks(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1 marker:text-border-strong">
        {items.map((b, i) => (
          <li key={i} style={{ overflowWrap: 'anywhere' }}>
            {b}
          </li>
        ))}
      </ul>,
    );
  };

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) {
      bullets.push(stripInline(line.replace(/^[-*]\s+/, '')));
      return;
    }
    flushBullets(`ul-${i}`);
    if (line === '') return; // blank line: block margins provide the section gap
    if (line.startsWith('**')) {
      const heading = stripInline(line).replace(/:$/, '');
      if (heading)
        blocks.push(
          <h3
            key={i}
            className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase first:mt-0"
          >
            {heading}
          </h3>,
        );
      return;
    }
    const body = stripInline(line);
    if (body)
      blocks.push(
        <p key={i} style={{ overflowWrap: 'anywhere' }}>
          {body}
        </p>,
      );
  });
  flushBullets('ul-end');

  return blocks;
}

function SummaryBody({ blocks, streaming }: { blocks: ReactNode[]; streaming: boolean }) {
  return (
    <div
      role="log"
      aria-live="off"
      aria-busy={streaming}
      className="flex flex-col gap-2 leading-relaxed text-brand-ink"
    >
      {blocks}
      {streaming && (
        <span aria-hidden="true" className="animate-pulse text-muted">
          ▍
        </span>
      )}
    </div>
  );
}

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
 * is rendered as inert, React-escaped JSX blocks (via parseSummaryBlocks), never a markdown/HTML renderer,
 * which would reintroduce XSS from attacker-influenceable evidence content. The streaming region is
 * role="log" + aria-live="off" (per-token aria-live stutters screen readers); a separate role="status"
 * region announces completion once.
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
      if (res.status === 401) {
        // Session expired/invalid — full navigation so /logout can clear the cookie and bounce to /login
        // (a fetch can't follow a redirect into a navigation).
        window.location.assign('/logout');
        return;
      }
      if (!res.ok || !res.body) {
        setStatus('error');
        setError(
          res.status === 429
            ? 'Terlalu banyak permintaan. Coba lagi dalam satu menit.'
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
  const blocks = parseSummaryBlocks(text);
  // "Empty" = done but nothing renderable — covers whitespace-only output AND text that strips to zero
  // blocks (e.g. a stray "**"), so the panel shows the fallback message instead of dead-ending on a blank.
  const emptyResult = status === 'done' && blocks.length === 0;

  return (
    <section aria-labelledby="summary-heading" className={CARD}>
      <h2 id="summary-heading" className={HEADER}>
        <span className="flex items-center gap-2">
          Ringkasan AI
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-normal text-muted">
            Bantuan asisten, bukan keputusan
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

        {(blocks.length > 0 || streaming) && <SummaryBody blocks={blocks} streaming={streaming} />}

        {/* Announce completion once — never per token. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>
    </section>
  );
}
