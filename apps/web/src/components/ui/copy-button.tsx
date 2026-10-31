'use client';

import { useEffect, useRef, useState } from 'react';

/** Copy a value to the clipboard with a polite SR announcement. The full value lives in the caller's DOM. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard blocked (non-secure context / no permission) — no-op; the value stays visible to copy by hand.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={copy}
      className="rounded px-1 text-xs font-medium text-brand-blue hover:underline"
    >
      {copied ? 'Copied' : 'Copy'}
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </button>
  );
}
