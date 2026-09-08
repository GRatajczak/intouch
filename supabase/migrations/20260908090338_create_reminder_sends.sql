-- Slice S-04: state for the decay-driven reminder sweep.
--
-- Three things land together because they are one contract: an opt-out flag,
-- a durable record of every send, and the two functions that are the sweep's
-- ONLY cross-owner surface.
--
-- Context that shapes all of it: the sweep runs from a Cloudflare Cron Trigger
-- with no signed-in user, so every `(select auth.uid()) = owner_id` policy in
-- this schema returns zero rows for it. F-01 established that contract for
-- request-time code and it is not being weakened here -- instead the sweep is
-- given one narrow, auditable way through it (see the two functions below).
--
-- Forward-compatible per CLAUDE.md: `reminders_enabled` is additive with a
-- DEFAULT, and `reminder_sends` is new. A `wrangler rollback` to a pre-S-04
-- Worker leaves both in place with nothing reading them.

-- ---------------------------------------------------------------------------
-- 1. Opt-out flag
-- ---------------------------------------------------------------------------

-- Defaults to true so every existing profile reads back opted in and no
-- backfill is needed. The user-facing control for this lands on /settings in
-- phase 6; until then the column exists and the sweep already honours it.
alter table public.profiles
  add column reminders_enabled boolean not null default true;

comment on column public.profiles.reminders_enabled is
  'Whether the owner receives FR-008 reminder emails. Toggled from /settings; read by public.reminder_candidates(). Defaults to true.';

-- ---------------------------------------------------------------------------
-- 2. Send log
-- ---------------------------------------------------------------------------

-- One row per attempted send, written on BOTH outcomes. This table is what
-- turns the PRD's "at most once per day" NFR from a hope into a queryable
-- fact, and what satisfies "delivery outcomes must be observable rather than
-- fire-and-forget" -- a failed send that left no trace is exactly the
-- fire-and-forget that NFR forbids.
--
-- ON DELETE choices are a deliberate per-table decision, recorded here rather
-- than inherited from people's cascade (lessons.md):
--   owner_id   -> CASCADE. A send log about a deleted account's relationships
--                 is third-party personal data with nobody to own it, and the
--                 erasure NFR is binary.
--   person_id  -> SET NULL. Deleting one person must not erase the evidence
--                 that the once-a-day rule was honoured for that user. What
--                 survives carries no name -- an owner, a timestamp, a status.
--   ranking_id -> SET NULL, same reasoning: provenance is nice to have, but
--                 the cooldown must not lose rows to a ranking's lifecycle.
create table public.reminder_sends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The hero person the email was about. Null once that person is deleted.
  person_id uuid references public.people (id) on delete set null,
  -- Which ranking the hero was chosen from. Provenance only.
  ranking_id uuid references public.rankings (id) on delete set null,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'failed')),
  -- Resend's message id on success; null on failure.
  provider_message_id text,
  -- Truncated to 500 by record_reminder_send() so a long provider error can
  -- never fail the write that exists to record it.
  error text check (char_length(error) <= 500)
);

-- The cooldown query's exact shape: newest send for one owner. Also covers
-- plain owner_id lookups, so no separate FK index is needed for it.
create index reminder_sends_owner_id_sent_at_idx
  on public.reminder_sends (owner_id, sent_at desc);

-- The other two FKs get their own indexes: both are SET NULL, and a SET NULL
-- scans the child table when a parent goes away. S-05 deletes people for real,
-- so person_id's is load-bearing; ranking_id's is cheap uniformity on a table
-- that stays small.
create index reminder_sends_person_id_idx on public.reminder_sends (person_id);
create index reminder_sends_ranking_id_idx on public.reminder_sends (ranking_id);

alter table public.reminder_sends enable row level security;

-- Four owner-scoped policies plus the grant pair, mirroring
-- 20260902184909_create_contact_events_table.sql exactly so the isolation
-- contract stays uniform across the schema. The sweep does not use these --
-- it goes through the service role -- but a signed-in owner reading their own
-- send history must work the same way everything else in this app does.
create policy "reminder_sends_select_own" on public.reminder_sends
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "reminder_sends_insert_own" on public.reminder_sends
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "reminder_sends_update_own" on public.reminder_sends
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "reminder_sends_delete_own" on public.reminder_sends
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select on public.reminder_sends to anon;
grant select, insert, update, delete on public.reminder_sends to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The sweep's only cross-owner surface
-- ---------------------------------------------------------------------------

