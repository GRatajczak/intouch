-- Slice S-02: durable home for a computed AI ranking. Two tables so a run's
-- metadata (when, which model, how many people it could see) is separable
-- from its entries -- S-03 attaches feedback to an entry, S-04 reads the
-- order for reminders. owner_id is denormalized onto ranking_entries so its
-- policies need no join, matching every existing policy in this project.
-- ON DELETE CASCADE on both owner_id FKs is a deliberate per-table decision
-- (lessons.md): a ranking is derived data with no value once its owner is
-- gone, and leaving AI-generated prose about a deleted user's relationships
-- behind would violate the PRD's binary erasure NFR.

create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text not null,
  -- People actually sent to the model vs. people the user has. Unequal when
  -- the 50-person cap truncated the input; the UI says so rather than hiding it.
  people_considered smallint not null,
  people_total smallint not null
);

create index rankings_owner_id_created_at_idx on public.rankings (owner_id, created_at desc);

alter table public.rankings enable row level security;

create policy "rankings_select_own" on public.rankings
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "rankings_insert_own" on public.rankings
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "rankings_update_own" on public.rankings
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "rankings_delete_own" on public.rankings
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select on public.rankings to anon;
grant select, insert, update, delete on public.rankings to authenticated;

create table public.ranking_entries (
  id uuid primary key default gen_random_uuid(),
  ranking_id uuid not null references public.rankings (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- Not `position`: that is a Postgres function name and reads ambiguously in queries.
  rank_position smallint not null,
  time_window text not null
    check (time_window in ('this_week', 'two_weeks', 'this_month', 'no_rush')),
  reason text not null check (char_length(reason) <= 400),
  context_note text check (char_length(context_note) <= 60),
  -- Null whenever the owner left S-09's rhythm fields empty. Not defaulted.
  rhythm_note text check (char_length(rhythm_note) <= 60),
  unique (ranking_id, rank_position)
);

create index ranking_entries_ranking_id_rank_position_idx on public.ranking_entries (ranking_id, rank_position);

alter table public.ranking_entries enable row level security;

create policy "ranking_entries_select_own" on public.ranking_entries
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "ranking_entries_insert_own" on public.ranking_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "ranking_entries_update_own" on public.ranking_entries
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "ranking_entries_delete_own" on public.ranking_entries
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select on public.ranking_entries to anon;
grant select, insert, update, delete on public.ranking_entries to authenticated;
