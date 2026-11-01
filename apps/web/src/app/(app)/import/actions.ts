'use server';

import { createHash } from 'node:crypto';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@tilik/shared';
import { apiBase } from '@/lib/env';
import { CASE_STATS_TAG, requireRole } from '@/lib/dal';
import { ImportResultSchema, type ImportResultDTO } from '@/lib/schemas';
import { readToken } from '@/lib/session';

/**
 * Import-form state.
 *   - idle     — initial.
 *   - success  — the API accepted the batch (201 all-imported, 207 partial, or 200 replay of a prior
 *                identical upload). `partial`/`replayed` tune the copy; `result` drives the summary +
 *                rejection list. PARTIAL is a SUCCESS state (some records landed), not a failure.
 *   - error    — a client-side or server failure (bad manifest, unmatched files, 4xx/5xx, unreachable).
 */
export type ImportState =
  | { kind: 'idle' }
  | { kind: 'success'; result: ImportResultDTO; replayed: boolean }
  | { kind: 'error'; message: string };

// The four array sections an importable manifest must carry (mirrors the API's isImportManifest). This is
// the COMBINED records bundle the seed assembles — NOT the generator's bundle manifest.json (which holds
// `labels` = detector ground truth and must never be imported).
const SECTIONS = ['episodes', 'claimVersions', 'evidenceRecords', 'evidenceLinks'] as const;

type ImportManifest = { evidenceRecords: Array<Record<string, unknown>> } & Record<string, unknown>;

function isImportManifest(value: unknown): value is ImportManifest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return SECTIONS.every((key) => Array.isArray(obj[key]));
}

const basename = (p: string): string => p.split('/').pop() ?? p;

/**
 * The portal's claim-import write (Prompt 14 follow-up). A Server Action forwards the httpOnly-cookie JWT as
 * a Bearer to `POST /v1/imports` (the token never reaches browser JS — mirrors the Prompt 12 decision action
 * and login; the DAL stays reads-only). The multipart body is reassembled server-side: the manifest part
 * plus one file part per uploaded evidence file, keyed by the matching record's `ref` exactly as the seed
 * does. The Idempotency-Key is derived from the manifest bytes, so re-uploading the same bundle REPLAYS
 * rather than erroring. `redirect()` calls stay outside the fetch try/catch — they throw NEXT_REDIRECT and
 * must propagate.
 */
export async function runImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireRole(Role.ADMIN); // matches the page gate + nav; the API re-checks REVIEWER (ADMIN ⊇ REVIEWER)

  const manifestFile = formData.get('manifest');
  if (!(manifestFile instanceof File) || manifestFile.size === 0) {
    return { kind: 'error', message: 'Choose a manifest JSON file to import.' };
  }

  // Parse + structurally validate the manifest BEFORE forwarding, so an obvious mistake (most likely the
  // generator bundle manifest.json with labels) gets a clear message instead of a bare API 400.
  const manifestBytes = Buffer.from(await manifestFile.arrayBuffer());
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    return { kind: 'error', message: 'The manifest is not valid JSON.' };
  }
  if (!isImportManifest(manifest)) {
    return {
      kind: 'error',
      message:
        'That file is not an importable bundle. Upload the combined records manifest with episodes, ' +
        'claimVersions, evidenceRecords and evidenceLinks arrays, not the generator bundle manifest.json.',
    };
  }

  // Map each file-backed evidence record's file basename → its ref, so uploaded files attach to the right
  // multipart part (the API keys file parts by ref). A file that matches no record is almost always a
  // wrong selection — fail loudly rather than silently dropping a file the operator explicitly chose.
  const refByFileName = new Map<string, string>();
  for (const ev of manifest.evidenceRecords) {
    if (typeof ev.ref === 'string' && typeof ev.file === 'string' && ev.file.length > 0) {
      refByFileName.set(basename(ev.file), ev.ref);
    }
  }
  const evidenceFiles = formData
    .getAll('evidence')
    .filter((f): f is File => f instanceof File && f.size > 0);

  const outgoing = new FormData();
  outgoing.append(
    'manifest',
    new Blob([manifestBytes], { type: 'application/json' }),
    'manifest.json',
  );
  const unmatched: string[] = [];
  for (const f of evidenceFiles) {
    const ref = refByFileName.get(f.name);
    if (!ref) {
      unmatched.push(f.name);
      continue;
    }
    outgoing.append(ref, f, f.name);
  }
  if (unmatched.length > 0) {
    return {
      kind: 'error',
      message: `These files match no evidence record in the manifest: ${unmatched.join(', ')}. Check the file names (they must match each record's "file").`,
    };
  }

  // Derive the key from the manifest bytes → a byte-identical re-upload replays (safe to re-run); a
  // genuinely new bundle gets a fresh key. (It won't dedupe against the CLI seed, whose key prefix differs.)
  const idempotencyKey = `portal:${createHash('sha256').update(manifestBytes).digest('hex')}`;

  const token = await readToken();
  if (!token) redirect('/login');

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/imports`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      body: outgoing,
      cache: 'no-store',
    });
  } catch {
    return { kind: 'error', message: 'Cannot reach the server. Please try again.' };
  }

  if (res.status === 401) redirect('/logout'); // expired/deactivated → clear session + bounce
  if (res.status === 403) {
    return { kind: 'error', message: 'You do not have permission to import.' };
  }
  if (res.status === 409) {
    return {
      kind: 'error',
      message: 'An identical import is already in progress. Wait a moment and try again.',
    };
  }
  if (res.status === 400) {
    return {
      kind: 'error',
      message: 'The import was rejected as invalid. Check the manifest and try again.',
    };
  }
  if (!res.ok) {
    // 500 — most commonly a re-import of a bundle whose record ids already exist (ids come from the
    // manifest refs, so the same bundle can't be imported twice under different upload keys).
    return {
      kind: 'error',
      message:
        'The import failed on the server. If this bundle was already imported, it cannot be imported again under a new upload.',
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'error', message: 'The server returned an unexpected response.' };
  }
  const parsed = ImportResultSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: 'error', message: 'The server returned an unexpected response.' };
  }

  // Success: new cases may now exist — bust the tagged dashboard stats and the untagged case list.
  revalidatePath('/cases', 'page');
  updateTag(CASE_STATS_TAG);
  return { kind: 'success', result: parsed.data, replayed: res.status === 200 };
}
