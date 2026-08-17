---
starter_id: 10x-astro-starter
package_manager: npm
project_name: intouch
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
---

## Why this stack

InTouch is a solo, after-hours web-app MVP on a 3-week budget whose core is an
AI-ranked contact hierarchy over private, per-user data about third parties. That
combination — auth for sensitive data (FR-001), a Postgres store, and AI-friendly
explicit types for the ranking logic — is exactly what the 10x Astro Starter
(Astro + React + TypeScript + Supabase + Cloudflare) delivers out of the box, and
it is the recommended default for the `(web, js)` cell. It clears all four
agent-friendly gates (typed, convention-based, popular in training, well
documented), which matters because the hierarchy and feedback-loop code will be
largely agent-written. Bootstrapper confidence is first-class. Auth and AI flags
are set; payments and realtime are out of scope per Non-Goals. The one seam to
watch is background work — scheduled reminders (FR-008) and non-blocking AI
generation must run off a queue or external worker, since Cloudflare's edge
runtime constrains long-running tasks. CI runs on GitHub Actions with
auto-deploy-on-merge, the starter's default shape.

## UI layer

The starter ships with **shadcn/ui** (`components.json`, style `new-york`,
`baseColor: neutral`) on top of **Tailwind CSS v4** and **React 19**
(`@astrojs/react`). Component primitives come from **Radix UI**
(`@radix-ui/react-slot`, ...), variant styling from
**class-variance-authority** + **clsx** + **tailwind-merge**, and icons from
**lucide-react** (`iconLibrary: "lucide"` in `components.json`). Path aliases
(`@/components`, `@/components/ui`, `@/lib`, `@/hooks`) are already wired.

Practical consequence: new UI work should add components via `npx shadcn add
<component>` into `src/components/ui/` rather than hand-rolling primitives or
introducing a second component library (e.g. MUI, Chakra, Ant Design) —
`src/components/ui/button.tsx` is the existing reference pattern to follow.

## External services

Three third-party services the app calls out to, none of them interchangeable
with another:

| Service      | Role                                            | Secret            | Status                    |
| ------------ | ----------------------------------------------- | ----------------- | ------------------------- |
| **Supabase** | Postgres + auth (FR-001), row-level isolation   | `SUPABASE_KEY`    | wired (`src/lib/supabase.ts`) |
| **OpenAI**   | Ranking the contact hierarchy (FR-007)          | (not yet bound)   | decided, unwired — roadmap `F-02` |
| **Resend**   | Transactional email for reminders (FR-008)      | `RESEND_API_KEY`  | decided, unwired — roadmap `F-04` |

### Resend (email)

Reminders are email, and email on Cloudflare Workers has one hard constraint
that decides the whole category: **workerd has no raw TCP sockets, so SMTP is
not an option**. Nodemailer and every `smtp://`-based approach are out — not
"discouraged", impossible. The provider must expose an HTTPS API, which is what
narrows the field to Resend / Postmark / SendGrid / Mailgun rather than a
mail library.

Resend is chosen against the same four agent-friendly gates as the rest of the
stack: a typed first-party SDK (`resend` on npm) that works over `fetch` and
therefore runs unmodified on the edge runtime; documentation an agent can follow
without version drift; and a free tier (3k emails/month, 100/day) that sits far
above this product's ceiling of one email per user per day (see the once-per-day
NFR). The cost of being wrong is also low: the send is one HTTPS call behind a
thin module, so swapping providers later touches one file, not the reminder
logic.

Practical consequences:

- `RESEND_API_KEY` reaches code **only** through `astro:env/server`, exactly like
  `SUPABASE_KEY` — never `process.env`, never `Astro.locals.runtime` (see
  `CLAUDE.md` and `context/foundation/lessons.md`). Concretely that means an
  `envField.string({ context: "server", access: "secret" })` entry in
  `astro.config.mjs`'s `env.schema` next to the two `SUPABASE_*` keys, plus the
  secret present in all three locations: `.dev.vars`, Workers Secrets, GitHub
  Secrets.
- Sending is server-side only — an API route or the scheduled handler. The key
  never reaches a React component or any `client:*` island.
- Do not add a second email provider or a mail library alongside it.
- Sending requires a verified sending identity; that is the longest-lead item in
  the whole roadmap because it waits on DNS rather than on code. See roadmap
  Open Question 4.

### Two email paths, deliberately separate

Auth emails already work and **do not go through Resend**. `supabase.auth.signUp`
(`src/pages/api/auth/signup.ts`) triggers Supabase's own built-in mailer, which
is why `/auth/confirm-email` works today with no email provider configured
anywhere — `[auth.email.smtp]` is commented out in `supabase/config.toml`.

So the app has two independent email paths: Supabase's mailer for auth, Resend
for reminders. Keep them separate for the MVP; do not "unify" them while
building `F-04`. Worth knowing for later, though: Supabase's built-in mailer is
rate-limited and documented as being for testing rather than production
(`config.toml` sets `email_sent = 2` per hour locally). If auth emails start
getting throttled or landing in spam, the fix is pointing `[auth.email.smtp]` at
Resend's SMTP credentials — consolidating on one sender at that point, for that
reason, rather than pre-emptively.
