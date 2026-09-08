-- Foundation F-06: product analytics for the primary success funnel.
--
-- One durable consent flag per profile, read by src/lib/analytics/consent.ts
-- before any of the five funnel events is captured. The column ships in
-- phase 1 -- two phases ahead of the /settings control that flips it -- so the
-- gate exists from the moment the first event can fire, never after.
--
-- Defaults to FALSE (opted in), which is the inverse polarity of
-- `reminders_enabled` in 20260908090338 and deliberately so: the field name
-- states what it means when true, and every existing profile reads back
-- consented with no backfill.
--
-- Forward-compatible per CLAUDE.md §Rollback: additive with a NOT NULL DEFAULT,
-- so a `wrangler rollback` to a pre-F-06 Worker leaves the column in place,
-- unread and harmless.
--
-- No RLS change and no GRANT change: policies on public.profiles are row-level
-- and the table-level grant from 20260830101704_add_profiles_and_people_fields
-- (lines 39-40) already covers new columns -- the same reasoning recorded in
-- 20260831202209_add_profile_rhythm_fields.sql.

alter table public.profiles
  add column analytics_opt_out boolean not null default false;

comment on column public.profiles.analytics_opt_out is
  'Whether the owner has opted OUT of product-analytics events (F-06). Toggled from /settings; read by src/lib/analytics/consent.ts before every capture. Defaults to false, i.e. opted in.';
