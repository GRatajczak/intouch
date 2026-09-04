# AI Contact Hierarchy — Plan Brief

> Full plan: `context/changes/ai-contact-hierarchy/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` (`S-02`)

## What & Why

Roadmap slice `S-02`, PRD `US-01` + `FR-007`. Turn the placeholder `/dashboard` — already
labelled "Dziś" in the nav — into the ranked "who to reconnect with" list, computed by an
OpenAI call from the self-profile and the people catalog, where every entry carries a
suggested time window and a short reason. This is the slice carrying the product's biggest
unknown: the PRD names AI relevance as the guardrail that decides whether the core feature
is worth anything at all.

## Starting Point

All three prerequisites are shipped, including `F-02`, which the roadmap still shows as
`in-progress` but whose change folder reads `status: implemented`. `people` and `profiles`
hold everything the prompt needs (`S-01` + `S-09`). `src/lib/ai-jobs.ts`,
`src/lib/openai.ts` and `src/pages/api/internal/ai-ping.ts` are a working, production-
verified `POST → 202 → waitUntil → KV → GET poll` path. What's missing is anywhere to store
a ranking (`F-02`'s KV is deliberately 1h-TTL), any structured-output code, and any contact
history — which is `S-03`'s, not this slice's.

## Desired End State

A user with a profile and people opens `/dashboard` and sees their people in AI-decided
order. The top three carry a "Dlaczego teraz" paragraph and factor chips; the rest are
one-line rows with a time window and a `Rozwiń` affordance. A banner says when the order was
computed and offers "Przelicz teraz". A stale ranking refreshes quietly in the background
while the old one stays readable, and the new one swaps in when it lands — even if the user
left and came back. Two people with weight 8 sit in different positions, and the reason says
why.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope vs `S-03` | Render only what we have data for | No history chips, no `Zaplanowałam kontakt` / `Odłóż` actions — a thinner screen beats dead UI or fabricated last-contact dates. |
| Persistence | New owner-scoped `rankings` + `ranking_entries` | `S-03` attaches feedback to an entry and `S-04` reads the order; both need something that outlives `F-02`'s 1h KV TTL. |
| Trigger | Stale-on-view (24h) + explicit "Przelicz teraz" | Matches the mock's banner and needs no scheduled infrastructure — the nightly cron would drag in `S-04`'s unresolved cross-user RLS problem. |
| Loading UX | Show last ranking, poll, swap in | The screen is never empty for a returning user, and it reuses `F-02`'s proven poll contract unchanged. |
| Model | `gpt-5.4-mini` | Breaking weight ties on Polish free-text nuance is exactly where a nano model gets shallow, and that tie-break is an acceptance criterion. |
| Explanation depth | Full for top 3, collapsed below | Closes the roadmap's named `S-02` Unknown; matches the mock and honours `FR-007`'s "explainable enough to trust". |
| Time window | Enum bucket + Polish label map | Sortable for `S-04`'s scheduling and drift-proof, unlike model-authored prose; mirrors `src/lib/validation/profile.ts`. |
| Output shape | Full ordered list, every person | The calm tail is real data, and `S-04` needs a complete order, not just this week's top three. |
| Rhythm degradation | Omit the section and the chip | `S-09` made the fields optional on this promise; a "no preference" default just makes the model invent a confident rhythm claim. |
| Scale ceiling | Cap at 50 people, document it | Bounds prompt, output and cost with one constant, and makes the limit a tested property rather than a production cliff. |
| Failure | Never overwrite the stored ranking | A transient OpenAI blip must not wipe the product's main screen. |
| `owner_id` FK | `ON DELETE CASCADE` | Decided explicitly per `lessons.md`; retaining AI prose about a deleted user's relationships would violate the binary erasure NFR. |
| `OPENAI_API_KEY` | Stays `optional: true` | Promoting it to required would make a misconfigured deploy fail every request instead of just this screen. |

## Scope

**In scope:**
- `rankings` + `ranking_entries` tables with `F-01`'s RLS pattern, and regenerated types
- Time-window enum + Polish labels, and the zod schema for `responses.parse()`
- Prompt assembly with the 50-person cap and the rhythm-omission rule
- Reconciliation of the model's entries against the people actually sent, then persistence
- `POST` / `GET /api/rankings` wrapping it in `F-02`'s `waitUntil` + KV shape
- The `/dashboard` hierarchy view: banner, expanded top three, collapsed tail, two empty states
- `scripts/verify-ranking.ts` run against a deployed preview

**Out of scope:**
- Contact history and the did-it-happen loop (`S-03`) — including `US-01`'s fourth criterion
- Scheduled nightly recompute (`S-04`), reminder emails (`S-04`)
- Person edit / deactivate / delete (`S-05`), categories (`FR-006`)
- Any test framework, any new KV namespace or binding, any retry logic beyond the SDK's

## Architecture / Approach

`dashboard.astro` server-renders the stored ranking → a `client:load` island fires
`POST /api/rankings` when it's stale → the route writes a `pending` KV job, hands the work
to `cfContext.waitUntil()` and returns `202` immediately → the background task builds the
prompt, calls `responses.parse()` with `zodTextFormat`, reconciles the returned entries
against the people it sent, persists a `rankings` run plus its `ranking_entries`, and flips
the KV job to `done` → the island's poll picks that up and swaps the new list in. A failed
run writes nothing to Postgres, so the previous ranking survives.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Ranking schema and generated types | Two RLS-protected tables + regenerated `database.types.ts` | Missing the explicit table-level GRANTs, which this project needs on top of policies |
| 2. Contract, prompt, and call path | Working end to end via `curl`; no UI yet | OpenAI strict mode rejects optional fields, and the model can return person ids that were never sent |
| 3. The Dziś hierarchy view | The real `/dashboard` screen with polling and both empty states | Poll lifecycle — stopping on unmount, on terminal status, and on a job that never settles |
| 4. Production verification | `verify:ranking` passing on a deployed preview, real numbers recorded | Needs the production secret and a confirmed hosted-Supabase test account, both human steps |

**Prerequisites:** `S-01`, `S-09`, `F-02` all shipped (they are). `OPENAI_API_KEY` set
locally in `.dev.vars` and in Workers Secrets. A confirmed test account in the *hosted*
Supabase project with several people and a filled profile, for Phase 4. A local Supabase
stack for Phase 1.
**Estimated effort:** ~2 sessions across 4 phases — Phase 3 is the largest by volume,
Phase 2 by risk.

## Open Risks & Assumptions

- **Ranking quality is the real unknown and cannot be settled by any automated check.**
  The tie-breaking criterion is a human judgement call in Phase 2's manual verification; if
  the reasons read generic, the response is prompt iteration, and possibly the model tier.
- Assumes `gpt-5.4-mini` is enabled on the user's OpenAI account — verified in the installed
  SDK's model union, not against the account's actual entitlements.
- The 50-person cap is a reasoned default, not a measured one. Phase 4 records the real
  token and latency figures; if they leave more headroom than expected, the cap can rise.
- The mock shows a nightly "odświeżona dziś o 6:00". The shipped banner will say when the
  ranking was actually computed instead, which is honest but diverges from the design — flag
  it at design review rather than letting it read as an oversight.
- `ranking_entries.person_id` cascades on person deletion. `S-05` should confirm that is
  still what it wants when it plans its delete path.

## Success Criteria (Summary)

- A user with a profile and people opens `/dashboard` and gets a ranked list with a time
  window and a reason on every entry — the `US-01` outcome.
- Two people sharing a weight are ordered differently, and the reason names what separated
  them.
- A user with no people gets an explanatory empty state; a failed refresh never costs them
  the ranking they already had.
