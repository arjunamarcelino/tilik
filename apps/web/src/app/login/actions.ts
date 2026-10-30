'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiBase } from '@/lib/env';
import { createSession } from '@/lib/session';

export type LoginState = { status: 'idle' } | { status: 'error'; message: string };

// Send EXACTLY { email, password } — the API's forbidNonWhitelisted 400s on extra fields.
const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = CredentialsSchema.safeParse({
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
