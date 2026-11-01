import type { Metadata } from 'next';
import { Role } from '@tilik/shared';
import { requireRole } from '@/lib/dal';
import { ImportForm } from '@/components/import/import-form';

export const metadata: Metadata = { title: 'Import | Tilik' };

export default async function ImportPage() {
  // Server-side role gate — a reviewer hitting /import directly is denied, not just shown a hidden link.
  // (The API endpoint accepts REVIEWER; the portal deliberately scopes import to ADMIN.)
  await requireRole(Role.ADMIN);

  return (
    <section>
      <h1 tabIndex={-1} className="text-xl font-semibold text-brand-ink outline-none">
        Import
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload a synthetic claim bundle. Each accepted episode is staged, canonicalised, and queued
        for fraud detection, the same pipeline the CLI seed drives. Re-uploading the same bundle is
        safe (it replays rather than duplicating).
      </p>
      <div className="mt-6 max-w-2xl">
        <ImportForm />
      </div>
    </section>
  );
}
