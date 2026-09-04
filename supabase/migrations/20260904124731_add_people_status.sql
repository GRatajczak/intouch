-- Slice S-05: person lifecycle state. A deactivated person is excluded from
-- AI ranking and the dashboard's people count while their contact history
-- (contact_events, ranking_entries) is retained. Deletion of a person is
-- only ever allowed once deactivated -- enforced server-side in the DELETE
-- route, not by this migration. Purely additive with a DEFAULT, so existing
-- rows read back as 'active' with no backfill needed (forward-compatible
-- per CLAUDE.md).

alter table public.people
  add column status text not null default 'active'
    check (status in ('active', 'deactivated'));

comment on column public.people.status is
  'Lifecycle state: active or deactivated. A deactivated person is excluded from AI ranking and the dashboard people count, but their contact history is retained. Deletion is only permitted once deactivated.';
