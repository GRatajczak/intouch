-- Privacy compliance phase 1: analytics consent becomes opt-IN.
--
-- `analytics_opt_out` (20260908121419) defaulted to false, i.e. consented, and
-- code treated an absent row as consent. ePrivacy / PKE art. 399 needs a prior
-- affirmative choice, so this adds a tri-state `analytics_consent`:
--   null  = never asked (treated as "do not send")
--   true  = explicitly accepted
--   false = explicitly refused
--
-- ROLLBACK SAFETY: the old column stays and is kept consistent. A
-- `wrangler rollback` to Worker code that still reads `analytics_opt_out` must
-- not resume tracking nobody agreed to, so every existing profile is set to
-- opted OUT here, and the Settings toggle writes both columns until the old
-- one is dropped in a later change (at least one deploy after nothing reads it,
-- per CLAUDE.md §Rollback).
--
-- No RLS change and no GRANT change: the table-level grant on public.profiles
-- already covers new columns (same reasoning as 20260908121419).

alter table public.profiles
  add column analytics_consent boolean;

update public.profiles
  set analytics_opt_out = true;

-- New profiles must also read as opted out to rolled-back code: a profile
-- created after this migration has analytics_consent = null (never asked), and
-- the old default of false would make legacy code treat it as consented.
alter table public.profiles
  alter column analytics_opt_out set default true;

comment on column public.profiles.analytics_consent is
  'Explicit analytics consent. null = never asked (no events sent), true = accepted, false = refused. Supersedes analytics_opt_out, which is kept in sync (= not analytics_consent, or true while null) so a Worker rollback cannot re-enable tracking.';
