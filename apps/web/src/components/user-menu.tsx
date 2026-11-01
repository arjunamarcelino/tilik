'use client';

import { useEffect, useRef } from 'react';
import type { Me } from '@tilik/shared/contracts';
import { logout } from '@/lib/actions';

/**
 * Account menu in the top bar: an initial-based avatar (no profile photo exists — an initial is the honest
 * placeholder) that opens a dropdown with the signed-in identity + the Log out action.
 *
 * Built on a native <details> disclosure so it still toggles and the Log out form still POSTs WITHOUT JS
 * (the old LogoutButton was deliberately no-JS-friendly; this keeps that). JS only ENHANCES it: close on
 * Escape (restoring focus to the avatar) and on an outside click, which <details> does not do natively.
 */
export function UserMenu({ user }: { user: Me }) {
  const label = user.email.split('@')[0] || user.email; // display name; User has no name column
  const initial = label.charAt(0).toUpperCase() || '?';
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => {
      el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.open) {
        close();
        el.querySelector('summary')?.focus(); // return focus to the trigger
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (el.open && !el.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-haspopup="menu"
        title={user.email}
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white marker:content-none [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">Account menu</span>
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-surface text-brand-ink shadow-lg">
        <div className="border-b border-border px-4 py-3">
          <p className="truncate font-mono text-sm font-medium text-brand-ink" title={user.email}>
            {label}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted" title={user.email}>
            {user.email}
          </p>
          <span className="mt-2 inline-block rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase ring-1 ring-border">
            {user.role}
          </span>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center px-4 py-2.5 text-left text-sm text-brand-ink transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
          >
            Log out
          </button>
        </form>
      </div>
    </details>
  );
}
