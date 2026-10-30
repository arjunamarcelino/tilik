import { Role } from '@tilik/shared';
import type { Me } from '@tilik/shared/contracts';
import { roleSatisfies } from '@/lib/dal';
import { navItemsFor } from './nav-config';
import { NavLinks } from './nav-links';
import { TopBar } from './top-bar';

/** Authenticated shell: skip link, top bar, a persistent left rail (desktop), and the main region. */
export function AppShell({ user, children }: { user: Me; children: React.ReactNode }) {
  const items = navItemsFor(roleSatisfies(user.role, Role.ADMIN));

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>

      <TopBar user={user} items={items} />

      <div className="lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="hidden border-r border-border bg-surface lg:block">
          <NavLinks items={items} />
        </aside>
        <main id="main" tabIndex={-1} className="min-h-[calc(100dvh-3.5rem)] bg-canvas">
          <div className="mx-auto max-w-[1200px] px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
