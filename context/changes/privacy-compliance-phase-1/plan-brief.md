# Privacy Compliance Phase 1 — Plan Brief

> Full plan: `context/changes/privacy-compliance-phase-1/plan.md`

## What & Why

InTouch holds personal data about its users and about their relatives and friends, and sends part of it to OpenAI. An audit against GDPR, ePrivacy (PKE art. 399), EDPB Opinion 28/2024 and the AI Act found five technical gaps that a privacy policy cannot cover. This change closes them so the policy written next describes what the app really does.

## Starting Point

OpenAI requests are stored for 30+ days by default; analytics run without consent (opt-out, no banner); "delete my data" leaves the account and e-mail behind; there is no export and no retention on logs and old rankings. Prompt minimisation (age instead of birth date) is already in place.

## Desired End State

Nothing is stored by OpenAI. Analytics start only after an explicit "yes", collected by a banner and editable in Settings. One "Usuń konto" button erases the account, all data and the PostHog person. Users can download all their data as JSON. Old reminder logs and rankings are purged by the database daily.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Controller | Private individual | Hobby/MVP, no registered business | Plan |
| OpenAI region | Stay on current project, `store: false` | Transfer disclosed in policy instead of a new EU project | Plan |
| Consent model | New nullable `analytics_consent` + backfill old column to opted-out | Separates "undecided" from "refused" and keeps rollback safe | Plan |
| Anonymous visitors | Banner + `localStorage`, SDK never loads before "yes" | Meets art. 399 PKE and preserves the funnel for consenting users | Plan |
| `signup_started` | Removed; `$pageview` of `/auth/confirm-email` replaces it | No consent record can exist before the profile does | Plan |
| Account deletion | `SECURITY DEFINER` `delete_my_account()` over RPC | Keeps the service-role client out of request paths (ESLint rule untouched) | Plan |
| Deletion UX | One immediate "Usuń konto" button | Clear promise and art. 17 compliance, no intermediate state | Plan |
| PostHog erasure | `bulk_delete` by distinct id, fail-soft, runs first | Real erasure in the vendor without blocking the user on an outage | Plan |
| Export | One JSON file, key material excluded | Art. 20 "machine-readable" with the smallest surface | Plan |
| Retention | `reminder_sends` 90 d; `rankings` 12 mo (newest kept); `contact_events` kept | Each period has a functional reason | Plan |
| Retention mechanism | `pg_cron` in Postgres | No Worker or admin client needed | Plan |
| Tests | Unit + route (RLS fixture), no new e2e | Matches existing suites; banner verified manually | Plan |

## Scope

**In scope:** `store: false`; opt-in consent and banner; account deletion with PostHog erasure; JSON export; retention.

**Out of scope:** privacy policy, terms of service, footer, signup checkbox, `terms_accepted_at`; EU residency for OpenAI; vendor DPAs; "Moje dane" page; CSV/ZIP; deletion grace period; special-category data blocking.

## Architecture / Approach

Five independent phases, each ending in a manual pause. All schema changes are additive and forward-compatible (`CLAUDE.md` rollback rules). Privileged work lives in SQL functions called under the user's own session, never through a service-role client in a request path. Consent is enforced at three gates: the SDK is not mounted, server events check the profile, and the Settings toggle keeps the legacy column consistent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. `store: false` | One-line fix + pinning test | None |
| 2. Opt-in consent | Migration, banner, gated SDK, Settings sync, `signup_started` removal | Largest surface; anonymous→profile hand-off; reverses a recorded decision |
| 3. Account deletion | SQL function, route, UI, PostHog erasure | Deleting `auth.users` from SQL; PostHog `bulk_delete` shape must be verified |
| 4. Export | JSON route and button | Leaking key ciphertext (explicitly excluded and tested) |
| 5. Retention | `pg_cron` purge function and job | `pg_cron` availability on the prod project |

**Prerequisites:** local Supabase running for route/RLS tests; human sets `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` (Phase 3) and confirms `pg_cron` on `InTouchProd` (Phase 5).
**Estimated effort:** ~4–5 sessions across 5 phases (Phase 2 is roughly half of it).

## Open Risks & Assumptions

- PostHog `bulk_delete` documents `ids` as required; the body shape is to be confirmed with a real call before wiring (Phase 3).
- Server-side events captured without a person profile may stay in PostHog under the pseudonymous user id; the policy must say so.
- Backfilling `analytics_opt_out = true` turns analytics off for every current user until they opt in; funnel numbers will drop by design.
- Deleting from `auth.users` in SQL relies on the owner of the function having that privilege on Supabase; the route test proves it locally, production must be confirmed after deploy.

## Success Criteria (Summary)

- No OpenAI request is stored, and a test enforces it.
- No analytics traffic leaves a browser or the server before an explicit "yes".
- A deleted account is gone from Supabase Auth, the app tables and PostHog, and its credentials stop working.
- A user can download a complete JSON copy of their data.
