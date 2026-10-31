import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { Role, roleSatisfies } from '@tilik/shared';
import type { CaseDetail, CaseListResponse, CaseStats, Me } from '@tilik/shared/contracts';
import { apiBase } from './env';
import { CaseDetailSchema, CaseListResponseSchema, CaseStatsSchema, MeSchema } from './schemas';
import { readToken } from './session';

interface Parser<T> {
  parse(input: unknown): T;
}

/** Carries the upstream status so callers can branch (e.g. 404 → notFound). */
class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed (${status}).`);
    this.name = 'ApiError';
  }
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

  if (res.status === 401) redirect('/logout'); // expired/deactivated → clear session + bounce
  if (res.status === 403) throw new Error('Forbidden (403)'); // authorized-but-wrong-role: stay logged in, don't redirect
  if (!res.ok) throw new ApiError(res.status);

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
export const getCaseStats = cache((): Promise<CaseStats> =>
  apiFetch('/cases/stats', CaseStatsSchema, { next: { revalidate: 15, tags: [CASE_STATS_TAG] } }),
);

/** `GET /v1/cases` — filterable, paginated list. Unaudited + PII-free → a short revalidate (not no-store)
 * absorbs refresh storms; the data-cache key includes the querystring, so each filter/page caches apart. */
export interface CaseListFilters {
  status?: string;
  severity?: string;
  detector?: string;
  page?: number;
}
export async function getCases(filters: CaseListFilters = {}): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.detector) params.set('detector', filters.detector);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return apiFetch(`/cases${qs ? `?${qs}` : ''}`, CaseListResponseSchema, {
    next: { revalidate: 15 },
  });
}

/** `GET /v1/cases/:id` — detail. `no-store` so every real navigation re-runs the audited read. A 404
 * becomes Next's not-found. (Genuine prefetches don't reach here — the row links are `prefetch={false}`
 * and the audited read is below the route's `loading.tsx` boundary; the API audits every read it serves.) */
export async function getCase(id: string): Promise<CaseDetail> {
  try {
    return await apiFetch(`/cases/${encodeURIComponent(id)}`, CaseDetailSchema, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

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
