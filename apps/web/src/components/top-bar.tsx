import type { Me } from '@tilik/shared/contracts';
import type { NavItem } from './nav-links';
import { LogoutButton } from './logout-button';
import { MobileNav } from './mobile-nav';
import { Wordmark } from './wordmark';

export function TopBar({ user, items }: { user: Me; items: NavItem[] }) {
  const label = user.email.split('@')[0] ?? user.email; // display name; User has no name column

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-brand-navy px-4 text-white">
      <MobileNav items={items} />
      <Wordmark className="text-white" />
      <span className="ml-1 hidden border-l border-white/20 pl-3 text-xs text-white/60 sm:inline">
        fraud evidence review
      </span>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden font-mono text-sm text-white/90 sm:inline" title={user.email}>
          {label}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase ring-1 ring-white/25">
          {user.role}
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}
