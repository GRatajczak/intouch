# Phase 4: production verification numbers

Recorded per plan.md's Phase 4 manual verification item ("observed token usage and
latency ... and the headroom against Cloudflare's 50-subrequest and 10ms-CPU limits
is stated explicitly").

## Run details

- Date: 2026-09-02
- Target: deployed preview Worker (`npm run preview:upload`), hosted Supabase project
  `InTouchProd`
- Verified with: `npm run verify:ranking -- <preview-url>` — all assertions passed
- Test account size: 1 person (largest available on the `VERIFY_EMAIL` account at
  verification time — not a full 50-person stress test; see below for why this still
  bounds the risk)

## Observed timings

- `POST /api/rankings` (forced): **321–403ms** across two runs, well under the
  3000ms non-blocking budget the script asserts
- Background job settled (POST → `done`): **~2.4–2.7s** total wall time
- First poll (~0.4–0.5s after POST) still showed `pending`, confirming the response
  really did return before the OpenAI call finished

## Subrequest budget

One ranking run performs a **fixed** number of subrequests, independent of how many
people are in the batch (the model is called once with the whole list, not once per
person):

- 1 Supabase `select` for the profile
- 1 Supabase `select` for people
- 1 Supabase `insert` for the `rankings` row
- 1 Supabase `insert` for the `ranking_entries` rows
- 2 KV writes (`pending`, then `done`/`failed`)
- 1 OpenAI `responses.parse()` call

= **~7 subrequests**, against Cloudflare's 50-subrequest ceiling shared across the
request and its `waitUntil` continuation. Because this count doesn't grow with the
number of people (only the OpenAI payload size does, capped at `PEOPLE_CAP = 50`),
the 1-person test run's subrequest count is the same as a 50-person run's would be —
this is the property that makes a single-person test still representative of the cap
case for this specific limit.

## CPU-time budget

Not directly measured — `wrangler tail` was not used, since this was a
`versions upload` preview rather than a `versions deploy`, and `lessons.md` records
that non-versioned settings (including `observability`) only sync on `versions
deploy`, making `tail` unreliable against a preview alone.

Reasoned instead from what actually runs: waiting on the OpenAI response is I/O, not
CPU-metered (confirmed by `F-02`'s own verification). The only CPU-bound work per
request is parsing the JSON request/response bodies and reconciling the model's
`entries` array against the people sent (`reconcileEntries` in `src/lib/ranking/run.ts`)
— a linear scan bounded by `PEOPLE_CAP = 50`. At 1 person this is negligible; at 50 it
is still a handful of array operations over small objects, nowhere near typical
10ms-CPU-limit failure patterns (which tend to involve large loops, heavy
serialization, or synchronous crypto/compression). No CPU-time risk is expected at the
cap, but this is architectural reasoning, not a measured number — flagged as a gap
below.

## Token usage

Not captured in this run. `GET /api/rankings` does not currently surface the OpenAI
response's `usage` field, and no `wrangler tail` session was run to read it from logs.
This is a real gap in this verification pass, not a blocker: nothing in the app
depends on token counts (no budget enforcement, no cost-based throttling), so it does
not affect correctness. If token cost becomes a concern later, `response.usage` is
available on the `responses.parse()` result in `src/lib/ranking/run.ts` and could be
logged there.

## Conclusion

The non-blocking shape, RLS-scoped persistence, and reconciliation logic all work end
to end against the real deployed Worker and hosted Supabase project. Subrequest
headroom is large and provably cap-invariant. CPU-time headroom is reasoned to be
large but not measured directly. Token usage was not captured this round.
