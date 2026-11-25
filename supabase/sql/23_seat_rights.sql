-- Quot3 shared notebook - 23: per-phone rights   (Phase 285, Milestone 25; docs/MILESTONE25_DESIGN.md, API_CONTRACTS.md M25-4 and M25-6)
-- Safe to run more than once. Run after 22, in each COMPANY project (never on the master). NEVER RUN from the sandbox: "works on Supabase" is a
-- standing gap until the owner runs checklist H in docs/SUPABASE_MIGRATIONS.md. Never edit this file after the owner has run it; a later change
-- is a new numbered file. Files 19-22 stay as they are.
--
-- What this file does:
--   1. sn_seat_rights: one row per seat that seat 1 has configured (the eleven phone-rights flags, see qt_rights_norm). RLS on, no policies, all
--      direct grants revoked: only the security-definer functions below (and the master's sealed service key, which bypasses RLS) read it.
--   2. Internal helpers (not callable by the app): qt_rights_norm, qt_rights_flags. Seat 1 always has every right; a seat with no row reads as all false
--      HERE and is reported "configured: false", so the app can apply its own default (the Staff preset) for a seat made after this file ran.
--   3. SEEDING: every seat that exists when this file is first run gets a row with ALL eleven flags true, so nothing breaks on update. The seeding runs
--      only while sn_seat_rights is EMPTY, so a re-run never gives a later seat a row (that seat stays "not configured").
--   4. qt_seat_rights_get (any seat: its own), qt_seat_rights_list and qt_seat_rights_set (seat 1 only, else Q3P02 seat1_only). Invalid input = Q3I01.
--      A set rings the doorbell (sn_ping) exactly as file 21 does, only when the stored flags really changed or the seat gets its first row.
--      No activity-log row [A]. The rights hide and block things IN THE APP only; they are not a security boundary against a modified client.
-- Phones only (owner decision D4): the desktop is never restricted by these flags.

-- 1. table
create table if not exists public.sn_seat_rights (
  org_id      uuid        not null,
  seat_no     int         not null check (seat_no between 1 and 50),
  flags       jsonb       not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(flags) = 'object'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid        null,
  primary key (org_id, seat_no),
  -- a removed seat takes its rights with it (a new seat with the same number starts "not configured")
  foreign key (org_id, seat_no) references public.sn_members (org_id, seat_no) on delete cascade
);
alter table public.sn_seat_rights enable row level security;
revoke all on table public.sn_seat_rights from public, anon, authenticated;

-- 2. helpers
-- Any stored value -> the eleven flags, each a real boolean (anything but jsonb true is false; unknown keys are dropped).
create or replace function public.qt_rights_norm(p_flags jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'seeAddress',    coalesce(p_flags -> 'seeAddress'    = 'true'::pg_catalog.jsonb, false),
    'seeContact',    coalesce(p_flags -> 'seeContact'    = 'true'::pg_catalog.jsonb, false),
    'seePriceList',  coalesce(p_flags -> 'seePriceList'  = 'true'::pg_catalog.jsonb, false),
    'seeSales',      coalesce(p_flags -> 'seeSales'      = 'true'::pg_catalog.jsonb, false),
    'seePayments',   coalesce(p_flags -> 'seePayments'   = 'true'::pg_catalog.jsonb, false),
    'shareBills',    coalesce(p_flags -> 'shareBills'    = 'true'::pg_catalog.jsonb, false),
    'exportData',    coalesce(p_flags -> 'exportData'    = 'true'::pg_catalog.jsonb, false),
    'deleteBills',   coalesce(p_flags -> 'deleteBills'   = 'true'::pg_catalog.jsonb, false),
    'editOldBills',  coalesce(p_flags -> 'editOldBills'  = 'true'::pg_catalog.jsonb, false),
    'editCustomers', coalesce(p_flags -> 'editCustomers' = 'true'::pg_catalog.jsonb, false),
    'editPayments',  coalesce(p_flags -> 'editPayments'  = 'true'::pg_catalog.jsonb, false))
$$;

-- The flags of a seat: seat 1 = all true always; another seat = its row, normalised; no row = all false.
create or replace function public.qt_rights_flags(p_org uuid, p_seat int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if p_seat = 1 then
    return public.qt_rights_norm(pg_catalog.jsonb_build_object(
      'seeAddress', true, 'seeContact', true, 'seePriceList', true, 'seeSales', true, 'seePayments', true, 'shareBills', true,
      'exportData', true, 'deleteBills', true, 'editOldBills', true, 'editCustomers', true, 'editPayments', true));
  end if;
  select r.flags into v_row from public.sn_seat_rights r where r.org_id = p_org and r.seat_no = p_seat;
  return public.qt_rights_norm(coalesce(v_row, '{}'::pg_catalog.jsonb));
end
$$;

-- 3. seeding: every existing seat (seat 1 included) gets every right, ONLY while the table is empty
insert into public.sn_seat_rights (org_id, seat_no, flags, updated_at, updated_by)
select m.org_id, m.seat_no,
       pg_catalog.jsonb_build_object(
         'seeAddress', true, 'seeContact', true, 'seePriceList', true, 'seeSales', true, 'seePayments', true, 'shareBills', true,
         'exportData', true, 'deleteBills', true, 'editOldBills', true, 'editCustomers', true, 'editPayments', true),
       pg_catalog.now(), null
  from public.sn_members m
 where not exists (select 1 from public.sn_seat_rights x)
on conflict (org_id, seat_no) do nothing;

-- 4a. qt_seat_rights_get: the caller's own seat
create or replace function public.qt_seat_rights_get(p_license text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_seat int := public.qt_price_seat();
begin
  return pg_catalog.jsonb_build_object(
    'seat_no', v_seat,
    'flags', public.qt_rights_flags(v_org, v_seat),
    'configured', v_seat = 1 or exists (select 1 from public.sn_seat_rights r where r.org_id = v_org and r.seat_no = v_seat));
end
$$;

-- 4b. qt_seat_rights_list: every seat (seat 1 only)
create or replace function public.qt_seat_rights_list(p_license text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'seat_no', m.seat_no, 'branch_name', b.name, 'flags', public.qt_rights_flags(m.org_id, m.seat_no),
             'configured', (m.seat_no = 1 or r.seat_no is not null), 'updated_at', r.updated_at
           ) order by m.seat_no), '[]'::pg_catalog.jsonb)
      from public.sn_members m
      left join public.sn_branches b on b.branch_id = m.branch_id
      left join public.sn_seat_rights r on r.org_id = m.org_id and r.seat_no = m.seat_no
     where m.org_id = v_org
  );
