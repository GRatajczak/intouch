-- Slice S-17, impl-review finding F4: openai_api_key_failure_reason is
-- documented and application-written as only "auth" | "quota" | null
-- (src/lib/ranking/run.ts's writeKeyHealth), but the column itself was left
-- unconstrained text in 20260911151726_add_profiles_openai_key_health.sql.
-- A separate migration, not an edit to that one: the column is already live
-- locally and on the linked stage project.
--
-- Forward-compatible per CLAUDE.md §Rollback: a CHECK constraint on an
-- already-nullable column adds no new NOT NULL requirement and no default,
-- so a `wrangler rollback` to a pre-this-migration Worker is unaffected --
-- older code never wrote anything but those two values or null anyway.

alter table public.profiles
  add constraint profiles_openai_api_key_failure_reason_check
  check (openai_api_key_failure_reason is null or openai_api_key_failure_reason in ('auth', 'quota'));
