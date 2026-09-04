---
change_id: account-and-profile-settings
title: Editable profile + account settings on the /settings page
status: archived
created: 2026-09-04
updated: 2026-09-04
archived_at: 2026-09-04T20:46:27Z
---

## Notes

@context/foundation/roadmap.md (S-07)

Roadmap slice `S-07`. PRD `FR-001`'s post-signup half (an account the user
can create and sign in to is also an account they must be able to maintain),
`FR-002` (the self-profile form exists but is a one-way trip today), `FR-008`
(the user must be able to see the address FR-008 reminders land on).

Decisions taken in the planning session (2026-09-04):

- **Profile edit location**: `/settings` links out to `/profile` rather than
  embedding `ProfileForm` inline. Originally planned as an inline embed, but
  reconsidered during Phase 1 implementation (2026-09-04) once built and seen
  live — showing the identical form in two places read as pointless
  duplication. `/profile` stays the single place the form renders; `/settings`
  shows a short description and an "Edytuj profil" link/button.
- **Account email**: build the full change-email flow (not read-only),
  proceeding now on whichever mailer is currently configured rather than
  blocking on `password-recovery`'s still-`implementing` production Resend
  wiring — accepted as a known, named gap for a single-user MVP.
- **Account deletion**: "delete my data", not "delete my account" — hard-
  deletes all owned rows (`people`, `rankings`, `profiles`; cascades clear
  `contact_events`/`ranking_entries`) via the existing RLS-scoped client, but
  leaves the Supabase Auth user/login intact. No service-role key introduced
  — that would be the first admin/privileged client in this codebase, and the
  scope cap deliberately avoids it. After completion, sign the user out and
  redirect to `/`.
- **Password change**: requires the current password (verified via
  `signInWithPassword`) before calling `updateUser({ password })`, then signs
  out every other session (`signOut({ scope: "others" })`), mirroring
  `reset-password.ts`'s existing behavior.
- **`/settings` route gate**: left ungated (not added to
  `PROFILE_GATED_ROUTES`) — a user with no profile row can still reach it
  directly; the inline form just renders empty.
