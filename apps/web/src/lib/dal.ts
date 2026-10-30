import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { Role, roleSatisfies } from '@tilik/shared';
import type { CaseStats, Me } from '@tilik/shared/contracts';
import { apiBase } from './env';
import { CaseStatsSchema, MeSchema } from './schemas';
import { readToken } from './session';

/** Authenticated but lacking the required role — do NOT log out (distinct from a 401). */
export class ForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}

interface Parser<T> {
  parse(input: unknown): T;
}

/**
 * Server-side, render-path reads only. Forwards the httpOnly cookie as a Bearer header and validates the
 * response at the boundary. A `401` clears the session and bounces (the cookie can't be mutated during an
 * RSC render, so we redirect to the /logout route that can). A `403` throws (stays logged in). Never
 * wrap a caller in a broad try/catch — `redirect()` throws NEXT_REDIRECT and must propagate.
 */
async function apiFetch<T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  const token = await readToken();
  if (!token) redirect('/login');

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('accept', 'application/json');

  const url = `${apiBase()}${path}`; // outside the try — a config error must not masquerade as "unreachable"
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error('The API is unreachable.');
  }

  if (res.status === 401) redirect('/logout');
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new Error(`API request failed (${res.status}).`);

  return schema.parse(await res.json());
}

// cache() lives on the concrete read helpers (zero-arg → the per-render memo actually dedupes a call
// made in both the layout and a page). It is deliberately NOT on the generic apiFetch.
export const getCurrentUser = cache(
  (): Promise<Me> => apiFetch('/auth/me', MeSchema, { cache: 'no-store' }), // liveness probe — never cache
);

// Global, non-personalized counts. Tagged so Prompt 11's case mutations can `revalidateTag('cases-stats')`
// to refresh the dashboard immediately instead of waiting out the 15s window (review P2-3).
export const CASE_STATS_TAG = 'cases-stats';
export const getCaseStats = cache(
  (): Promise<CaseStats> =>
    apiFetch('/cases/stats', CaseStatsSchema, { next: { revalidate: 15, tags: [CASE_STATS_TAG] } }),
);

/** Structural page gate — call first-line in every (app) page, even ones that fetch no data. */
export async function requireSession(): Promise<Me> {
  return getCurrentUser();
}

/** Gate a page to a minimum role; a lower role is redirected to the dashboard. */
export async function requireRole(need: Role): Promise<Me> {
  const me = await getCurrentUser();
  if (!roleSatisfies(me.role, need)) redirect('/dashboard');
  return me;
}
