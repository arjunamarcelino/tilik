import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';

export default function CaseNotFound() {
  return (
    <EmptyState
      title="Case not found"
      message="This case doesn't exist, or it may have been removed."
      action={
        <Link href="/cases" className="text-sm font-medium text-brand-blue underline">
          Back to cases
        </Link>
      }
    />
  );
}
