import type { Metadata } from 'next';
import { Wordmark } from '@/components/wordmark';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in | Tilik' };

// Off-center split: a navy mission panel beside the form (single column below 900px).
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      <section className="flex flex-col justify-between bg-brand-navy px-8 py-10 text-white md:w-[42%] md:px-12 md:py-16">
        <Wordmark className="text-white" />
        <div className="mt-8 md:mt-0">
          <h1 className="text-2xl font-semibold md:text-3xl">
            Evidence-integrity review for JKN claims
          </h1>
          <p className="mt-3 max-w-sm text-sm text-white/70">
            Tamper-evident, traceable claim evidence. Sign in to triage flagged cases.
          </p>
        </div>
        <p className="mt-8 hidden text-xs text-white/50 md:block">
          Synthetic data · Healthkathon 2026
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-[380px]">
          <h2 className="mb-6 text-lg font-semibold text-brand-ink">Sign in</h2>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
