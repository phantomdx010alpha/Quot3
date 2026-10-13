-- Quot3 shared notebook - 13: row level security   (Phase 128; spec section 11)
-- Safe to run more than once (policies are dropped and re-created). Run after 11 and 12. NOT yet run on a real Postgres.
--
-- Rule: a signed-in seat may SELECT rows of its OWN organisation, nothing else. There is NO insert / update / delete policy
-- on any sn_* table: every write goes through a security-definer RPC (Phase 129-130). anon has no access at all.
-- Row visibility goes through sn_members; a member can read only their own sn_members row, so the sub-select below
-- returns exactly one organisation id and cannot loop.

drop policy if exists sn_members_select_own on public.sn_members;
create policy sn_members_select_own on public.sn_members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists sn_branches_select_org on public.sn_branches;
create policy sn_branches_select_org on public.sn_branches
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

drop policy if exists sn_records_select_org on public.sn_records;
create policy sn_records_select_org on public.sn_records
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

drop policy if exists sn_history_select_org on public.sn_history;
create policy sn_history_select_org on public.sn_history
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

drop policy if exists sn_ping_select_org on public.sn_ping;
create policy sn_ping_select_org on public.sn_ping
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

-- Column-less table privilege: SELECT only, for signed-in seats only (RLS above narrows it to their organisation).
grant select on table public.sn_members  to authenticated;
grant select on table public.sn_branches to authenticated;
grant select on table public.sn_records  to authenticated;
grant select on table public.sn_history  to authenticated;
grant select on table public.sn_ping     to authenticated;
