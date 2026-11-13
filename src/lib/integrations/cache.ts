// A short memory of what an integration answered, per replica: allowed by
// the stateless rule, since losing it or replicas disagreeing only means a
// widget a little more or less fresh. Bounded, so it can't grow.
const MAX_ENTRIES = 50;
const entries = new Map<string, { value: unknown; until: number }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.until > now()) return hit.value as T;
  const value = await load();
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  entries.set(key, { value, until: now() + ttlMs });
  return value;
}
