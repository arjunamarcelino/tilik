/**
 * Map over items with a bounded number of in-flight promises. Preserves input order in the result.
 * Keeps a fan-out (e.g. per-evidence MinIO reads) from opening an unbounded number of sockets per request.
 * `limit` is clamped to ≥1 (a non-positive limit would otherwise spawn zero workers and silently return
 * holes). On the first rejection the remaining workers stop claiming new items before Promise.all rejects.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let aborted = false;
  const worker = async (): Promise<void> => {
    while (!aborted && cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        aborted = true; // stop sibling workers from issuing further work
        throw err;
      }
    }
  };
  const count = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: count }, () => worker());
  await Promise.all(workers);
  return results;
}
