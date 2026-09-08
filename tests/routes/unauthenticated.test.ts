// Risk #5: an unauthenticated visitor reaching relationship data.
//
// Every route on the agreed surface is asserted against its *actual* response, not
// a uniform 401 -- this surface has three different unauthenticated shapes, and a
// test that assumed one of them would fail on correct code. Getting the expectation
// from the route's real contract is the point:
//
//   "Unauthorized"          401 JSON  -- the machine/island routes
//   "Musisz być zalogowany" 401 JSON  -- the form-backed profile and settings routes
//   302 redirect, no body             -- the two routes a browser form posts to,
//                                        which have somewhere to send the user
//
// No Supabase client is stubbed here on purpose. Every one of these handlers runs
// its guard before it builds a client or reads a body, so if any of them ever
// stopped doing that, these tests would start failing on a missing client rather
// than passing quietly. That makes this file a check on guard *ordering* too.
import { describe, expect, it } from "vitest";
import { createContext, jsonBody } from "./context";

import { PATCH as peopleIdPatch, DELETE as peopleIdDelete } from "@/pages/api/people/[id]";
import { POST as contactEventsPost, GET as contactEventsGet } from "@/pages/api/contact-events";
import { PATCH as contactEventIdPatch, DELETE as contactEventIdDelete } from "@/pages/api/contact-events/[id]";
import { POST as rankingsPost, GET as rankingsGet } from "@/pages/api/rankings";
import { POST as aiPingPost, GET as aiPingGet } from "@/pages/api/internal/ai-ping";
import { POST as profilePost } from "@/pages/api/profile";
import { POST as deleteDataPost } from "@/pages/api/settings/delete-data";
import { POST as settingsEmailPost } from "@/pages/api/settings/email";
import { POST as settingsPasswordPost } from "@/pages/api/settings/password";
import { POST as peoplePost } from "@/pages/api/people";
import { POST as resetPasswordPost } from "@/pages/api/auth/reset-password";

type Handler = (context: never) => Promise<Response> | Response;

interface JsonRouteCase {
  name: string;
  handler: Handler;
  method: string;
  /** The exact message this route returns -- these differ, and the difference is the test. */
  message: string;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  json?: unknown;
}

// The two AI-job routes are covered here rather than only over HTTP because Phase 1's
// Probe B settled that `cloudflare:workers` can be aliased to an in-memory KV stub
// (tests/stubs/cloudflare-workers.ts), so their module graph loads in node.
const JSON_ROUTES: JsonRouteCase[] = [
  {
    name: "PATCH /api/people/[id]",
    handler: peopleIdPatch,
    method: "PATCH",
    message: "Unauthorized",
    params: { id: "any" },
    json: {},
  },
  {
    name: "DELETE /api/people/[id]",
    handler: peopleIdDelete,
    method: "DELETE",
    message: "Unauthorized",
    params: { id: "any" },
  },
  { name: "POST /api/contact-events", handler: contactEventsPost, method: "POST", message: "Unauthorized", json: {} },
  {
    name: "GET /api/contact-events",
    handler: contactEventsGet,
    method: "GET",
    message: "Unauthorized",
    searchParams: { personId: "any" },
  },
  {
    name: "PATCH /api/contact-events/[id]",
    handler: contactEventIdPatch,
    method: "PATCH",
    message: "Unauthorized",
    params: { id: "any" },
    json: {},
  },
  {
    name: "DELETE /api/contact-events/[id]",
    handler: contactEventIdDelete,
    method: "DELETE",
    message: "Unauthorized",
    params: { id: "any" },
  },
  { name: "POST /api/rankings", handler: rankingsPost, method: "POST", message: "Unauthorized", json: {} },
  {
    name: "GET /api/rankings",
    handler: rankingsGet,
    method: "GET",
    message: "Unauthorized",
    searchParams: { jobId: "any" },
  },
  { name: "POST /api/internal/ai-ping", handler: aiPingPost, method: "POST", message: "Unauthorized" },
  {
    name: "GET /api/internal/ai-ping",
    handler: aiPingGet,
    method: "GET",
    message: "Unauthorized",
    searchParams: { jobId: "any" },
  },
  { name: "POST /api/profile", handler: profilePost, method: "POST", message: "Musisz być zalogowany" },
  { name: "POST /api/settings/delete-data", handler: deleteDataPost, method: "POST", message: "Musisz być zalogowany" },
  { name: "POST /api/settings/email", handler: settingsEmailPost, method: "POST", message: "Musisz być zalogowany" },
  {
    name: "POST /api/settings/password",
    handler: settingsPasswordPost,
    method: "POST",
    message: "Musisz być zalogowany",
  },
];

describe.each(JSON_ROUTES)("$name with no session", (route) => {
  it(`returns 401 and the message this route actually sends`, async () => {
    const response = await invoke(route.handler, {
      user: null,
      method: route.method,
      params: route.params,
      searchParams: route.searchParams,
      json: route.json,
    });

    expect(response.status).toBe(401);
    expect(await jsonBody(response)).toEqual({ error: route.message });
  });
});

// The two routes a browser <form> posts to. They redirect rather than return JSON,
// because unlike the island routes they have a page to send the user back to.
describe("the redirecting routes with no session", () => {
  it("POST /api/people redirects to sign-in and writes nothing", async () => {
    const response = await invoke(peoplePost, {
      user: null,
      form: { name: "Should not be created", relationshipType: "friend", description: "x", weight: "5" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    // A redirect alone does not discharge "the mutation does not land". The guard
    // runs before the Supabase client is ever built, and no client is stubbed in
    // this file -- so had the handler reached its insert, it would have thrown
    // here rather than redirecting.
    await expectNoBody(response);
  });

  it("POST /api/auth/reset-password redirects with the expired-link error and never calls updateUser", async () => {
    const response = await invoke(resetPasswordPost, {
      user: null,
      form: { password: "new-password-123" },
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location.startsWith("/auth/reset-password?error=")).toBe(true);
    // Our own copy, not Supabase's -- the vendor never got a chance to speak.
    expect(decodeURIComponent(location)).toContain("Link do resetowania hasła wygasł lub został już użyty");
    await expectNoBody(response);
  });
});

async function invoke(handler: Handler, init: Parameters<typeof createContext>[0]): Promise<Response> {
  return await handler(createContext(init) as never);
}

async function expectNoBody(response: Response): Promise<void> {
  expect(await response.text()).toBe("");
}
