---
change_id: password-recovery
title: Forgot-password reset flow from the signin screen
status: implementing
created: 2026-09-04
updated: 2026-09-04
archived_at: null
---

## Notes

@context/foundation/roadmap.md (S-08)

Roadmap slice `S-08`. PRD `FR-001`'s recovery half — a mandatory login with no
recovery path converts one forgotten password into a permanently lost circle
of people.

Decisions taken in the planning session (2026-09-04):

- **Sending identity**: verify a real domain (`get-in-touch.pl`) in Resend now,
  rather than reusing F-04's `onboarding@resend.dev` test sender. Chosen over
  the lower-effort test-sender option because the test sender can only deliver
  to the Resend account owner's own inbox, and closes the gap `lessons.md`
  already flagged for F-04 at the same time, for both email paths.
- **Email branding**: a custom-branded `supabase/templates/recovery.html`
  (Go template), styled from `src/lib/email/shell.ts`'s visual language,
  rather than Supabase's stock recovery template.
- **Expired/used reset link**: lands on `/auth/reset-password` with an error
  state and a link back to `/auth/forgot-password`, rather than redirecting
  straight back to the request form.
- **Session handling on reset**: calls `supabase.auth.signOut({ scope: "others" })`
  right after `updateUser({ password })`, revoking every other session. Cheaper
  than initially assumed — verified via research that this works on the
  regular authenticated server client, no service-role/admin client needed
  (mirrors Supabase Studio's own set-password implementation).
- **Token exchange**: `@supabase/ssr` requires the PKCE flow, so a
  `/auth/confirm` route handles `verifyOtp({ type: "recovery" })` before the
  user reaches the set-new-password page — scoped to `type=recovery` only,
  not built as a general-purpose confirmation endpoint for signup/magic-link/
  invite (those stay out of scope per the roadmap's cap).
