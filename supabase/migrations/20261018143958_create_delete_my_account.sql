-- Privacy compliance phase 1, step 3: real account deletion.
--
-- POST /api/settings/delete-data used to wipe people, rankings and profiles but
-- left the auth.users row (e-mail and password hash) behind. Deleting that one
-- row removes everything: every owner table references auth.users with
-- ON DELETE CASCADE (profiles, people, rankings, ranking_entries,
-- contact_events, reminder_sends), and Supabase's own auth.identities and
-- auth.sessions cascade from it too.
--
-- Why a SQL function and not the service-role client: src/lib/supabase-admin.ts
-- is import-restricted by ESLint to src/lib/reminders/**, and the repo's pattern
-- for privileged work is a SECURITY DEFINER function with an explicit revoke
-- (see reminder_candidates, 20260908090338). The ESLint rule is intentionally
-- left unchanged, so the service-role key never enters an HTTP request path.
--
-- The function can only ever delete the CALLER: the target is auth.uid(), read
-- from the request's JWT, never a parameter. There is no argument to forge.
--
-- Forward-compatible per CLAUDE.md §Rollback: a new function only. Rolled-back
-- Worker code simply never calls it.

create function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

comment on function public.delete_my_account() is
  'Deletes the calling user''s auth.users row; all owner data cascades. Target is auth.uid(), never a parameter. authenticated only.';

-- EXECUTE is granted to PUBLIC by default on every new function, so the revoke
-- is the actual gate. anon has no auth.uid() anyway, but a function that does
-- nothing for anon should not be callable by it.
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
