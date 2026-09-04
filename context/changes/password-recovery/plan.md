# Password Recovery Implementation Plan

## Overview

A user who forgets their password today has no way back into their account — `/auth/signin` links only to signup, and under `F-01`'s owner-scoped RLS nobody else can reach their rows to help. This plan adds the forgot/reset-password flow: a request page that emails a reset link through Supabase Auth, a token-exchange route, and a set-new-password page that lands the user back in the app signed in, with every other session revoked.

## Current State Analysis

- Every auth screen in this repo follows one pattern with no exceptions: an `.astro` page renders a React form island (`client:load`), the form does a native `method="POST"` to a matching `src/pages/api/auth/*.ts` route, the route calls the server-side Supabase client (`src/lib/supabase.ts`'s `createClient`), and redirects — success to a destination page, failure back to the same page with `?error=` (`src/pages/auth/signin.astro` + `src/pages/api/auth/signin.ts` + `src/components/auth/SignInForm.tsx`). There is no client-side Supabase SDK usage anywhere in the codebase.
- Shared building blocks already exist and are reused as-is: `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError` (`src/components/auth/`). `SignUpForm.tsx` already implements the exact password + confirm-password validation (min 6 chars, match check) this plan's reset form needs.
- `middleware.ts`'s `PROTECTED_ROUTES` (`/dashboard`, `/profile`, `/people`, `/settings`) doesn't include `/auth/*`, so every page and route this plan adds is reachable unauthenticated, by design.
- `supabase/config.toml` has `[auth.email.smtp]` fully commented out — local dev falls back to Inbucket (port 54324). `auth.email.confirmations` is `false` locally, and there is no existing token-exchange route (`verifyOtp`/`exchangeCodeForSession`) anywhere in the codebase — `confirm-email.astro` is a static "check your inbox" message page, not a handler.
- `src/lib/email/shell.ts` (from `F-04`) builds the Worker's cron-triggered email HTML in TypeScript — a different code path (Resend SDK from the Worker) than Supabase Auth's own mailer, which renders Go-template HTML files referenced from `config.toml`. Nothing here is reused as code; its color palette and layout are reused as a visual reference for the new template.
- `RESEND_API_KEY` already exists as a secret in all three locations (`.dev.vars`, Workers Secrets, GitHub Secrets) for `F-04`. Resend's SMTP relay (`smtp.resend.com`, username `resend`, password = the API key) authenticates with the same key — no new secret to create, only a new place it's consumed (Supabase Auth's SMTP config instead of the Resend SDK).
- `lessons.md` already documents that `onboarding@resend.dev` (F-04's current sender) can only deliver to the Resend account owner's own inbox, and flags a real sending domain as a gap to close before a second real user exists.

## Desired End State

A user who forgot their password can:
1. Open `/auth/signin`, click "Forgot your password?", land on `/auth/forgot-password`, and submit their email.
2. Receive a branded email (sent via Resend through a verified `get-in-touch.pl` domain) with a reset link, regardless of whether the address matches an account (no enumeration signal).
3. Click the link, which exchanges the token for a session server-side and lands them on `/auth/reset-password`.
4. Submit a new password (with confirmation) and land signed in at `/`, with every other session for that account revoked.

An expired or already-used link instead shows an error on `/auth/reset-password` with a way back to request a new one.

**Verification**: production end-to-end — request a reset for a real inbox, receive the branded email from the `get-in-touch.pl` sender, follow the link, set a new password, confirm the app treats the user as signed in, and confirm a second, previously-open session is signed out.

### Key Discoveries:

- `auth.signOut({ scope: "others" })` works on the regular authenticated client — it does not require a service-role/admin client. Verified against `@supabase/auth-js`'s own reference and Supabase Studio's own set-password mutation, which calls exactly this after `updateUser({ password })`. This removes what looked like a new privilege surface during questioning — there is none.
- `@supabase/ssr` requires the PKCE flow: the reset link cannot drop a user into an authenticated session by itself. Supabase's own recommended pattern for SSR frameworks is a custom email template whose link points directly at the app's own route (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password`), which the app then exchanges server-side via `verifyOtp({ type: "recovery", token_hash })`. This is a direct link to the app, not a round-trip through Supabase's own hosted redirect — so nothing needs adding to `additional_redirect_urls` for this flow.
- Resend's SMTP relay reuses `RESEND_API_KEY` as the SMTP password (username is the literal string `resend`) — confirmed via Resend's docs.

## What We're NOT Doing

- No magic links, OAuth providers, 2FA, or account lockout policy.
- No password change for an already-signed-in user — that's `S-07`'s scope, a different screen for a user who can already get in.
- No general-purpose confirmation endpoint. `/auth/confirm` only handles `type=recovery`; any other `type` value gets a safe fallback redirect to `/auth/signin`, not new handling for signup/magic-link/invite confirmation.
- No changes to `additional_redirect_urls`, `secure_password_change`, or any other unrelated `[auth]` setting in `config.toml`.
- No reminder-email content, decay logic, or ranking data — unrelated to this slice (`F-04`/`S-04`'s scope).
- No admin/service-role Supabase client — the `scope: "others"` sign-out works on the existing authenticated server client.

## Implementation Approach

Follow the existing form-post-to-API-route convention exactly, adding two new page+form+route triples (request, and set-new-password) and one token-exchange route in between. Wire Supabase Auth's mailer to Resend's SMTP relay (reusing the existing `RESEND_API_KEY`) both locally (`config.toml`, verified against Inbucket) and in production (Supabase Dashboard/Management API — a human step, matching how this repo already treats production secrets). Author a custom-branded Go-template recovery email that visually matches `src/lib/email/shell.ts`'s chrome, since Supabase Auth templates are a separate rendering path from the Worker's TypeScript email builder.

## Phase 1: Forgot-password request flow

### Overview

The entry point: a page where a locked-out user enters their email, and the API route that asks Supabase Auth to send a reset email — without revealing whether the address has an account.

### Changes Required:

#### 1. Forgot-password form component

**File**: `src/components/auth/ForgotPasswordForm.tsx`

**Intent**: A single-field form (email) that validates client-side before submit, matching `SignInForm.tsx`'s structure (same email regex, same `FormField`/`ServerError`/`SubmitButton` composition) but with a submit-pending label appropriate to "sending a link" rather than "signing in."

**Contract**: `<form method="POST" action="/api/auth/forgot-password">`, one `email` field, a `serverError?: string | null` prop rendered through `ServerError`.

#### 2. Forgot-password request page

**File**: `src/pages/auth/forgot-password.astro`

**Intent**: Mirrors `signin.astro`'s card layout (`Layout` + `Logo` + card), rendering `ForgotPasswordForm` and reading `?error=` from the URL the same way `signin.astro` does. Links back to `/auth/signin`.

**Contract**: Same `Layout`/card markup shape as `signin.astro`; title "Zapomniałeś hasła?" or equivalent.

#### 3. Forgot-password API route

**File**: `src/pages/api/auth/forgot-password.ts`

**Intent**: Reads `email` from the posted form, calls `supabase.auth.resetPasswordForEmail(email)` (no `redirectTo` needed — the custom recovery template hardcodes the `/auth/confirm` link, see Phase 3), and redirects to the confirmation page on success. On a genuine Supabase error (not "account doesn't exist" — `resetPasswordForEmail` never signals that), redirect back to `/auth/forgot-password?error=...`, matching `signin.ts`'s error-redirect shape.

**Contract**: `POST` handler, same `createClient` + `authCookieHeaders` scaffolding as `signin.ts`/`signup.ts`. Redirects to `/auth/forgot-password-sent` on success.

#### 4. Confirmation page

**File**: `src/pages/auth/forgot-password-sent.astro`

**Intent**: A static "check your inbox" message, structurally identical to `confirm-email.astro` (same card, emoji, heading/description/link-back shape) — no `DEV`-vs-production branch needed here since this message is accurate in both environments (the email either arrives or doesn't; there's no local auto-confirm equivalent for password reset).

**Contract**: Links back to `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Submitting a known account's email on `/auth/forgot-password` redirects to `/auth/forgot-password-sent`, and a reset email appears in local Inbucket (`http://127.0.0.1:54324`)
- Submitting an email with no matching account shows the exact same success page (no enumeration signal)
- Submitting a malformed email is caught client-side before any request fires

---

## Phase 2: Token exchange + reset-password flow

### Overview

The reset link's landing sequence: exchange the recovery token for a session, then let the user set a new password, revoking every other session for that account in the process.

### Changes Required:

#### 1. Token-exchange route

**File**: `src/pages/auth/confirm.ts`

**Intent**: Handles `GET /auth/confirm?token_hash=...&type=...&next=...`. For `type=recovery`, calls `supabase.auth.verifyOtp({ type: "recovery", token_hash })` using the same cookie-writing server client pattern as the POST routes (`authCookieHeaders` copied onto the redirect response), then redirects to `next` (`/auth/reset-password`) on success. Any other `type`, a missing `token_hash`, or a `verifyOtp` error redirects to `/auth/reset-password?error=...` — the expired/used-link path Phase 2's item 3 renders (never to `/auth/signin`, since the user is specifically trying to recover a password, not sign in with one they don't have).

**Contract**: `GET` handler, `export const GET: APIRoute = async (context) => { ... }`.

#### 2. Reset-password form component

**File**: `src/components/auth/ResetPasswordForm.tsx`

**Intent**: Password + confirm-password fields with the same validation as `SignUpForm.tsx` (`MIN_PASSWORD_LENGTH = 6`, match check, character-count hint) — no email field, since the user is already identified by their recovery session.

**Contract**: `<form method="POST" action="/api/auth/reset-password">`, `password` + `confirmPassword` fields, `serverError?: string | null` prop.

#### 3. Reset-password page

**File**: `src/pages/auth/reset-password.astro`

**Intent**: Same card layout as `signin.astro`. Reads `?error=` from the URL; when present, renders the error via `ServerError` above the form along with a "Request a new link" link back to `/auth/forgot-password` (the expired/used-link UX decided during questioning) — the form itself still renders underneath so a partial-typing user isn't dead-ended, but submission will fail at the API route if the session never got established.

**Contract**: Renders `ResetPasswordForm`; the error link's `href` is `/auth/forgot-password`.

#### 4. Reset-password API route

**File**: `src/pages/api/auth/reset-password.ts`

**Intent**: Guards on `context.locals.user` being present (set by `middleware.ts` from the recovery-session cookies `confirm.ts` wrote) — a null user means the link was never validly exchanged (direct navigation, or the session already expired), and redirects to `/auth/reset-password?error=...`, the same expired-link path. Otherwise calls `supabase.auth.updateUser({ password })`, then `supabase.auth.signOut({ scope: "others" })`, then redirects to `/` — the current session's cookies are untouched by an `"others"`-scoped sign-out, so no session refresh step is needed (unlike Supabase Studio's browser-client pattern, which refreshes a long-lived client-side session object this server-rendered app doesn't have).

**Contract**: `POST` handler, same `createClient` + `authCookieHeaders` scaffolding as the other auth API routes. Redirects to `/` on success.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Following a real reset link (from Inbucket) lands on `/auth/reset-password` with no error shown
- Setting a new password (with matching confirmation) redirects to `/` signed in as that user
- Re-visiting the same reset link a second time (or an intentionally expired one) shows the error state on `/auth/reset-password` with a working "request a new link" path
- Navigating directly to `/auth/reset-password` and submitting without ever following a link produces the same expired-link error, not a crash
- With two active sessions for one account (e.g. two browsers signed in), completing a reset in one signs the other one out on its next request

---

## Phase 3: Signin entry point + local SMTP/template wiring

### Overview

Wire the pieces so this flow is reachable and its email is real: a link on the signin screen, Supabase Auth's local mailer pointed at Resend's SMTP relay, and a branded recovery email template.

### Changes Required:

#### 1. Signin page link

**File**: `src/pages/auth/signin.astro`

**Intent**: Add a "Forgot your password?" link near the password field or below the form, pointing to `/auth/forgot-password` — the exact gap the roadmap calls out ("the signin screen actually offers the route out; today it links only to signup").

**Contract**: One `<a href="/auth/forgot-password">` styled consistently with the existing "Nie masz konta?" link below the form.

#### 2. Local SMTP configuration

**File**: `supabase/config.toml`

**Intent**: Uncomment and fill in `[auth.email.smtp]` to route Supabase Auth's mailer through Resend locally, so `/auth/forgot-password` can be tested end-to-end against a real relay (still landing in local Inbucket, since Resend's test sender restrictions don't affect local capture) rather than only Supabase's built-in mailer.

**Contract**:
```toml
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 587
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "no-reply@get-in-touch.pl"
sender_name = "InTouch"
```

#### 3. Recovery email template config

**File**: `supabase/config.toml`

**Intent**: Point the `recovery` template type at a new local HTML file, matching the existing commented-out `invite` example's shape.

**Contract**:
```toml
[auth.email.template.recovery]
subject = "Zresetuj hasło do InTouch"
content_path = "./supabase/templates/recovery.html"
```

#### 4. Branded recovery email template

**File**: `supabase/templates/recovery.html`

**Intent**: A Go-template HTML email styled from `src/lib/email/shell.ts`'s chrome (same color palette, logo mark, wordmark, footer band) with body copy explaining the reset request and a button/link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password` — the PKCE-flow link shape Supabase's own SSR guidance recommends, hardcoded here rather than sourced from `resetPasswordForEmail`'s `redirectTo` option.

**Contract**: Must reference `{{ .SiteURL }}` and `{{ .TokenHash }}` exactly (Supabase's template variable names); the `next` query param is a literal `/auth/reset-password`, not a template variable.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Build succeeds: `npm run build`
- `supabase start` (or restart) picks up `config.toml` changes without error

#### Manual Verification:

- `/auth/signin` shows the new "Forgot your password?" link and it navigates to `/auth/forgot-password`
- A local reset request produces an Inbucket email using the new branded template, not Supabase's stock template, and the link in it correctly round-trips through `/auth/confirm` to `/auth/reset-password`

---

## Phase 4: Production configuration + verification

### Overview

Everything Phase 1-3 built is inert in production until Resend has a verified sending domain and Supabase's hosted Auth project is pointed at it — both credential/domain operations this repo already treats as human steps, not agent-automated ones.

### Changes Required:

#### 1. Resend domain verification

**Human step, not delegated**: verify `get-in-touch.pl` in the Resend dashboard (add the DKIM/SPF/DMARC DNS records it provides at the domain's registrar), and confirm the domain shows "Verified" before continuing — matching this repo's posture that production secret/identity setup is a human operation (`CLAUDE.md`).

#### 2. Production Supabase SMTP + template config

**Human step, not delegated**: apply the same `[auth.email.smtp]` values from Phase 3 (host `smtp.resend.com`, user `resend`, password = the production `RESEND_API_KEY`, sender `no-reply@get-in-touch.pl`) and the `recovery` template content to the hosted Supabase project — via the Supabase Dashboard's Auth settings, or `supabase config push` if the linked project supports it. This is the same "production secrets are a human operation" rule `F-04`'s plan already applied to `wrangler secret put`.

#### 3. Sanity check: production Site URL

**Intent**: Confirm the hosted Supabase project's configured `Site URL` matches `https://intouch.g-ratajczak97.workers.dev` — the value `{{ .SiteURL }}` resolves to inside the recovery template. This isn't a new setting this slice introduces; it's a pre-existing requirement for any Supabase Auth email link to work at all, worth a one-time check since this is the first slice whose email actually depends on it pointing at the app rather than Supabase's own hosted pages.

### Success Criteria:

#### Automated Verification:

- Build succeeds: `npm run build`

#### Manual Verification:

- Resend dashboard shows `get-in-touch.pl` as a verified domain
- Requesting a password reset against the deployed production Worker delivers a real email from `no-reply@get-in-touch.pl`, styled with the branded template, to a real inbox
- Following that link end-to-end sets a new password and lands the user signed in on the production app
- A second session open for the same account (production) gets signed out after the reset completes

---

## Testing Strategy

### Unit Tests:

- None planned — this repo has no existing unit-test harness for the auth API routes (`signin.ts`/`signup.ts` have none either); consistent with the codebase's current testing posture for this layer.

### Integration Tests:

- None planned, for the same reason.

### Manual Testing Steps:

1. Local: request a reset for a real local account, follow the Inbucket link, set a new password, confirm signed-in landing at `/`.
2. Local: attempt the same reset link twice; confirm the second attempt shows the expired-link error with a working "request a new link" path.
3. Local: with two browser sessions signed in as the same account, complete a reset in one and confirm the other is signed out on its next navigation.
4. Production: full real-email round trip as described in Phase 4's Manual Verification.

## Performance Considerations

None — this is low-volume, request-driven auth traffic with no new tables, no ranking, and no batch operations.

## Migration Notes

No schema changes. `supabase/config.toml` and `supabase/templates/recovery.html` are new/edited config and template files, not data migrations.

## References

- Roadmap: `context/foundation/roadmap.md` (S-08)
- Sibling pattern: `src/pages/auth/signin.astro`, `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`
- Password validation to reuse: `src/components/auth/SignUpForm.tsx`
- Email visual reference (not reused as code): `src/lib/email/shell.ts`
- Sending-identity precedent: `context/archive/2026-09-02-resend-email-delivery-path/plan.md` (F-04)
- `lessons.md`: "Resend's onboarding@resend.dev sender is a placeholder, not final config"; `<Button asChild>` unstyled-link gotcha

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Forgot-password request flow

#### Automated

- [x] 1.1 Type check passes: `npx astro check` — 16d16f6
- [x] 1.2 Lint passes: `npm run lint` — 16d16f6
- [x] 1.3 Build succeeds: `npm run build` — 16d16f6

#### Manual

- [x] 1.4 Submitting a known account's email redirects to `/auth/forgot-password-sent` and produces an Inbucket email — 16d16f6
- [x] 1.5 Submitting an unknown email shows the same success page (no enumeration signal) — 16d16f6
- [x] 1.6 Malformed email is caught client-side — 16d16f6

### Phase 2: Token exchange + reset-password flow

#### Automated

- [x] 2.1 Type check passes: `npx astro check`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Build succeeds: `npm run build`

#### Manual

- [x] 2.4 Real reset link lands on `/auth/reset-password` with no error
- [x] 2.5 Setting a new password redirects to `/` signed in
- [x] 2.6 Reusing/expiring a link shows the error state with a working "request a new link" path
- [x] 2.7 Direct navigation to `/auth/reset-password` without a token produces the expired-link error, not a crash
- [x] 2.8 Completing a reset in one session signs out a second active session for the same account

### Phase 3: Signin entry point + local SMTP/template wiring

#### Automated

- [ ] 3.1 Type check passes: `npx astro check`
- [ ] 3.2 Build succeeds: `npm run build`
- [ ] 3.3 `supabase start` picks up `config.toml` changes without error

#### Manual

- [ ] 3.4 "Forgot your password?" link appears on `/auth/signin` and navigates correctly
- [ ] 3.5 Local reset email uses the branded template and its link round-trips through `/auth/confirm` to `/auth/reset-password`

### Phase 4: Production configuration + verification

#### Automated

- [ ] 4.1 Build succeeds: `npm run build`

#### Manual

- [ ] 4.2 `get-in-touch.pl` verified in Resend
- [ ] 4.3 Production reset email delivered from `no-reply@get-in-touch.pl` with the branded template
- [ ] 4.4 End-to-end production reset sets a new password and lands signed in
- [ ] 4.5 A second production session is signed out after the reset
