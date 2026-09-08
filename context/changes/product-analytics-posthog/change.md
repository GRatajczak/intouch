---
change_id: product-analytics-posthog
title: PostHog product analytics for the primary success funnel
status: implementing
created: 2026-09-04
updated: 2026-09-08
archived_at: null
---

## Notes

@context/foundation/roadmap.md

Roadmap foundation `F-06`. Opened directly by `/10x-research` (no separate
`/10x-new` run), so this identity file was written at research time.

Makes the PRD's Success Criteria measurable: the five-step funnel
(signed up → self-profile filled → first person added → hierarchy generated →
contact confirmed) emits named events to PostHog through one typed wrapper,
so "did a user get from *added my people* to *confirmed a contact*?" is a
dashboard question rather than a `wrangler tail` question.

Scope agreed before research (2026-09-04):

- **Exactly the five Success-Criteria steps.** Not every mutating API route.
  F-06's own risk note names instrumentation sprawl as the second of its two
  real risks.
- **No autocapture, no session replay, no feature flags, no A/B, no error
  tracking.** Session replay in particular would record screens full of
  third-party personal data; the parked "error tracking / logging library"
  entry in the roadmap stays parked and is not silently resolved here.
- **Privacy is the binding constraint, not a footnote.** No person's name,
  `description`, `relationship_context`, `tags`, `last_contact_bucket` or
  the user's email may appear in an event payload. The wrapper must make the
  safe call the easy one — an allow-list of properties, not a free-form object.

Open decisions carried into this change (from the roadmap's F-06 Unknowns and
Open Roadmap Question 11): PostHog Cloud region vs self-host, server-side vs
browser capture, reverse proxy under the app's own domain, and whether an
opt-out toggle ships in `/settings` (S-07's page) or not at all.

Research: `context/changes/product-analytics-posthog/research.md`.
