// Stands in for the `cloudflare:workers` module under Vitest.
//
// src/lib/ai-jobs.ts imports `env` from `cloudflare:workers` at module top level,
// so every route that reaches AI jobs (/api/rankings, /api/internal/ai-ping) drags
// that specifier into the module graph. There is no workerd runtime in a node test,
// and @astrojs/cloudflare marks `cloudflare:*` external, so the import has to be
// aliased to something. This is that something: an in-memory KV namespace exposing
// only the surface src/lib/ai-jobs.ts actually uses -- get(key), get(key, "json")
// and put(key, value, { expirationTtl }).
//
// TTL is accepted and ignored on purpose. Expiry is Cloudflare's behaviour, not
// ours; a test that asserted on it would be testing the vendor.

const store = new Map<string, string>();

export const env = {
  AI_JOBS: {
    get(key: string, type?: "json"): Promise<unknown> {
      const raw = store.get(key);
      if (raw === undefined) return Promise.resolve(null);
      return Promise.resolve(type === "json" ? JSON.parse(raw) : raw);
    },
    put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
  },
};

/** Drop everything the stub is holding -- call between tests that share a KV key. */
export function resetKvStub(): void {
  store.clear();
}
