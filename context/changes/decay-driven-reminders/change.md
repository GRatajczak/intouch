---
change_id: decay-driven-reminders
title: Be reminded by email, unprompted, about relationships going quiet
status: impl_reviewed
created: 2026-09-08
updated: 2026-09-08
archived_at: null
---

## Notes

@context/foundation/roadmap.md (S-04)

Roadmap slice `S-04`, `blocked` until now on one decision: the cadence rule.
PRD `FR-008` (reminders aligned with the hierarchy, delivered as email to the
address on the account), NFR "reminders reach the user at most once per day,
and address relationship decay — not same-day calendar events", NFR "reminders
are delivered by email … through Resend … delivery outcomes must be observable
rather than fire-and-forget". Closes PRD Open Questions 3 (cadence) and 4
(email content).

The delivery path itself is already proven: `F-04` (`resend-email-delivery-path`)
shipped `src/worker.ts`'s `scheduled` export, a real Cron Trigger, the Resend
client factory and the branded email shell. What it explicitly did not build is
any Supabase access from the scheduled handler, any reminder logic, and any
sending identity beyond Resend's test sender.

This is the first code in the repo that acts on behalf of users who are not
present, so it owns the question `F-01` never had to face: how a sweep reads
across owners without a blanket RLS bypass.
