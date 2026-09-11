-- Slice S-17, phase 5: surfacing a key that stopped working after it was
-- saved -- revoked at OpenAI, or its quota exhausted -- inside a background
-- job nobody is watching.
--
-- Two nullable columns on public.profiles, additive with no default, so a
-- `wrangler rollback` to a pre-phase-5 Worker leaves them in place, unread
-- and harmless, per CLAUDE.md §Rollback.
--
-- No RLS change and no GRANT change: policies on public.profiles are
-- row-level, and the table-level grant from
-- 20260830101704_add_profiles_and_people_fields.sql (lines 39-40) already
-- covers new columns -- the same reasoning recorded in
-- 20260910203655_add_profiles_openai_key.sql.

alter table public.profiles
  add column openai_api_key_failed_at timestamptz,
  add column openai_api_key_failure_reason text;

comment on column public.profiles.openai_api_key_failed_at is
  'When the owner''s OpenAI key was last rejected or ran out of quota during a ranking run. Written only by src/lib/ranking/run.ts, cleared on the next successful run made with a user key. Null means no known failure.';

comment on column public.profiles.openai_api_key_failure_reason is
  'Why the owner''s OpenAI key last failed during a ranking run: "auth" (rejected) or "quota" (exhausted). Written only by src/lib/ranking/run.ts, alongside openai_api_key_failed_at.';