-- Both functions live in `public` on purpose, even though the usual advice is
-- to hide SECURITY DEFINER helpers in a private schema. That advice is for
-- functions called by Postgres itself from inside an RLS policy. These two are
-- called over HTTP by the Worker through PostgREST, and supabase/config.toml
-- exposes only `public` and `graphql_public` -- a private-schema function
-- would simply be unreachable. The gate is therefore the REVOKE below, not
-- the schema: EXECUTE is granted to PUBLIC by default on every new function,
-- so without an explicit revoke any anon browser client could call these.
--
-- Both carry `set search_path = ''` and fully-qualified names, so a
-- caller-controlled search_path cannot redirect their table references.

-- Answers exactly one question: which owners may be emailed right now, and at
-- what address. Everything downstream is scoped to a single named owner and
-- goes through the existing owner-filtered helpers -- so this is the only
-- place in the system where rows for more than one owner are ever visible.
create function public.reminder_candidates(cooldown_days int, max_rows int)
returns table (owner_id uuid, email text, last_sent_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select
    p.owner_id,
    u.email::text,
    s.last_sent_at
  from public.profiles p
  join auth.users u on u.id = p.owner_id
  left join lateral (
    -- Only successful sends start a cooldown. A failed send must not buy the
    -- user three days of silence -- that would turn one Resend hiccup into a
    -- missed reminder nobody could see.
    select max(rs.sent_at) as last_sent_at
    from public.reminder_sends rs
    where rs.owner_id = p.owner_id
      and rs.status = 'sent'
  ) s on true
  where p.reminders_enabled
    and u.email is not null
    and u.deleted_at is null
    and (
      s.last_sent_at is null
      -- Calendar days in Europe/Warsaw, NOT an elapsed interval. This mirrors
      -- src/lib/dates.ts (`calendarDaysBetween`, `APP_TIME_ZONE`), which the
      -- app adopted as its single notion of "a day" -- and it is the notion
      -- the NFR uses too ("at most once per day" is a calendar claim).
      --
      -- An exact interval would make the cooldown depend on cron jitter: a
      -- send at 06:00:03 is not `< now() - interval '3 days'` at a sweep
      -- firing 06:00:01 three days later, but is at 06:00:05 -- so the same
      -- user waits three days or four depending on sub-second timing. Date
      -- subtraction has no such wobble. cooldown_days = 1 is then exactly the
      -- NFR's ceiling; 0 disables the cooldown entirely.
      or ((now() at time zone 'Europe/Warsaw')::date
          - (s.last_sent_at at time zone 'Europe/Warsaw')::date) >= cooldown_days
    )
  -- Never-reminded owners first, then longest-waiting. Combined with max_rows
  -- this makes the per-run cap fair rather than arbitrary: nobody can be
  -- starved by a user who happens to sort earlier.
  order by s.last_sent_at asc nulls first
  limit max_rows;
$$;

comment on function public.reminder_candidates(int, int) is
  'S-04: the sweep''s only cross-owner query. Returns owners who are opted in and outside their cooldown, oldest-waiting first. service_role only.';

-- The write half. The service role could insert directly, but routing it
-- through a named function keeps the admin client's whole surface to two
-- calls, and gives the error truncation one home.
create function public.record_reminder_send(
  p_owner_id uuid,
  p_person_id uuid,
  p_ranking_id uuid,
  p_status text,
  p_provider_message_id text,
  p_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.reminder_sends (
    owner_id, person_id, ranking_id, status, provider_message_id, error
  )
  values (
    p_owner_id,
    p_person_id,
    p_ranking_id,
    p_status,
    p_provider_message_id,
    -- Truncated rather than rejected: the CHECK exists to bound the column,
    -- not to make a verbose provider error destroy the record of the failure.
    nullif(left(p_error, 500), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_reminder_send(uuid, uuid, uuid, text, text, text) is
  'S-04: records one reminder send attempt, successful or failed. service_role only.';

-- Postgres grants EXECUTE on a new function to PUBLIC by default. Without
-- these revokes both functions would be callable as an RPC by any anon
-- browser client -- reminder_candidates would hand out every user's email
-- address in one request.
revoke all on function public.reminder_candidates(int, int) from public, anon, authenticated;
revoke all on function public.record_reminder_send(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.reminder_candidates(int, int) to service_role;
grant execute on function public.record_reminder_send(uuid, uuid, uuid, text, text, text) to service_role;
