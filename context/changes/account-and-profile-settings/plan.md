# Account and Profile Settings Implementation Plan

## Overview

`/settings` (`src/pages/settings.astro`) is a placeholder stub today — a single paragraph saying reminder settings are coming. This plan turns it into a real account-management page: a profile section linking out to the existing `/profile` editor, a password-change form, an account-email display with a full change-email flow, and a "delete my data" danger-zone action. No new tables and no migration — every piece either reuses an existing table/route or is pure Supabase Auth.

## Current State Analysis

- `/settings` (`src/pages/settings.astro:1`) renders inside `AppShell` behind `middleware.ts`'s `PROTECTED_ROUTES`, but its body is one static paragraph. It is not in `PROFILE_GATED_ROUTES`, so it's reachable even with no profile row.
- `/profile` (`src/pages/profile.astro:1`) already has everything the profile-edit half of this slice needs: `ProfileForm` (`src/components/profile/ProfileForm/ProfileForm.tsx:21`) submits via `fetch` to `POST /api/profile` (`src/pages/api/profile.ts:16`, an upsert scoped to `owner_id`) and reports success/failure through `showToast`. `/settings` links out to it rather than re-rendering the same form a second time (decided during Phase 1 — an inline embed was tried first and read as pointless duplication once built).
- Two working examples of the exact Supabase Auth calls this slice needs already exist in `password-recovery` (still `implementing`, production phase pending): `reset-password.ts` (`src/pages/api/auth/reset-password.ts:20`) calls `updateUser({ password })` then `signOut({ scope: "others" })` on the regular authenticated server client — no admin/service-role client involved. `confirm.ts` (`src/pages/auth/confirm.ts:1`) exchanges a token hash for a session via `verifyOtp({ type: "recovery", token_hash })`, reached through a custom Go-template email (`supabase/templates/recovery.html`) that hardcodes a link to `/auth/confirm` — required because `@supabase/ssr`'s PKCE flow doesn't work with Supabase's own stock-template hosted redirect.
- `supabase/config.toml:207` has `double_confirm_changes = true` — an email change requires confirming from **both** the old and the new address before it takes effect. `secure_password_change = false` (`config.toml:211`) — the project does not require Supabase-side reauthentication before `updateUser({ password })`.
- Every owner-scoped table's `owner_id` already cascades from `auth.users` (`on delete cascade`), and `people`'s deletion already cascades to `contact_events`/`ranking_entries` (established in `person-lifecycle-and-erasure`). No FK between `people`, `rankings`, and `profiles` — they're three independent leaves off `auth.users`, so deleting all three (in any order) via the normal RLS-scoped client fully erases a user's data.
- `src/components/ui/alert-dialog.tsx` already exists (added by `person-lifecycle-and-erasure`) with an established usage pattern for the one destructive, irreversible action in the app (`PersonDetailView.tsx:425-457`): a plain `Button` inside `AlertDialogFooter`, never `AlertDialogAction`, so a failed request doesn't dismiss the dialog.
- `Toaster` (`src/components/layout/Toaster/Toaster.tsx:28`) is mounted once in `Layout.astro` and supports both a `showToast()` call from client code and a `?notice=`/`?error=` query param read on mount — useful for the one flow in this slice that ends in a full-page navigation (delete-my-data → sign out → `/`).

### Key Discoveries:

