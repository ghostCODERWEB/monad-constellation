// A small Nansen client: one POST helper that reports the credits each call
// actually cost (from the response header), and an in-memory TTL cache with
// in-flight de-duplication, so a crowd of players costs what one does.

const BASE = 'https://api.nansen.ai/api/v1';

export interface NansenCall<T> { body: T | null; credits: number; error: string | null }

export async function nansen<T>(path: string, body: unknown, ms = 25_000): Promise<NansenCall<T>> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) return { body: null, credits: 0, error: 'NANSEN_API_KEY is not set' };
  try {
    const r = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
      cache: 'no-store',
    });
    const credits = Number(r.headers.get('x-nansen-credits-cost') ?? 0);
    if (!r.ok) return { body: null, credits, error: `${r.status} on ${path}` };
    return { body: (await r.json()) as T, credits, error: null };
  } catch (e) {
    return { body: null, credits: 0, error: `${path}: ${(e as Error).message}` };
  }
}

const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, make: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = make()
    .then((value) => { store.set(key, { at: Date.now(), value }); return value; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Runs `fn` over `items` with `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
