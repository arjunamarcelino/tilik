import type { Metadata } from 'next';
import { Role } from '@tilik/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { requireRole } from '@/lib/dal';

export const metadata: Metadata = { title: 'Import — Tilik' };

export default async function ImportPage() {
  // Server-side role gate — a reviewer hitting /import directly is denied, not just shown a hidden link.
  await requireRole(Role.ADMIN);

  return (
    <section>
      <h1 tabIndex={-1} className="text-xl font-semibold text-brand-ink outline-none">
        Import
      </h1>
      <div className="mt-6">
        <EmptyState
          title="Claim import is coming soon"
          message="Uploading claim bundles from the portal lands in a later build. The import pipeline API already exists."
        />
      </div>
    </section>
  );
}
