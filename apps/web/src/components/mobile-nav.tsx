'use client';

import { useEffect, useState } from 'react';
import { NavLinks, type NavItem } from './nav-links';

/** Hamburger + slide-in drawer for small screens. Disclosure semantics: aria-expanded/controls, Esc to
 *  close, backdrop click, focus returns to the trigger. Hidden at lg (the persistent rail takes over). */
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls="mobile-primary-nav"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-ink/40"
          />
          <div
            id="mobile-primary-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            className="absolute inset-y-0 left-0 w-64 bg-surface shadow-lg"
          >
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
