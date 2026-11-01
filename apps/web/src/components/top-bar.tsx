import type { Me } from '@tilik/shared/contracts';
import type { NavItem } from './nav-links';
import { MobileNav } from './mobile-nav';
import { UserMenu } from './user-menu';
import { Wordmark } from './wordmark';

export function TopBar({ user, items }: { user: Me; items: NavItem[] }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-brand-navy px-4 text-white">
      <MobileNav items={items} />
      <Wordmark className="text-white" />
      <span className="ml-1 hidden border-l border-white/20 pl-3 text-xs text-white/60 sm:inline">
        Fraud Evidence Review
      </span>

      <div className="ml-auto">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
