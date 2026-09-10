# Bring-your-own OpenAI key + a daily cap on manual recomputes — Plan Brief

> Full plan: `context/changes/byok-openai-key/plan.md`
> Research: `context/changes/byok-openai-key/research.md`

## What & Why

A user who supplies their own OpenAI API key pays for their own AI use and gets no cap on it.
A user who does not keeps a free tier: the automatic daily refresh stays untouched, and the
manual "Przelicz teraz" button works once per calendar day. This unparks the roadmap's
"bring your own key" item as slice **S-17**, and it answers the four obligations that entry
named: encryption at rest, a path to rotation, revocation, and a real error path for a key
that hits its quota.

## Starting Point

Today one key in Workers Secrets pays for everything. `createOpenAIClient` takes no arguments
and reads a module-level secret, so nothing in the system can bill a call to anyone. Manual
recompute is unlimited; the automatic one is already bounded to roughly once a day by the
24-hour staleness window. There is no cryptography in the repo, no masked-secret UI, and no
sanctioned way to stub OpenAI in a test.

## Desired End State

A user pastes a key into `/settings`, sees it confirmed as `sk-…4f2a`, and from then on every
ranking computed for them, including the one behind their reminder emails, runs on their key
with no limit. A user without a key who clicks "Przelicz teraz" twice in one day gets a calm
message saying today's recompute is used up, with their existing ranking still on screen and a
link to add a key. Removing a stored key puts them straight back on the free tier.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Where the key lives | AES-GCM ciphertext in a column on `profiles` | The only place existing erasure already honours; a new table would survive "delete my data" the way `reminder_sends` does | Change + Research |
| Envelope format | `v1:<iv>:<ciphertext>` from day one | Makes a later secret rotation possible without a format migration, for a few lines now | Change |
| What the cap covers | Only the manual `force` recompute | The automatic 24-hour refresh is the product working as designed, not discretionary spend | Change |
| Counter substrate | Guarded `UPDATE … RETURNING` on `profiles` | KV has no compare-and-swap and reads stale for 60s, so a KV counter fails open; a row lock is a real compare-and-swap | Research |
| Day boundary | Calendar day in `Europe/Warsaw` | The app already has exactly one notion of a day, and the reminder cooldown encodes it in SQL for the same reason | Research |
| Cron sweep | Uses the owner's key when present | Whoever supplied a key pays for all of their own calls, including reminders | Change |
| Decryption failure | Silent fallback to the app key, plus a visible "unreadable" state in settings | Our fault, most likely a rotated secret, so it must not break the user's ranking | Plan |
| Key rejected by OpenAI | Run fails, no fallback | Otherwise a deliberately bad key becomes unlimited AI billed to the app, inverting the whole point | Plan |
| Limit UX | 429 on the attempt, plus a standing explanation in settings | One source of truth on the server, no extra work at dashboard render, no second place that has to know the day rule | Plan |
| Test stubbing | At the network edge, via the SDK's `fetch` option | Follows the test plan's own rule and actually proves we distinguish 401 from 429 | Plan |

## Scope

**In scope:** encrypted per-user key storage; a settings section to add, replace and remove it;
per-owner key resolution in both the request path and the cron sweep; a once-per-calendar-day
claim on manual recompute; distinguishing a rejected key from an exhausted quota and surfacing
it; roadmap, PRD, lessons and tracker sync.

**Out of scope:** rotation tooling and re-encryption; a key for the internal diagnostic ping
route; any cap on the automatic refresh; billing, metering or spend display; a new analytics
event; a second provider or a per-provider table.

## Architecture / Approach

Three seams. **Storage** is nullable additive columns on `profiles` plus a `src/lib/crypto/`
module that owns AES-GCM through WebCrypto and returns null rather than throwing, like every
other factory in `src/lib/`. **Threading** widens `createOpenAIClient` with an optional key and
adds a resolver that turns an already-loaded profile row into a decision about whose key pays;
the ranking run gets the row for free, and the sweep changes only its wiring. **Gating** is one
guarded update issued through the owner's own RLS-scoped client, placed after the in-flight
guard so a double click cannot burn the free run.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema and crypto seam | Columns, the versioned envelope, the new secret | First cryptography here; a wrong secret shape fails at request time, not deploy time |
| 2. Key reaches the model | BYOK works end to end, no UI yet | The profile load has to move above client construction inside the ranking run |
| 3. Settings section | Add, replace, remove a key | No masked-secret precedent exists; the confirm-dialog trap from delete-data applies |
| 4. Daily gate | Manual recompute capped for the free tier | The claim must not be spent when the in-flight guard reuses a job |
| 5. Key health marking | A dead key is explained in settings | Agreed first cut if scope has to shrink |
| 6. Documents and tracker | Roadmap S-17, PRD note, lesson, Linear | Five separate roadmap edits, easy to half-apply |

**Prerequisites:** a generated 32-byte encryption secret placed in Workers Secrets and GitHub
Secrets by a human, per CLAUDE.md; the local Supabase stack running for the route tests.

**Estimated effort:** roughly four to six sessions, with Phases 1 and 2 the shortest and Phase
3 the largest.

## Open Risks & Assumptions

- Rotating the encryption secret while ciphertext exists makes every stored key unreadable. The
  code degrades safely and the settings page asks for the key again, but there is no migration
  path and no runbook, by decision.
- A key validated at save time can die later. Phase 5 makes that visible, and Phase 5 is also
  the agreed cut candidate, so cutting it means a revoked key shows only as a failed recompute.
- The test plan's Phase 3 has not run, so this change sets the OpenAI stubbing precedent rather
  than following one.
- Ordering assumes each phase can ship on its own. Phase 4 deliberately lands after Phase 3 so
  a cap never exists without a way around it.

## Success Criteria (Summary)

- A user with their own key recomputes as often as they like, and their reminder emails are
  built from a ranking billed to that key.
- A user without one keeps their automatic daily refresh and is refused a second manual
  recompute on the same calendar day, with a message that tells them how to remove the limit.
- Deleting account data removes the stored key along with the profile row, with no extra code
  needed to make that true.
