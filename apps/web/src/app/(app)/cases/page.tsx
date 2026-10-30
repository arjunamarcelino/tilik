import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { requireSession } from '@/lib/dal';

export const metadata: Metadata = { title: 'Cases — Tilik' };

export default async function CasesPage() {
  await requireSession(); // structural gate — this page fetches no data of its own yet

  return (
    <section>
      <h1 tabIndex={-1} className="text-xl font-semibold text-brand-ink outline-none">
        Cases
      </h1>
      <div className="mt-6">
        <EmptyState
          title="Case review is coming soon"
          message="The case list, detail view, and reviewer decisions land in the next build."
        />
      </div>
    </section>
  );
}
