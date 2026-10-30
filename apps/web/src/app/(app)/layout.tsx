import { AppShell } from '@/components/app-shell';
import { getCurrentUser } from '@/lib/dal';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No cross-route stats preload here: it only helped /dashboard yet ran on every (app) route (waste),
  // and its floating `.catch` swallowed a NEXT_REDIRECT on non-dashboard pages (reviews P3-1, P3-11).
  // The dashboard fetches its own stats; the tiny me→stats waterfall is acceptable for this tool.
  const user = await getCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
