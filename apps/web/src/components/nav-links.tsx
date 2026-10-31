'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Shared primary-nav link list (desktop rail + mobile drawer). Active state via usePathname, marked with
 * aria-current AND a non-color cue (left rule + weight). Role-gated items are omitted by the caller, not
 * disabled — the server `@Roles` guard + web `requireRole` are the actual gate; hiding is UX only.
 */
export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={[
              'relative flex h-10 items-center rounded-md px-3 text-sm',
              active
                ? 'bg-brand-navy/10 font-semibold text-brand-navy before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-brand-navy'
                : 'text-brand-ink/80 hover:bg-canvas',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
