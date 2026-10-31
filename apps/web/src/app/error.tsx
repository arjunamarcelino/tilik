'use client';

import { ErrorState } from '@/components/ui/error-state';

// Catch-all for layout/shell-level errors (e.g. the API is unreachable while resolving /me).
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <ErrorState title="The portal is unavailable" onRetry={reset} />
      </div>
    </main>
  );
}
