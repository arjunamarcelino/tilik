'use client';

import { ErrorState } from '@/components/ui/error-state';

// Catches page errors within the shell (e.g. a failed stats fetch) and renders inside <main>.
export default function AppSegmentError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState title="Couldn’t load this page" onRetry={reset} />;
}
