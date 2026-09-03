-- Slice S-03: durable, person-centric record of whether a suggested contact
-- happened. Mirrors 20260901120000_create_rankings_tables.sql's RLS shape
-- exactly -- four owner-scoped policies plus the same grant pair -- so the
-- isolation contract stays uniform across the schema.
--
-- This is deliberately NOT a column on ranking_entries: entries are per-run
-- and a new row set is written on every recompute, while FR-005 requires a
-- person's history to survive their deactivation. ranking_entry_id is kept
-- only as optional provenance.
--
-- Both ON DELETE CASCADE choices are a deliberate per-table decision
-- (lessons.md), recorded here rather than inherited from people's default:
-- the PRD's erasure NFR is binary, and a note is free text about a third
-- party, so retaining events after the person or the account is deleted
-- would be a stated regression. ranking_entry_id is ON DELETE SET NULL
-- instead, so history survives a ranking's own lifecycle.

create table public.contact_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  ranking_entry_id uuid references public.ranking_entries (id) on delete set null,
  occurred_at timestamptz not null default now(),
  outcome text not null check (outcome in ('happened', 'not_yet')),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create index contact_events_owner_id_person_id_occurred_at_idx
  on public.contact_events (owner_id, person_id, occurred_at desc);

alter table public.contact_events enable row level security;

create policy "contact_events_select_own" on public.contact_events
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "contact_events_insert_own" on public.contact_events
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "contact_events_update_own" on public.contact_events
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "contact_events_delete_own" on public.contact_events
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select on public.contact_events to anon;
grant select, insert, update, delete on public.contact_events to authenticated;
