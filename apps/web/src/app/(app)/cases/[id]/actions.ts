'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@tilik/shared';
import { apiBase } from '@/lib/env';
import { CASE_STATS_TAG, requireRole } from '@/lib/dal';
import { DecideRequestSchema } from '@/lib/schemas';
import { readToken } from '@/lib/session';

/**
 * Decision-panel state.
 *   - idle       — initial, or a successful decide (the revalidated server render shows the locked panel)
 *   - reconciled — the case was already decided (409): a STATE, not a failure; render it neutral, not as an error
 *   - error      — a validation (400 / client) or server (403/429/5xx/unreachable) failure
 */
export type DecideState =
  | { kind: 'idle' }
  | { kind: 'reconciled'; message: string }
  | { kind: 'error'; message: string; fieldErrors?: { verdict?: string; rationale?: string } };

/**
 * The system's first authenticated write (Prompt 12). A Server Action forwards the httpOnly-cookie JWT as a
 * Bearer to `POST /v1/cases/:id/decision` (the token never reaches browser JS). Bound to the caseId in the
 * panel: `decide.bind(null, id)`. `redirect()` calls stay outside the fetch try/catch — they throw
 * NEXT_REDIRECT and must propagate.
 */
export async function decide(
  caseId: string,
  _prev: DecideState,
  formData: FormData,
): Promise<DecideState> {
  await requireRole(Role.REVIEWER); // server-side gate; the API re-checks (defence in depth)

  const parsed = DecideRequestSchema.safeParse({
    verdict: formData.get('verdict'),
    rationale: formData.get('rationale'),
  });
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      kind: 'error',
      message: 'Choose a verdict and enter a rationale.',
      fieldErrors: { verdict: fe.verdict?.[0], rationale: fe.rationale?.[0] },
    };
  }

  const token = await readToken();
  if (!token) redirect('/login');

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/cases/${encodeURIComponent(caseId)}/decision`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error', message: 'Cannot reach the server. Please try again.' };
  }

  if (res.status === 401) redirect('/logout'); // expired/deactivated → clear session + bounce
  if (res.status === 409) {
    // Already decided (a stale tab, or another reviewer). Reconcile to the recorded decision — not an error.
    revalidatePath(`/cases/${caseId}`);
    return {
      kind: 'reconciled',
      message: 'This case was already decided — showing the recorded decision below.',
    };
  }
  if (res.status === 403) {
    return { kind: 'error', message: 'You do not have permission to decide this case.' };
  }
  if (res.status === 429) {
    return { kind: 'error', message: 'Too many attempts — try again in a minute.' };
  }
  if (res.status === 400) {
    return {
      kind: 'error',
      message: 'The decision was rejected as invalid — check the rationale.',
    };
  }
  if (!res.ok) {
    return { kind: 'error', message: 'Something went wrong on our end. Please try again.' };
  }

  // Success: refresh the audited detail (which flips the panel to its locked state), the untagged case list
  // (revalidate:15, no tag — bust it by path), and the tagged dashboard stats.
  revalidatePath(`/cases/${caseId}`);
  revalidatePath('/cases', 'page');
  updateTag(CASE_STATS_TAG); // Next 16: the Server-Action tag-purge (revalidateTag now needs a cacheLife profile)
  return { kind: 'idle' };
}