- Verified against Supabase's current docs: `email_change` is a valid `verifyOtp`/email-template type, structurally identical to `recovery` — same `TokenHash`-based custom-template pattern applies, and `verifyOtp`'s error path never touches the existing session (a failed confirm leaves the user's current session untouched).
- With `double_confirm_changes = true`, Supabase sends **two** emails (to the old and new address), each with its own token hash, rendered from the **same** template file. Nothing in this plan can determine "both sides confirmed" from a single request's response — the UI shows a generic "confirmed" message per link click, and the account's displayed email simply reflects whatever `auth.getUser()` returns on the next page load.

## Desired End State

A signed-in user opens `/settings` and can, on one page inside the app shell: follow a link to re-edit their self-profile at `/profile` (name, birth date, life context, rhythm fields); see their current account email and submit a new one, receiving a branded confirmation email at both addresses before the change takes effect; change their password by providing their current password plus a new one, which also signs out every other active session; and, in a clearly separated danger zone, permanently delete every person, ranking, and profile row they own (after a modal confirmation), immediately after which they are signed out and land on `/`.

**Verification**: `npx astro check`, `npm run lint`, `npm run build` all pass. Manual walkthrough covers all four pieces against a local Supabase instance (Inbucket for both email flows), plus a production check for password change and delete-my-data.

## What We're NOT Doing

- No full account deletion (removing the Supabase Auth user itself) — that would require a service-role/admin client, which this codebase has deliberately never introduced. This slice only wipes data rows.
- No reminder-settings content on `/settings` — that's `S-04`'s half of the same page, still blocked on the cadence decision.
- No profile-editing form duplicated on `/settings` — `/profile` stays the single place the self-profile form renders (and `middleware.ts`'s first-fill redirect target); `/settings` only links to it.
- No new custom branding push for the account-email or password-recovery mailer path beyond the one template this slice adds — `password-recovery`'s production Resend wiring is a separate, already-tracked change.
- No `/settings` profile gate — a user with no profile row can still reach `/settings` directly; the embedded form just renders empty, same as a first-time `/profile` visit.
- No audit trail, undo, or grace period on "delete my data" — mirrors `person-lifecycle-and-erasure`'s stance that the one truly irreversible action stays irreversible with no residual record.

## Implementation Approach

Reuse every existing pattern exactly rather than inventing new ones: `ProfileForm`'s fetch+toast convention for all three new forms (password, email, delete), `reset-password.ts`'s `updateUser`/`signOut({scope: "others"})` pairing for password change, and `confirm.ts` + a custom Go template for the email-change token exchange, generalized to carry a second `type`. All three new API routes live under a new `src/pages/api/settings/` directory, scoped to `context.locals.user`, following `contact-events/[id].ts`'s JSON-route shape (401 with no user, parsed-body validation via a new `src/lib/validation/settings.ts`, Polish error strings). Phases are ordered by risk: the profile link-out first (zero new code paths), then password change (one route, no template work), then email change (needs the template + confirm-route generalization), then the destructive data wipe last.

## Critical Implementation Details

**Email-change template is load-bearing, not optional.** Without a custom `supabase/templates/email_change.html` mirroring `recovery.html`'s pattern (a link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/settings`), Supabase's stock template routes through its own hosted confirmation redirect, which does not produce a session `@supabase/ssr`'s PKCE-based cookie flow can pick up — the exact problem `password-recovery` already solved for `type=recovery`. Skipping this template makes the change-email flow silently unusable in this stack, not just unbranded.

**Current-password verification reuses the same request-scoped client.** Call `supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })` on the same `createClient(...)` instance already built for the request, before calling `updateUser`. A failed sign-in returns an error without mutating the existing session (confirmed against `verifyOtp`'s and `signInWithPassword`'s shared error path in `@supabase/auth-js`), so there's no risk of the verification step accidentally invalidating the caller's current session on a wrong-password attempt.

## Phase 1: Profile section on /settings

### Overview

Replace `/settings`'s placeholder card with a labeled profile section that links out to the existing `/profile` editor — no form duplication.

### Changes Required:

#### 1. Settings page profile section

**File**: `src/pages/settings.astro`

**Intent**: Add a labeled section (e.g. "Twój profil") with a short description and a link/button to `/profile`, above where the account and danger-zone sections from later phases will sit. An inline `ProfileForm` embed was tried first and reverted — seeing the identical form live in two places made the duplication obvious.

**Contract**: A `.astro`-native `<a href="/profile">` styled via `buttonVariants()` (never `<Button asChild>` in `.astro`, per `lessons.md`). No changes to `ProfileForm`, `POST /api/profile`, or `/profile` itself.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/settings` shows the profile section with a working link to `/profile`.
- `/profile` still works unchanged (first-fill redirect, pre-filled values, and save-with-toast all still function).

---

## Phase 2: Password change

### Overview

A signed-in user can change their password by providing their current password, without touching the account-email or delete-data pieces.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/settings.ts`

**Intent**: Give the new route(s) in this slice a single place to validate form input, mirroring `profile.ts`'s `schema` + `parseForm` shape.

**Contract**: Export `passwordChangeSchema` (`currentPassword`: non-empty; `newPassword`: min 6 chars, matching `ResetPasswordForm`'s existing rule; `confirmPassword`: must equal `newPassword`, enforced via `.refine()`) and a `parsePasswordChangeForm(form: FormData)` helper following `parseForm`'s pattern in `profile.ts:79-88`.

#### 2. Password-change form component

**File**: `src/components/settings/PasswordChangeForm.tsx`

**Intent**: Three fields (current, new, confirm password), client-side validation before submit, fetch-based submission with toast feedback — structurally `ProfileForm`'s submit handler (`ProfileForm.tsx:61-87`) with `ResetPasswordForm`'s field set (`ResetPasswordForm.tsx:14-121`, reusing `FormField`/`PasswordToggle`/`SubmitButton`).

**Contract**: `POST` via `fetch` to `/api/settings/password`; on success, clear the fields and `showToast("success", ...)`; on a `401`, redirect to `/auth/signin` (matching `ProfileForm.tsx:69-72`); on any other non-OK response, `showToast("error", body.error)`.

#### 3. Password-change API route

**File**: `src/pages/api/settings/password.ts`

**Intent**: Verify the caller's current password, then update it, then revoke every other session.

**Contract**: `POST` handler. `401` with no `context.locals.user`. Parse + validate via `parsePasswordChangeForm`; `400` with the first issue's message on failure. Call `supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })` on the request's `createClient(...)` instance — `400` with "Nieprawidłowe obecne hasło" on error, no further calls made. On success, `supabase.auth.updateUser({ password: newPassword })` (`500` with the Supabase error message on failure), then `supabase.auth.signOut({ scope: "others" })`, then `200` JSON success — same `authCookieHeaders` plumbing as `profile.ts:28-42`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Submitting the current password wrong shows "Nieprawidłowe obecne hasło" and the password is unchanged.
- Submitting a valid current password + a new password (with matching confirmation) succeeds, shows the success toast, and signing in again with the new password works.
- A second browser session signed in as the same user is signed out after the change completes.
- Mismatched new/confirm passwords are caught client-side before any request fires.

---

## Phase 3: Account email — view and change

### Overview

Show the account's current email and let the user request a change, confirmed on both the old and new address before it takes effect.

### Changes Required:

#### 1. Validation schema addition

**File**: `src/lib/validation/settings.ts`

**Intent**: Add the email-change half of this slice's validation to the same file Phase 2 started.

**Contract**: Export `emailChangeSchema` (`newEmail`: trimmed, valid email format) and `parseEmailChangeForm(form: FormData)`.

#### 2. Email-change form component

**File**: `src/components/settings/EmailChangeForm.tsx`

**Intent**: Display the current email (passed in as a prop from the server-rendered page) as static text, with a single-field form below it to submit a new one.

**Contract**: `POST` via `fetch` to `/api/settings/email`; same success/error/`401` handling shape as `PasswordChangeForm`, but the success toast explains that a confirmation email is on its way to both addresses (the account's email display itself does not change until both confirmations complete and the page is reloaded).

#### 3. Email-change API route

**File**: `src/pages/api/settings/email.ts`

**Intent**: Ask Supabase Auth to start the email-change process.

**Contract**: `POST` handler, same shape as `password.ts`: `401`/`400` guards, then `supabase.auth.updateUser({ email: newEmail })` — no `redirectTo` option, since the custom template (below) hardcodes the confirm link. `500` with the Supabase error message on failure, `200` JSON success otherwise.

#### 4. Email-change confirmation template

**File**: `supabase/templates/email_change.html`

**Intent**: Branded email matching `recovery.html`'s visual shell, sent to both the old and new address (Supabase renders it once per recipient with that recipient's own token hash), explaining the change and linking to confirm it.

**Contract**: Same structural shell as `recovery.html` (logo mark, card, footer), with copy naming the requested new address via `{{ .NewEmail }}` and a button linking to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/settings`.

#### 5. Config wiring

**File**: `supabase/config.toml`

**Intent**: Point Supabase Auth at the new template, mirroring the existing `[auth.email.template.recovery]` entry exactly.

**Contract**: Add `[auth.email.template.email_change]` with `subject = "Potwierdź zmianę adresu e-mail w InTouch"` and `content_path = "./supabase/templates/email_change.html"`.

#### 6. Generalize the token-exchange route

**File**: `src/pages/auth/confirm.ts`

**Intent**: Accept `type=email_change` alongside the existing `type=recovery`, each with its own default `next`.

**Contract**: Replace the current `type !== "recovery"` rejection with a check against an allowed-types set (`["recovery", "email_change"]`); keep `verifyOtp({ type, token_hash })` generic over the two (the `type` param is already typed as a Supabase `EmailOtpType`-compatible string). Default `next` stays `/auth/reset-password` for `recovery`; use `/settings` for `email_change` when no explicit `next` is present. On error, redirect to `/settings?error=...` for the `email_change` case instead of `/auth/reset-password?error=...`.

#### 7. Settings page account section

**File**: `src/pages/settings.astro`

**Intent**: Pass the signed-in user's current email (`Astro.locals.user.email`) into `EmailChangeForm`.

**Contract**: Render `<EmailChangeForm currentEmail={user.email} client:load />` in a new "Konto" section alongside the Phase 1 profile section and Phase 2's password form.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- `supabase start` picks up the `config.toml` and template changes without error

#### Manual Verification:

- `/settings` shows the current account email as static text.
- Submitting a new email produces two Inbucket emails locally (one to the old address, one to the new), both using the branded template.
- Clicking either link round-trips through `/auth/confirm` back to `/settings` without error.
- After both links are clicked, `auth.getUser()` (visible via a fresh `/settings` load) reflects the new email.
- Submitting a malformed email is caught client-side before any request fires.

---

## Phase 4: Delete my data (danger zone)

### Overview

A clearly separated, irreversible action that wipes every person, ranking, and profile row the user owns, then signs them out.

### Changes Required:

#### 1. Delete-my-data section component

**File**: `src/components/settings/DeleteDataSection.tsx`

**Intent**: A visually separated "danger zone" with one destructive button, guarded by the same `AlertDialog` confirmation pattern `PersonDetailView` already established.

**Contract**: Mirrors `PersonDetailView.tsx:425-457` exactly — `AlertDialogTrigger` wraps a `variant="destructive"` `Button`, the dialog explains the action is irreversible and names what's deleted (people, contact history, rankings, profile), and the confirm button is a plain `Button` (not `AlertDialogAction`) calling a `handleDelete` that `fetch`es `POST /api/settings/delete-data`. On success, `window.location.href = "/?notice=" + encodeURIComponent("Twoje dane zostały usunięte")` (the sign-out already happened server-side; there's no page left to toast on).

#### 2. Delete-my-data API route

**File**: `src/pages/api/settings/delete-data.ts`

**Intent**: Hard-delete every row the user owns across the three independent leaf tables, then end their session.

**Contract**: `POST` handler. `401` with no `context.locals.user`. Three scoped deletes — `.from("people").delete().eq("owner_id", user.id)`, `.from("rankings").delete().eq("owner_id", user.id)`, `.from("profiles").delete().eq("owner_id", user.id)` — each checked for an error and short-circuiting with `500` on failure before the next runs (order doesn't affect FK validity, but stopping on first failure avoids a partial, confusing wipe). On success, `supabase.auth.signOut()` (default scope — this session too, unlike Phase 2's `{scope: "others"}`), then `200` JSON success.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking the delete button shows the confirmation dialog; canceling leaves all data intact.
- Confirming deletes all people (verified via `/people` — empty), rankings, and the profile row, then lands signed-out on `/` with the success toast.
- Signing back in with the same credentials succeeds, and `/people` is empty and `/profile` behaves like a brand-new account (no pre-fill).
- A `DELETE`-equivalent request against another user's data (via a second test account) never touches the first account's rows — confirms the `.eq("owner_id", ...)` scoping holds even without a differently-shaped RLS policy change.

---

## Testing Strategy

### Unit Tests:

- No test framework exists in this repo (established precedent in `person-lifecycle-and-erasure`); verification is manual + the existing `astro check`/lint/build gates.

### Integration Tests:

- None beyond the manual walkthroughs per phase above — this project has no integration test harness yet (see `context/foundation/test-plan.md` once it exists).

### Manual Testing Steps:

1. Full walkthrough in order: edit profile on `/settings` → change password → sign back in with the new password → change email → confirm both links → delete all data → confirm signed-out landing on `/` → sign back in to an empty account.
2. Edge case: attempt a password change with an incorrect current password, then immediately retry with the correct one — confirms the failed attempt didn't corrupt the session.
3. Edge case: start an email change, then delete-my-data before confirming either link — confirms the pending Supabase-side email-change request doesn't block or error the data wipe (they're independent Supabase Auth vs. Postgres-table operations).

## Performance Considerations

None — every operation here is a single-row or small-row-count write scoped to one owner; no new indexes or query patterns are introduced.

## Migration Notes

No schema migration in this slice. All three new API routes operate on existing tables (`people`, `rankings`, `profiles`) with their existing RLS policies unchanged.

## References

- Related roadmap slice: `context/foundation/roadmap.md` (S-07)
- Password/session pattern reused from: `context/changes/password-recovery/plan.md`, `src/pages/api/auth/reset-password.ts:20`
- Delete-confirmation pattern reused from: `context/changes/person-lifecycle-and-erasure/plan.md`, `src/components/people/PersonDetailView/PersonDetailView.tsx:425-457`
- Profile form reused as-is: `src/components/profile/ProfileForm/ProfileForm.tsx`, `src/pages/api/profile.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Profile section on /settings

#### Automated

- [x] 1.1 Type checking passes: `npx astro check`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Build succeeds: `npm run build`

#### Manual

- [ ] 1.4 `/settings` shows the profile section with a working link to `/profile`
- [ ] 1.5 `/profile` still works unchanged

### Phase 2: Password change

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build succeeds: `npm run build`

#### Manual

- [ ] 2.4 Wrong current password shows the error and nothing changes
- [ ] 2.5 Valid change succeeds and signing in with the new password works
- [ ] 2.6 A second active session is signed out after the change
- [ ] 2.7 Mismatched new/confirm passwords are caught client-side

### Phase 3: Account email — view and change

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`
- [ ] 3.4 `supabase start` picks up config/template changes without error

#### Manual

- [ ] 3.5 `/settings` shows the current account email
- [ ] 3.6 Submitting a new email produces two branded Inbucket emails
- [ ] 3.7 Both confirm links round-trip through `/auth/confirm` back to `/settings`
- [ ] 3.8 After both confirmations, the displayed email reflects the change
- [ ] 3.9 Malformed email is caught client-side

### Phase 4: Delete my data (danger zone)

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build succeeds: `npm run build`

#### Manual

- [ ] 4.4 Confirmation dialog appears; canceling leaves data intact
- [ ] 4.5 Confirming wipes people/rankings/profile and signs out to `/`
- [ ] 4.6 Signing back in behaves like a brand-new account
- [ ] 4.7 A second account's data is unaffected
