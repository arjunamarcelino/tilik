'use server';

import { redirect } from 'next/navigation';
import { apiBase } from '@/lib/env';
import { LoginCredentialsSchema } from '@/lib/schemas';
import { createSession } from '@/lib/session';

export type LoginState = { status: 'idle' } | { status: 'error'; message: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginCredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Enter a valid email and password.' };
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return { status: 'error', message: 'Cannot reach the server. Please try again.' };
  }

  if (res.status === 429) {
    return { status: 'error', message: 'Too many attempts — try again in a minute.' };
  }
  if (res.status >= 500) {
    // Don't mislabel a server/API fault as a credentials problem (review P3-12).
    return { status: 'error', message: 'Something went wrong on our end. Please try again.' };
  }
  if (!res.ok) {
    return { status: 'error', message: 'Invalid credentials.' };
  }

  const body = (await res.json().catch(() => ({}))) as { accessToken?: unknown };
  if (typeof body.accessToken !== 'string') {
    return { status: 'error', message: 'Unexpected response from the server.' };
  }

  await createSession(body.accessToken);
  // Outside any try/catch — redirect() throws NEXT_REDIRECT and must propagate.
  redirect('/dashboard');
}
