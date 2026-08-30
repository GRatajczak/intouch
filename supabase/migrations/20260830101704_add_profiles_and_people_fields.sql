-- Slice S-01: self-profile + structured people fields.
-- profiles is a new owner-scoped table (one row per user); people gains the
-- structured columns the add-person form collects. people currently holds no
-- real rows, so NOT NULL columns are added without a DEFAULT (see plan.md's
-- Migration Notes) -- this window closes once real users have rows.

create table public.profiles (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 100),
  birth_date date not null check (birth_date <= current_date),
  life_context text not null check (char_length(life_context) <= 300),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "profiles_insert_own" on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "profiles_update_own" on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- RLS policies alone do not grant table access -- Postgres requires a
-- table-level GRANT before a role reaches policy evaluation at all. This
-- local project's default privileges leave anon/authenticated with neither
-- on newly created tables, so every owner-scoped table needs its GRANTs
-- spelled out explicitly (discovered while extending F-01's people table,
-- which had the same gap -- retrofitted below).
grant select on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;

alter table public.people
  add column name text not null check (char_length(name) <= 100),
  add column relationship_type text not null check (relationship_type in ('family', 'friend', 'colleague', 'acquaintance', 'other')),
  add column description text not null check (char_length(description) <= 500),
  add column is_collective boolean not null default false,
  add column weight smallint not null check (weight between 1 and 10);

grant select on public.people to anon;
grant select, insert, update, delete on public.people to authenticated;
