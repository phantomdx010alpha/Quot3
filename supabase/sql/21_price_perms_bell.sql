-- Quot3 shared notebook - 21: rights changes ring the doorbell   (Phase 256, Milestone 24; docs/MILESTONE24_DESIGN.md section 2)
-- Safe to run more than once. Run after 20. NEVER RUN from the sandbox: "works on Supabase" is a standing gap until the owner runs
-- checklist H in docs/SUPABASE_MIGRATIONS.md. Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What this file does:
--   1. Replaces qt_price_perms_set (same argument list and result; body of file 20 + one sn_ping touch, the same upsert sn_push uses).
--      The touch happens only when the stored flags really changed, so a Save that changes nothing rings nothing. Files 19 and 20 stay as they are.
--   2. Grants are repeated exactly as in file 20 (the function keeps its signature, but a grant is cheap and keeps this file self-contained).
-- Why: before this file a changed right reached another seat only on its next sync cycle or when it opened the Price List (Phase 255 made
-- those refreshes automatic); with the ring the app re-reads its rights at once.

-- 1. qt_price_perms_set
create or replace function public.qt_price_perms_set(p_license text, p_seat int, p_flags jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_flags jsonb;
  v_old jsonb;
  v_branch uuid;
  v_bname text;
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  if p_seat is null or p_seat not between 1 and 50 or p_flags is null or pg_catalog.jsonb_typeof(p_flags) <> 'object'
     or not exists (select 1 from public.sn_members m where m.org_id = v_org and m.seat_no = p_seat) then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_old := public.qt_price_flags(v_org, p_seat);
  v_flags := case when p_seat = 1
                  then pg_catalog.jsonb_build_object('add', true, 'edit', true, 'overwrite', true, 'delete', true, 'structure', true)
                  else public.qt_price_norm(p_flags) end;
  insert into public.sn_price_perms (org_id, seat_no, flags, updated_at, updated_by)
  values (v_org, p_seat, v_flags, pg_catalog.now(), auth.uid())
  on conflict (org_id, seat_no) do update set flags = excluded.flags, updated_at = pg_catalog.now(), updated_by = auth.uid();
  if v_old is distinct from v_flags then
    select m.branch_id into v_branch from public.sn_members m where m.user_id = auth.uid();
    select b.name into v_bname from public.sn_branches b where b.branch_id = v_branch;
    insert into public.sn_price_log (org_id, seat_no, branch_id, branch_name, device, kind, rec_id, entity, op, path, before, after, count)
    values (v_org, 1, v_branch, coalesce(pg_catalog.left(v_bname, 200), ''), 'pc', 'price_perms', null, 'perms', 'permission', 'Seat ' || p_seat::text, v_old, v_flags, 1);
    -- Phase 256: ring the doorbell exactly like sn_push does, so live devices re-read their rights at once (only when something really changed).
    insert into public.sn_ping (org_id, seq, at) values (v_org, 1, pg_catalog.now())
    on conflict (org_id) do update set seq = public.sn_ping.seq + 1, at = pg_catalog.now();
  end if;
  return pg_catalog.jsonb_build_object('seat_no', p_seat, 'flags', v_flags);
end
$$;

-- 2. Grants
revoke all on function public.qt_price_perms_set(text, int, jsonb) from public, anon, authenticated;
grant execute on function public.qt_price_perms_set(text, int, jsonb) to authenticated;