end
$$;

-- 4c. qt_seat_rights_set: seat 1 only; rings the doorbell only when something really changed
create or replace function public.qt_seat_rights_set(p_license text, p_seat int, p_flags jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_flags jsonb;
  v_old jsonb;
  v_existed boolean;
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  if p_seat is null or p_seat not between 1 and 50 or p_flags is null or pg_catalog.jsonb_typeof(p_flags) <> 'object'
     or not exists (select 1 from public.sn_members m where m.org_id = v_org and m.seat_no = p_seat) then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_old := public.qt_rights_flags(v_org, p_seat);
  v_existed := exists (select 1 from public.sn_seat_rights r where r.org_id = v_org and r.seat_no = p_seat);
  -- seat 1 can never be restricted: its row is forced all true
  v_flags := case when p_seat = 1 then public.qt_rights_flags(v_org, 1) else public.qt_rights_norm(p_flags) end;
  insert into public.sn_seat_rights (org_id, seat_no, flags, updated_at, updated_by)
  values (v_org, p_seat, v_flags, pg_catalog.now(), auth.uid())
  on conflict (org_id, seat_no) do update set flags = excluded.flags, updated_at = pg_catalog.now(), updated_by = auth.uid();
  if not v_existed or v_old is distinct from v_flags then
    -- ring the doorbell exactly like sn_push and file 21 do, so live phones re-read their rights at once
    insert into public.sn_ping (org_id, seq, at) values (v_org, 1, pg_catalog.now())
    on conflict (org_id) do update set seq = public.sn_ping.seq + 1, at = pg_catalog.now();
  end if;
  return pg_catalog.jsonb_build_object('seat_no', p_seat, 'flags', v_flags, 'configured', true);
end
$$;

-- 5. Grants. Helpers are internal; the app may call the three qt_seat_rights_* functions only.
revoke all on function public.qt_rights_norm(jsonb)                           from public, anon, authenticated;
revoke all on function public.qt_rights_flags(uuid, int)                      from public, anon, authenticated;
revoke all on function public.qt_seat_rights_get(text)                        from public, anon, authenticated;
revoke all on function public.qt_seat_rights_list(text)                       from public, anon, authenticated;
revoke all on function public.qt_seat_rights_set(text, int, jsonb)            from public, anon, authenticated;
grant execute on function public.qt_seat_rights_get(text)                     to authenticated;
grant execute on function public.qt_seat_rights_list(text)                    to authenticated;
grant execute on function public.qt_seat_rights_set(text, int, jsonb)         to authenticated;
