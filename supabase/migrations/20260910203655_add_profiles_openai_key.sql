-- Slice S-17: bring-your-own OpenAI key.
--
-- Three nullable columns on profiles, all additive with no default, so the
-- migration is forward-compatible per CLAUDE.md §Rollback -- a `wrangler
-- rollback` to a pre-S-17 Worker leaves them in place, unread and harmless.
--
-- No RLS change and no GRANT change: policies on public.profiles are
-- row-level, and the table-level grant from
-- 20260830101704_add_profiles_and_people_fields.sql (lines 39-40) already
-- covers new columns -- the same reasoning recorded in
-- 20260831202209_add_profile_rhythm_fields.sql and
-- 20260908121419_add_profiles_analytics_opt_out.sql.

alter table public.profiles
  add column openai_api_key_ciphertext text,
  add column openai_api_key_hint text,
  add column free_recompute_claimed_on date;

comment on column public.profiles.openai_api_key_ciphertext is
  'Versioned AES-GCM envelope ("v1:<iv>:<ciphertext>") of the owner''s OpenAI API key, written by POST /api/settings/openai-key and decrypted by src/lib/openai-key.ts before a ranking run. Null means the owner has no key on file, in which case the app key and the free-tier daily cap apply.';

comment on column public.profiles.openai_api_key_hint is
  'Deliberately PLAINTEXT and deliberately only the last four characters of the owner''s OpenAI API key, written alongside openai_api_key_ciphertext so /settings can render "sk-…<hint>" without a decrypt round trip. Never the full key.';

comment on column public.profiles.free_recompute_claimed_on is
  'App-calendar date (Europe/Warsaw, src/lib/dates.ts) on which the owner last spent their one free manual "Przelicz teraz" recompute. Null means unclaimed. Ignored entirely for an owner with a usable openai_api_key_ciphertext. Written by src/lib/ranking/free-tier.ts via a guarded UPDATE ... RETURNING, which is the compare-and-swap the KV limitation at src/pages/api/rankings.ts:50-56 cannot provide.';
