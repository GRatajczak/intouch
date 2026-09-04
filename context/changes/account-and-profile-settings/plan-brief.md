# Account and Profile Settings — Plan Brief

> Full plan: `context/changes/account-and-profile-settings/plan.md`

## What & Why

`/settings` (roadmap `S-07`) turns from a placeholder stub into a real account-management page: re-edit the self-profile after its first save, see and change the account email, change the password, and permanently wipe all owned data. Without this, a mistyped or hastily-filled profile has no way back — which shows up as bad AI ranking suggestions, not a visible bug — and the account itself has no maintenance surface at all.

## Starting Point

`/settings` today (`src/pages/settings.astro`) is one static paragraph inside the app shell. Everything this slice needs already has a proven pattern elsewhere in the codebase: `ProfileForm` + `POST /api/profile` (from `S-01`) does the profile save already; `reset-password.ts` (from `password-recovery`, still in progress) shows the exact `updateUser`/`signOut` calls password change needs; `person-lifecycle-and-erasure`'s `AlertDialog` shows the confirmation pattern for the one destructive action here.

## Desired End State

A signed-in user opens `/settings` and, on one page: follows a link to edit their profile at `/profile` (unchanged, same save-and-toast behavior it already has); sees their account email and can request a change (confirmed by email on both the old and new address before it takes effect); changes their password by providing the current one, which also signs out every other active session; and, in a separated danger zone, permanently deletes all their people/rankings/profile data — after which they're signed out to `/` with their login still intact for a fresh start.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Profile edit location | `/settings` links out to `/profile`; no embed | Tried as an inline `ProfileForm` embed first, but reverted once built — the identical form live in two places was pointless duplication | Plan (revised during Phase 1 implementation) |
| Account email | Build the full change-email flow, not read-only | Proceeds now on whatever mailer is configured rather than blocking on `password-recovery`'s unfinished production wiring | Plan |
| Account deletion scope | "Delete my data" (wipe rows), not full account removal | Avoids introducing this codebase's first service-role/admin Supabase client for a single-user MVP | Plan |
| Password change | Require current password, verified via `signInWithPassword` | A settings-page password change has no email-ownership proof behind it, unlike the forgot-password link | Plan |
| Post-change sessions | Sign out all other sessions after a password change | Matches `reset-password.ts`'s existing security behavior exactly | Plan |
| `/settings` route gate | Left ungated (not added to `PROFILE_GATED_ROUTES`) | Keeps the existing invariant that only `/people` is profile-gated; the form just renders empty for a first-time visitor | Plan |
| Post-delete flow | Sign out fully and land on `/` | An irreversible, total data wipe reads as final — no ambiguous signed-in-but-empty state | Plan |

## Scope

**In scope:**
- Profile section on `/settings` linking out to the existing `/profile` editor
- Account email display + full change-email flow (double confirmation)
- Password change with current-password verification and other-session sign-out
- "Delete my data" danger zone (people, rankings, profile — not the login itself)

**Out of scope:**
- Full account/login deletion (would need a new service-role client)
- Reminder-settings content on the same page (`S-04`, still blocked)
- Retiring `/profile` or gating `/settings` behind having a profile
- New production mailer work (rides whatever `password-recovery` leaves configured)

## Architecture / Approach

Every new piece copies an existing, proven pattern rather than inventing one: the profile section links to `/profile` rather than duplicating its form; password change copies `reset-password.ts`'s `updateUser` + `signOut({scope:"others"})` pairing behind a new current-password check; email change generalizes the `/auth/confirm` token-exchange route (already built for password recovery) to a second `type=email_change`, backed by a new branded Go template; data deletion reuses `person-lifecycle-and-erasure`'s `AlertDialog` confirmation pattern and its already-proven cascade behavior, scoped by `owner_id` with no new privileged client. Three new API routes live under `src/pages/api/settings/`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Profile section on /settings | Link out to the existing `/profile` editor | None — pure reuse |
| 2. Password change | Current-password-gated password change, other sessions signed out | Getting the reauth check right without a service-role client |
| 3. Account email — view & change | Read + change email, dual-confirmation flow | Missing the custom email template breaks the flow silently (PKCE/session mismatch) |
| 4. Delete my data | Danger-zone action wiping people/rankings/profile, then sign-out | Partial wipe if one delete fails mid-sequence |

**Prerequisites:** `S-01` (profile + `profiles` table) and `F-05` (app shell, `/settings` route) — both already done.
**Estimated effort:** ~2 sessions across 4 phases; Phase 3 is the largest single unit of new work.

## Open Risks & Assumptions

- Email-change confirmations currently ride whichever mailer is configured today (Supabase's own default), since `password-recovery`'s production Resend wiring isn't finished — a known, accepted gap for a single-user MVP, not a blocker.
- "Delete my data" leaves the Supabase Auth login intact by design; if a future slice needs true account closure, it will need to introduce a service-role client this plan deliberately avoids.

## Success Criteria (Summary)

- A user can correct a mistake in their profile any time after first save, without losing the AI ranking's data quality.
- A user can recover from a compromised or forgotten-in-place password without contacting anyone.
- A user can see their reminder-delivery address and fix a typo in it themselves.
- A user who wants out can wipe everything and start clean without asking for manual intervention.
