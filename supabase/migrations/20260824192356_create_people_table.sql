-- Foundation F-01: per-user data isolation contract.
-- Establishes the owner-scoped RLS pattern every future user-owned table follows:
-- RLS enabled, no implicit access, one explicit policy per command.

create table public.people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index people_owner_id_idx on public.people (owner_id);

alter table public.people enable row level security;

create policy "people_select_own" on public.people
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "people_insert_own" on public.people
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "people_update_own" on public.people
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "people_delete_own" on public.people
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);
