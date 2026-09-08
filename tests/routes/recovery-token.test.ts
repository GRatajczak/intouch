// Risk #5, second face: a stale or replayed recovery token reaching relationship data.
//
// The four branches asserted here are the ones *our* code owns. Whether Supabase
// rejects a replayed token, and when a token expires, are the vendor's contract --
// test-plan §7 puts them out of scope, and a test that drove a real expired token
// would be testing Supabase, slowly. So the failure is injected, and every
// assertion is about which branch we took, never about the message Supabase wrote:
// that string is unsanitised and version-dependent, and pinning it would make a
// vendor patch look like a regression in our auth flow.
//
// This replaces the manual-only checkbox left behind by the password-recovery
// change (context/archive/2026-09-04-password-recovery/plan.md:280, :332).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "./context";
import { clearRouteClient, setRouteClient } from "./route-client";

vi.mock("@/lib/supabase", async () => {
  const state = await import("./route-client");
  return { createClient: () => state.getRouteClient() };
});

const { GET: confirm } = await import("@/pages/auth/confirm");
const { POST: resetPassword } = await import("@/pages/api/auth/reset-password");

let verifyOtp: ReturnType<typeof vi.fn>;
let updateUser: ReturnType<typeof vi.fn>;
let signOut: ReturnType<typeof vi.fn>;

beforeEach(() => {
  verifyOtp = vi.fn();
  updateUser = vi.fn();
  signOut = vi.fn();
  setRouteClient({ auth: { verifyOtp, updateUser, signOut } });
});

afterEach(() => {
  clearRouteClient();
  vi.clearAllMocks();
});

describe("GET /auth/confirm", () => {
  // Branch 1 and 2 share an outcome, so they share a parameterised test: the guard
  // at confirm.ts:23 refuses anything that is not a well-formed allowed type, and
  // the important half of the assertion is that no exchange was even attempted.
  const MALFORMED: { name: string; params: Record<string, string> }[] = [
    { name: "no token_hash at all", params: { type: "recovery" } },
    { name: "a token_hash but no type", params: { token_hash: "some-token" } },
    { name: "a type outside ALLOWED_TYPES", params: { token_hash: "some-token", type: "signup" } },
    { name: "a garbage type", params: { token_hash: "some-token", type: "../admin" } },
  ];

  it.each(MALFORMED)("redirects to sign-in without attempting an exchange when given $name", async ({ params }) => {
    const response = await confirm(createContext({ method: "GET", searchParams: params }) as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("creates no session and redirects to the reset page when verifyOtp fails", async () => {
    // Injected, never obtained: this is what a stale, replayed or tampered token
    // looks like to our code, without asking Supabase to produce one.
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });

    const context = createContext({ method: "GET", searchParams: { token_hash: "stale-token", type: "recovery" } });
    const response = await confirm(context as never);

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "stale-token" });
    expect(response.status).toBe(302);

    const location = response.headers.get("Location") ?? "";
    // Our branch: the error redirect, not the sign-in redirect and not `next`.
    expect(location.startsWith("/auth/reset-password?error=")).toBe(true);

    // No session was established: nothing was written to the cookie jar, and no
    // auth cookie header rode along on the response.
    expect(context.cookies.has("sb-access-token")).toBe(false);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it.each([
    { type: "recovery", expected: "/auth/reset-password" },
    { type: "email_change", expected: "/settings" },
  ])("redirects a successful $type exchange to its mapped destination", async ({ type, expected }) => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await confirm(
      createContext({ method: "GET", searchParams: { token_hash: "good-token", type } }) as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(expected);
  });

  it("honours an explicit next over the default destination", async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const response = await confirm(
      createContext({
        method: "GET",
        searchParams: { token_hash: "good-token", type: "recovery", next: "/settings" },
      }) as never,
    );

    expect(response.headers.get("Location")).toBe("/settings");
  });
});

describe("POST /api/auth/reset-password", () => {
  it("redirects without calling updateUser when there is no session", async () => {
    const response = await resetPassword(
      createContext({ user: null, form: { password: "brand-new-password" } }) as never,
    );

    expect(response.status).toBe(302);
    expect(decodeURIComponent(response.headers.get("Location") ?? "")).toContain(
      "Link do resetowania hasła wygasł lub został już użyty",
    );
    // The whole point: an expired or replayed link must not be able to set a
    // password. Reaching updateUser at all would mean the guard had been bypassed.
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("updates the password when a session exists, proving the guard is the only thing refusing above", async () => {
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });

    const response = await resetPassword(
      createContext({ user: { id: "user-1" }, form: { password: "brand-new-password" } }) as never,
    );

    expect(updateUser).toHaveBeenCalledWith({ password: "brand-new-password" });
    // Every other session is dropped, so a stolen link cannot outlive the reset.
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(response.headers.get("Location")).toBe("/");
  });
});
