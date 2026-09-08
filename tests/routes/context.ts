// A synthetic APIContext, so a test can invoke a real exported route handler
// without starting a server.
//
// The eleven handlers on this surface consume exactly six members of the context:
// `locals.user`, `request` (headers plus formData() or json()), `cookies`,
// `url.searchParams`, `params.id`, and `redirect`. Everything else Astro puts on
// an APIContext is unused here, so it is not built -- an honest stub of six things
// is easier to trust than a half-finished imitation of forty.
//
// What this deliberately does NOT prove: that a session cookie becomes
// `locals.user`. That is middleware's job, `user` is handed in directly here, and
// the whole cookie -> middleware -> locals.user -> guard chain is what tests/http
// exists to exercise.
import type { APIContext } from "astro";

export interface SyntheticUser {
  id: string;
  email?: string;
}

export interface ContextInit {
  /** What middleware would have put on locals. `null` (the default) is an anonymous caller. */
  user?: SyntheticUser | null;
  /** Route params -- `id` for the two id-addressed routes. */
  params?: Record<string, string>;
  /** Query string values, read by the routes that take `personId` or `jobId`. */
  searchParams?: Record<string, string>;
  method?: string;
  /** A JSON request body. Mutually exclusive with `form`. */
  json?: unknown;
  /** A form-encoded request body. Mutually exclusive with `json`. */
  form?: Record<string, string>;
  path?: string;
}

const ORIGIN = "http://localhost:4321";

export function createContext(init: ContextInit = {}): APIContext {
  const url = new URL(init.path ?? "/api/test", ORIGIN);
  for (const [key, value] of Object.entries(init.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const request = buildRequest(url, init);

  const context = {
    locals: { user: init.user ?? null },
    request,
    url,
    params: init.params ?? {},
    cookies: createCookieStub(),
    // Astro's own redirect: a bodiless 302 carrying Location. Routes that redirect
    // then mutate the returned response's headers (people.ts:29-32), so this has to
    // be a real, writable Response rather than a marker object.
    redirect: (path: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: path } }),
  };

  return context as unknown as APIContext;
}

function buildRequest(url: URL, init: ContextInit): Request {
  const method = init.method ?? "POST";

  if (init.json !== undefined) {
    return new Request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(init.json),
    });
  }

  if (init.form) {
    const body = new URLSearchParams(init.form);
    return new Request(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  // GET and HEAD may not carry a body.
  return new Request(url, method === "GET" || method === "HEAD" ? { method } : { method });
}

/**
 * The narrowest AstroCookies stand-in: `src/lib/supabase.ts` only ever calls
 * `.set()`, and only from `createServerClient`'s setAll callback -- which is
 * stubbed out in this layer, so nothing ever reaches it here.
 */
function createCookieStub() {
  const written = new Map<string, string>();
  return {
    set: (name: string, value: string) => written.set(name, value),
    get: (name: string) => {
      const value = written.get(name);
      return value === undefined ? undefined : { value };
    },
    delete: (name: string) => written.delete(name),
    has: (name: string) => written.has(name),
  };
}

/** Reads a JSON response body without repeating the cast in every assertion. */
export async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return body as Record<string, unknown>;
}
