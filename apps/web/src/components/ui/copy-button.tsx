'use client';

import { useState } from 'react';

/** Copy a value to the clipboard with a polite SR announcement. The full value lives in the caller's DOM. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded px-1 text-xs font-medium text-brand-blue hover:underline"
    >
      {copied ? 'Copied' : 'Copy'}
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </button>
  );
}
