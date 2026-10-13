-- Quot3 sync postbox - 06: pending count        (Phase 89)
-- How many rows are waiting for the calling branch (used for "Receiving 300 of 768"). Same license check as qt_pull.
-- WRITTEN BUT NOT YET RUN against a real Supabase project (standing gap, see PHASE_STATUS.md).

create or replace function public.qt_pending_count(p_license text, p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_n bigint;
begin
  v_org := public.qt_auth(p_license, p_branch_id);
  select count(*) into v_n from public.postbox p where p.org_id = v_org and p.to_branch = p_branch_id;
  return jsonb_build_object('pending', v_n);
end
$$;

revoke all on function public.qt_pending_count(text, uuid) from public;
grant execute on function public.qt_pending_count(text, uuid) to anon, authenticated;
