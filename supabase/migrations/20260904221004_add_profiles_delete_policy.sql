-- Slice account-and-profile-settings (p4): "delete my data" needs to remove
-- the caller's own profile row, but profiles was never given a delete policy
-- or grant -- nothing deleted a profile before this feature existed.
-- Mirrors people/rankings/contact_events's existing "_delete_own" shape
-- exactly, scoped by the same owner_id = auth.uid() predicate.

create policy "profiles_delete_own" on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant delete on public.profiles to authenticated;
