// The seam every route uses to reach Supabase.
//
// `src/lib/supabase.ts`'s createClient turns a request's cookies into a session.
// Tests in this layer install the client directly instead, which lets a test say
// "run this handler as user B" without hand-crafting Supabase's chunked auth
// cookie -- an internal format that shifts between versions. Proving that a real
// cookie becomes `locals.user` is tests/http's job, not this layer's.
let current: unknown = null;

export function setRouteClient(client: unknown): void {
  current = client;
}

export function getRouteClient(): unknown {
  return current;
}

export function clearRouteClient(): void {
  current = null;
}
