-- Add richer, optional per-person context (S-10 / add-person-context-fields):
-- a short "who are they to you" line, freeform context tags, and a rough
-- last-contact estimate. All three are nullable/zero-value-defaulted so this
-- is purely additive -- no existing `people` row needs a value, and rolling
-- the Worker code back after this ships leaves harmless unused columns
-- behind (forward-compatible per CLAUDE.md).
--
-- `last_contact_bucket` deliberately has no relationship to `contact_events`:
-- that table's `occurred_at` backs `facts.ts`'s `daysSinceLastHappened` math,
-- which the did-it-happen loop (S-03) depends on for precision. A vague
-- bucket like "2-6 miesiecy temu" has no honest single timestamp to seed a
-- contact_events row with, so it stays a plain column on `people` instead.

alter table public.people
  add column relationship_context text check (char_length(relationship_context) <= 100),
  add column context_tags text[] not null default '{}'
    check (array_length(context_tags, 1) is null or array_length(context_tags, 1) <= 5),
  add column last_contact_bucket text
    check (last_contact_bucket in ('this_month', 'two_to_six_months', 'over_six_months', 'unknown'));
