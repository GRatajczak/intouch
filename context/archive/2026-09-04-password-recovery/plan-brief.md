# Password Recovery — Plan Brief

> Full plan: `context/changes/password-recovery/plan.md`

## What & Why

A user who forgets their password today has no way back into their account — `/auth/signin` links only to signup, and under this app's owner-scoped RLS nobody else can reach their rows to help. This closes `S-08` on the roadmap: the recovery half of FR-001, a mandatory-login requirement that fails quietly the moment nobody can reset a forgotten password.

## Starting Point

Every auth screen follows one form-post-to-API-route pattern with no client-side Supabase SDK anywhere (`signin.astro` → `SignInForm.tsx` → `POST /api/auth/signin.ts`). `supabase/config.toml` has `[auth.email.smtp]` fully commented out (local dev uses Inbucket), and there's no existing token-exchange route — `@supabase/ssr`'s PKCE flow requires one, and this repo has never needed one before.

## Desired End State

A locked-out user clicks "Forgot your password?" on `/auth/signin`, requests a reset link, receives a branded email from a verified `get-in-touch.pl` sender, follows the link, sets a new password, and lands signed in at `/` — with every other session for that account revoked.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Sending identity | Verify `get-in-touch.pl` in Resend now | User owns the domain; closes the `onboarding@resend.dev` recipient restriction `lessons.md` already flagged, for both email paths at once | Plan (user-supplied domain) |
| Email branding | Custom `supabase/templates/recovery.html`, styled from `src/lib/email/shell.ts` | User chose brand consistency over shipping the stock Supabase template first | Plan |
| Expired/used link | Error state on `/auth/reset-password` + link back to request a new one | Keeps one page handling both the happy path and the failure, matching the existing `?error=` convention | Plan |
| Session handling on reset | `signOut({ scope: "others" })` right after `updateUser({ password })` | Closes the exact gap a forgotten-and-reset password implies (an attacker may hold the old session); verified this needs no admin/service-role client, so the cost is lower than first assumed | Plan |
| Token exchange | New `/auth/confirm` route, scoped to `type=recovery` only | `@supabase/ssr` requires PKCE; scoping avoids building a general confirmation endpoint the roadmap didn't ask for | Plan |
| Redirect URL config | No change to `additional_redirect_urls` | The reset link points directly at the app's own `/auth/confirm`, not through Supabase's hosted redirect — confirmed via Supabase's SSR docs | Plan |

## Scope

**In scope:**
- `/auth/forgot-password` request page + form + API route
- `/auth/confirm` token-exchange route (recovery only)
- `/auth/reset-password` set-new-password page + form + API route, with expired-link handling
- "Forgot your password?" link on `/auth/signin`
- Local + production Supabase Auth SMTP config pointed at Resend (reusing `RESEND_API_KEY`)
- Branded `supabase/templates/recovery.html`
- `get-in-touch.pl` domain verification in Resend

**Out of scope:**
- Password change for an already-signed-in user (`S-07`)
- Magic links, OAuth, 2FA, account lockout policy
- A general-purpose `/auth/confirm` handler for signup/magic-link/invite
- Any reminder-email content or decay logic (`F-04`/`S-04`)

## Architecture / Approach

Two new page+form+API-route triples following the existing convention exactly, plus one GET route in between that exchanges the PKCE recovery token for a session (`verifyOtp`) before handing off to the set-new-password page. Supabase Auth's own mailer (not the Worker's Resend SDK client) sends the email, routed through Resend's SMTP relay using the same `RESEND_API_KEY` already deployed for `F-04` — a different code path, same account.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Forgot-password request flow | Request page + form + API route + confirmation page | Low — direct copy of the signin/signup pattern |
| 2. Token exchange + reset-password flow | `/auth/confirm` + reset-password page/form/route, session revocation | Getting the PKCE `verifyOtp` → session → `updateUser` → `signOut(others)` sequencing right is the one genuinely new pattern in this codebase |
| 3. Signin entry point + local SMTP/template wiring | Signin link, local `config.toml` SMTP + template config, branded `recovery.html` | Go-template syntax (`{{ .SiteURL }}`, `{{ .TokenHash }}`) is unfamiliar territory next to this repo's TypeScript email shell |
| 4. Production configuration + verification | Domain verified, production SMTP/template applied, real email round-trip proven | Domain DNS propagation timing; this is a human/dashboard step this plan can't automate |

**Prerequisites:** None new — `F-03`'s token layer already styles these screens' family; `get-in-touch.pl` domain access confirmed by the user.
**Estimated effort:** ~1-2 sessions across 4 phases; Phase 4 may have real-world wait time for DNS propagation.

## Open Risks & Assumptions

- DNS propagation time for `get-in-touch.pl` verification isn't controllable from this plan — Phase 4 may need to pause and resume.
- The production Supabase project's `Site URL` is assumed already correct (used by existing signup confirmation emails); Phase 4 sanity-checks rather than re-configures it.
- `auth.rate_limit.email_sent` defaults to 2/hour locally — repeated manual testing of the request flow can silently stop sending without a visible error; worth remembering during Phase 1-3 manual verification.

## Success Criteria (Summary)

- A locked-out user can go from "forgot my password" to "signed back in" entirely through the UI, with no admin intervention.
- The reset email is real, branded, and delivered from `get-in-touch.pl` in production.
- A stale credential (old session elsewhere) doesn't survive a completed reset.
