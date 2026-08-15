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
