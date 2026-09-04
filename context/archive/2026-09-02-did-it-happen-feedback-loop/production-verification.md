# Phase 5: production verification numbers

Recorded per plan.md's Phase 5 manual verification items, following
`context/changes/ai-contact-hierarchy/production-verification.md`'s precedent.

## Run details

- Date: 2026-09-04
- Target: deployed preview Worker (`npm run preview:upload`), Worker Version ID
  `57abe445-0276-4176-baf3-1985271ee7e4`, hosted Supabase project (the same one
  `VERIFY_EMAIL` / `VERIFY_EMAIL_2` are confirmed against)
- Verified with:
  - `npm run verify:feedback-loop -- <preview-url>` — all assertions passed
  - `npm run verify:ranking -- <preview-url>` — all assertions passed (existing
    ranking path unaffected)
- Accounts: `VERIFY_EMAIL` (account A, real profile + 3 people) and `VERIFY_EMAIL_2`
  (account B, used only to prove cross-account isolation)

## `verify:feedback-loop` assertion results

All pass, in order:

1. Account A sign-in returns session cookies
2. Account A has at least one ranking entry to mark (found via a forced recompute)
3. `POST /api/contact-events` returns `201` with the created event and facts
   (`lastHappenedAt` set)
4. The created event is readable back via `GET /api/contact-events?personId=...`
5. Account B sign-in returns session cookies
6. Account B's `GET` for account A's `personId` returns zero events (owner-scoped,
   not just person-scoped)
7. Account B's `PATCH` on account A's event returns `404`
8. Account B's `DELETE` on account A's event returns `404`
9. A forced recompute completes and the marked person still has an entry whose
   `reason` is real model output (not the `reconcileEntries` fallback string)
10. Account A's `PATCH` (outcome → `not_yet`, new note) returns `200`, and the
    returned facts reflect it (`lastAttemptFailed: true`)
11. Account A's `DELETE` returns `200`, and the event is gone from a follow-up `GET`

One real bug was caught and fixed during this pass: the script's own `DELETE` calls
were missing `Content-Type: application/json`, so Astro's origin-check middleware
rejected them with `403` before routing — the exact failure mode `lessons.md`
documents for non-browser callers of unsafe methods. Not a product defect; the
script was corrected (both the cross-account and same-account `DELETE` calls) and
the assertions passed cleanly on the next run.

## `verify:ranking` timings (same preview, immediately after)

- `POST /api/rankings` (forced): **277ms**, under the 3000ms non-blocking budget
- Background job settled (POST → `done`): **4732ms** total wall time (17.1x the
  POST response time — confirms the response genuinely returned before the OpenAI
  call finished, not after)
- 3 entries, 3/3 people considered

## `wrangler tail` (manual item 5.5)

Attempted: `npx wrangler tail --format pretty` connected successfully
(`Successfully created tail` / `Connected to intouch, waiting for logs...`), but
produced **zero output** across two real requests (sign-in + a forced ranking) sent
to the same preview while the tail session was live.

This matches `lessons.md`'s documented cause exactly: `observability` is a
non-versioned setting, and every deploy so far has used `npm run preview:upload`
(`wrangler versions upload`), never `wrangler versions deploy` — so the setting has
never synced, and `tail` stays silent regardless of real traffic. Per the same
lessons.md entry's corollary ("a verification step that depends on reading
`wrangler tail` cannot be satisfied by a `versions upload` preview alone — either
budget a real deploy, or make the assertion self-evidencing"), the team chose the
self-evidencing path for this round: `verify:feedback-loop`'s own assertions (status
codes, returned `facts`, and the reconciliation-fallback check on `reason`) already
prove the mark → read → cross-account-deny → recompute → edit → delete chain works
correctly end to end, without needing a log line to confirm it. No error-level
`[ranking]` output was observed, but "observed" here means "none exists to read",
not "positively absent" — a real `wrangler versions deploy` (shipping this slice to
production traffic) would close that gap and is deferred to whenever the team
decides to promote this version.

## Conclusion

The full did-it-happen loop — write, read-back, cross-account isolation, a forced
recompute that actually incorporates the new facts, edit, and delete — all work end
to end against the real deployed Worker and hosted Supabase project. The existing
ranking path (`S-02`) is unaffected. The only open item is CPU/log observability,
which requires a real `versions deploy` to inspect and is not blocking given the
verification script's own assertions already cover correctness.
