'use client';

import { useActionState } from 'react';
import { login, type LoginState } from './actions';

const initial: LoginState = { status: 'idle' };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initial);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-semibold tracking-wide text-muted uppercase">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className="h-11 rounded-md border border-border bg-surface px-3 text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-xs font-semibold tracking-wide text-muted uppercase"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 rounded-md border border-border bg-surface px-3 text-brand-ink outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue"
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="rounded-md bg-sev-high-bg px-3 py-2 text-sm text-sev-high">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 inline-flex h-11 items-center justify-center rounded-md bg-brand-green px-4 font-semibold text-white transition-colors hover:bg-brand-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
