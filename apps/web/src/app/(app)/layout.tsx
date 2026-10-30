import { AppShell } from '@/components/app-shell';
import { getCaseStats, getCurrentUser } from '@/lib/dal';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Preload stats (don't await) so the request is in flight while /me resolves — avoids the me→stats
  // waterfall. The .catch keeps a non-dashboard page from seeing an unhandled rejection; the dashboard
  // awaits the same memoized promise and handles errors via its error boundary.
  void getCaseStats().catch(() => {});
  const user = await getCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
