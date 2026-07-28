---
starter_id: 10x-astro-starter
package_manager: npm
project_name: intouch
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
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
