-- Quot3 shared notebook - 91: SELF-TEST v2   (Phase 131; checks files 11-16 against spec docs/SYNC_SHARED_STORE_SPEC.md)
-- Run AFTER 01-06 and 11-16, in a SCRATCH project (or any database you can throw away). Everything happens inside one transaction that
-- ends in ROLLBACK, so no test data is kept. Each check prints "PASS ..." (Messages / Notices); the first failure stops the script
-- with "FAIL ...". A clean run ends with: ALL QUOT3 SHARED-NOTEBOOK SELF-TESTS PASSED
--
-- Supabase SQL editor: paste the whole file and press Run. The role used must be allowed to "set role anon / authenticated" (postgres is).
-- Signed-in seats are simulated by setting the JWT claims that auth.uid() reads, then switching to the authenticated role.
-- NOTE: the test creates its two test organisations with qt_create_org, which writes into Supabase's auth tables. If that step fails,
-- see "If the query cannot create users" in docs/SUPABASE_MIGRATIONS.md; this test cannot continue without it.
--
-- Covered: org creation (key stored hashed), anon and stranger refused, wrong / other-organisation license key, activation (name and
-- PO prefix clash, cross-organisation branch id, seat takeover), push (accepted, noop, conflict won and lost, tie, tombstone and
-- restore, history cap, validation, all-or-nothing, doorbell touch), pull cursor and tombstones, manifest, RLS isolation between two
-- organisations (reads and direct writes), suspended license, revoked seat, the Realtime publication.
-- It has NEVER been run on a real Postgres or Supabase (written in Phase 131 without one).

begin;

-- ---------------------------------------------------------------- helpers (temporary, vanish with the session)

-- Runs one SQL expression as a given seat (p_uid) or as anon (p_uid null, role anon); returns the value as text.
create or replace function pg_temp.t_call(p_uid uuid, p_expr text, p_role text default 'authenticated')
returns text
language plpgsql
as $$
declare
  v_res text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else jsonb_build_object('sub', p_uid::text, 'role', p_role)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  execute format('select (%s)::text', p_expr) into v_res;
  reset role;
  return v_res;
end
$$;

-- Runs one INSERT / UPDATE / DELETE as a seat or as anon.
create or replace function pg_temp.t_dml(p_uid uuid, p_stmt text, p_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else jsonb_build_object('sub', p_uid::text, 'role', p_role)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  execute p_stmt;
  reset role;
end
$$;

-- The expression must fail with exactly this SQLSTATE.
create or replace function pg_temp.t_expect(p_uid uuid, p_expr text, p_state text, p_label text, p_role text default 'authenticated')
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    perform pg_temp.t_call(p_uid, p_expr, p_role);
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is null then
    raise exception 'FAIL  % (no error was raised)', p_label;
  elsif v_state <> p_state then
    raise exception 'FAIL  % (expected %, got % %)', p_label, p_state, v_state, v_msg;
  end if;
  raise notice 'PASS  %', p_label;
end
$$;

-- The statement must fail with exactly this SQLSTATE.
create or replace function pg_temp.t_expect_dml(p_uid uuid, p_stmt text, p_state text, p_label text, p_role text default 'authenticated')
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    perform pg_temp.t_dml(p_uid, p_stmt, p_role);
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is null then
    raise exception 'FAIL  % (no error was raised)', p_label;
  elsif v_state <> p_state then
    raise exception 'FAIL  % (expected %, got % %)', p_label, p_state, v_state, v_msg;
  end if;
  raise notice 'PASS  %', p_label;
end
$$;

create or replace function pg_temp.t_ok(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'FAIL  %', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end
$$;

-- One push item. The payload defaults to {"h": hash} so the stored payload shows which write it came from.
create or replace function pg_temp.t_item(
  p_kind text, p_rec uuid, p_base int, p_hash text, p_edited timestamptz, p_deleted boolean default false, p_payload jsonb default null
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'kind', p_kind, 'rec_id', p_rec, 'base_version', p_base,
    'payload', coalesce(p_payload, jsonb_build_object('h', p_hash)), 'payload_hash', p_hash,
    'schema_ver', 1, 'min_reader_ver', 1, 'app_ver', 'selftest', 'edited_at', p_edited, 'deleted', p_deleted
  )
$$;

create or replace function pg_temp.t_push_expr(p_key text, p_branch uuid, p_items jsonb)
returns text
language sql
as $$
  select format('public.sn_push(%L, %L::uuid, %L::jsonb)', p_key, p_branch, p_items::text)
$$;

create or replace function pg_temp.t_push(p_uid uuid, p_key text, p_branch uuid, p_items jsonb)
returns jsonb
language sql
as $$
  select pg_temp.t_call(p_uid, pg_temp.t_push_expr(p_key, p_branch, p_items))::jsonb
$$;

create or replace function pg_temp.t_pull(p_uid uuid, p_key text, p_branch uuid, p_after bigint, p_limit int)
returns jsonb
language sql
as $$
  select pg_temp.t_call(p_uid, format('public.sn_pull(%L, %L::uuid, %s::bigint, %s)', p_key, p_branch, p_after, p_limit))::jsonb
$$;

create or replace function pg_temp.t_count(p_uid uuid, p_from_where text)
returns bigint
language sql
as $$
  select pg_temp.t_call(p_uid, format('(select count(*) from %s)', p_from_where))::bigint
$$;

-- ---------------------------------------------------------------- the test

do $$
declare
  t0      constant timestamptz := '2026-01-01 10:00:00+00';
  b_a1    constant uuid := '00000000-0000-0000-0000-0000000000b1';   -- org A seat 1, first installation
  b_a2    constant uuid := '00000000-0000-0000-0000-0000000000b2';   -- org A seat 2
  b_a3    constant uuid := '00000000-0000-0000-0000-0000000000b3';   -- org A seat 1 after a reinstall (greater than b_a2)
  b_b1    constant uuid := '00000000-0000-0000-0000-0000000000c1';   -- org B seat 1
  r1      constant uuid := '00000000-0000-0000-0000-0000000000e1';
  r2      constant uuid := '00000000-0000-0000-0000-0000000000e2';
  r3      constant uuid := '00000000-0000-0000-0000-0000000000e3';
  r4      constant uuid := '00000000-0000-0000-0000-0000000000e4';
  r5      constant uuid := '00000000-0000-0000-0000-0000000000e5';
  r6      constant uuid := '00000000-0000-0000-0000-0000000000e6';
  r7      constant uuid := '00000000-0000-0000-0000-0000000000e7';
  k_a text;
  k_b text;
  org_a uuid;
  org_b uuid;
  u_a1 uuid;
  u_a2 uuid;
  u_b1 uuid;
  u_x  uuid := gen_random_uuid();
  r jsonb;
  m jsonb;
  v_item jsonb;
  v_items jsonb;
  v_n bigint;
  v_total bigint;
  v_seq1 bigint;
  v_ping1 bigint;
  v_ping2 bigint;
  v_after bigint;
  v_last bigint;
  v_got bigint;
  v_pages int;
  v_tbl text;
begin
  -- 1. organisations -------------------------------------------------------------------------------------------
  select min(c.license_key) into k_a from public.qt_create_org('selftest notebook A', 2, array['st-a1@selftest.invalid', 'st-a2@selftest.invalid']) c;
  select min(c.license_key) into k_b from public.qt_create_org('selftest notebook B', 1, array['st-b1@selftest.invalid']) c;
  select l.org_id into org_a from public.licenses l where l.label = 'selftest notebook A';
  select l.org_id into org_b from public.licenses l where l.label = 'selftest notebook B';
  select mm.user_id into u_a1 from public.sn_members mm where mm.org_id = org_a and mm.seat_no = 1;
  select mm.user_id into u_a2 from public.sn_members mm where mm.org_id = org_a and mm.seat_no = 2;
  select mm.user_id into u_b1 from public.sn_members mm where mm.org_id = org_b and mm.seat_no = 1;
  perform pg_temp.t_ok(k_a ~ '^Q3-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' and k_a <> k_b, 'qt_create_org returns a license key in the Q3-XXXX-XXXX-XXXX shape, different per organisation');
  perform pg_temp.t_ok(u_a1 is not null and u_a2 is not null and u_b1 is not null, 'one login (seat) per computer was created');
  perform pg_temp.t_ok(
    not exists (select 1 from public.licenses l where l.key_hash = k_a) and exists (select 1 from public.licenses l where l.org_id = org_a and l.key_hash = public.qt_license_hash(k_a)),
    'the license key is stored only as its hash');

  -- 2. anon and signed-in strangers are refused ------------------------------------------------------------------
  perform pg_temp.t_expect(null, 'public.sn_now()', '42501', 'anon cannot call sn_now', 'anon');
  perform pg_temp.t_expect(null, pg_temp.t_push_expr(k_a, b_a1, jsonb_build_array(pg_temp.t_item('bill', r1, 0, 'hash-anon-1', t0))), '42501', 'anon cannot call sn_push', 'anon');
  perform pg_temp.t_expect(null, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a1), '42501', 'anon cannot call sn_pull', 'anon');
  perform pg_temp.t_expect(null, format('public.sn_manifest(%L, %L::uuid, ''bill'', null, 10)', k_a, b_a1), '42501', 'anon cannot call sn_manifest', 'anon');
  perform pg_temp.t_expect(null, format('public.sn_activate(%L, %L::uuid, ''Anon'', ''AN'', '''', false)', k_a, b_a1), '42501', 'anon cannot call sn_activate', 'anon');
  foreach v_tbl in array array['sn_members', 'sn_branches', 'sn_records', 'sn_history', 'sn_ping', 'licenses'] loop
    perform pg_temp.t_expect(null, format('(select count(*) from public.%I)', v_tbl), '42501', 'anon cannot read ' || v_tbl, 'anon');
  end loop;
  perform pg_temp.t_expect(u_a1, format('public.sn_member_org(%L, null)', k_a), '42501', 'a signed-in seat cannot call the internal sn_member_org');
  perform pg_temp.t_expect(u_a1, 'public.sn_name_norm(''x'')', '42501', 'a signed-in seat cannot call sn_name_norm');
  perform pg_temp.t_expect(u_a1, format('public.sn_history_add(%L::uuid, ''bill'', %L::uuid, 1, ''{}''::jsonb, null::uuid, now(), ''superseded'')', org_a, r1), '42501', 'a signed-in seat cannot call sn_history_add');
  perform pg_temp.t_expect(u_a1, '(select count(*) from public.qt_create_org(''x'', 1))', '42501', 'a signed-in seat cannot call the owner function qt_create_org');
  perform pg_temp.t_expect(u_x, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a1), 'Q3A01', 'a signed-in user who is in no organisation is refused (not_member)');
  perform pg_temp.t_expect(null, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a1), 'Q3A01', 'a request with no signed-in user is refused (not_member)');
  perform pg_temp.t_expect(u_a1, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', 'Q3-QQQQ-RRRR-SSSS', b_a1), 'Q3L01', 'a wrong license key is refused (invalid_license)');
  perform pg_temp.t_expect(u_a1, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_b, b_a1), 'Q3L01', 'another organisation key does not work for this seat (invalid_license)');
  perform pg_temp.t_expect(u_a1, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a1), 'Q3M01', 'a seat that has not activated has no branch (unknown_branch)');

  -- 3. activation ------------------------------------------------------------------------------------------------
  perform pg_temp.t_expect(u_a1, format('public.sn_activate(%L, %L::uuid, '''', ''BLR'', ''PC-1'', false)', k_a, b_a1), 'Q3I01', 'a blank branch name is refused');
  perform pg_temp.t_expect(u_a1, format('public.sn_activate(%L, %L::uuid, ''Bengaluru'', ''bad prefix!'', ''PC-1'', false)', k_a, b_a1), 'Q3I01', 'a malformed PO prefix is refused');
  r := pg_temp.t_call(u_a1, format('public.sn_activate(%L, %L::uuid, ''Bengaluru'', ''blr'', ''PC-1'', false)', k_a, b_a1))::jsonb;
  perform pg_temp.t_ok((r ->> 'org_id')::uuid = org_a and (r ->> 'seat_no')::int = 1 and r -> 'branches' -> 0 ->> 'po_prefix' = 'BLR' and r ? 'server_time' and r ? 'max_server_seq',
    'seat 1 activates (prefix upper-cased, org id, seat number, server time and max_server_seq returned)');
  perform pg_temp.t_expect(u_a2, format('public.sn_activate(%L, %L::uuid, ''  BENGALURU '', ''MYS'', '''', false)', k_a, b_a2), 'Q3B04', 'the same branch name (any case or spacing) is refused (name_taken)');
  perform pg_temp.t_expect(u_a2, format('public.sn_activate(%L, %L::uuid, ''Mysuru'', ''blr'', '''', false)', k_a, b_a2), 'Q3B02', 'a PO prefix already used is refused (prefix_taken)');
  perform pg_temp.t_expect(u_b1, format('public.sn_activate(%L, %L::uuid, ''Hub'', ''HUB'', '''', false)', k_b, b_a1), 'Q3B03', 'a branch id that belongs to another organisation is refused (branch_conflict)');
  perform pg_temp.t_call(u_a2, format('public.sn_activate(%L, %L::uuid, ''Mysuru'', ''MYS'', ''PC-2'', false)', k_a, b_a2));
  perform pg_temp.t_expect(u_a1, format('public.sn_activate(%L, %L::uuid, ''Other'', ''OTH'', '''', false)', k_a, b_a3), 'Q3B05', 'a seat that already has a branch cannot take a second one without takeover (seat_in_use)');
  perform pg_temp.t_ok(pg_temp.t_call(u_a2, format('public.sn_branch_name_free(%L, ''bengaluru'', null)', k_a)) = 'false', 'sn_branch_name_free says a used name is not free');
  perform pg_temp.t_ok(pg_temp.t_call(u_a2, format('public.sn_branch_name_free(%L, ''Hubli'', null)', k_a)) = 'true', 'sn_branch_name_free says an unused name is free');
  perform pg_temp.t_ok(pg_temp.t_call(u_a2, format('public.sn_branch_name_free(%L, ''Mysuru'', %L::uuid)', k_a, b_a2)) = 'true', 'my own branch name does not count against me');
  perform pg_temp.t_expect(u_a2, format('public.sn_rename_branch(%L, %L::uuid, ''Bengaluru '')', k_a, b_a2), 'Q3B04', 'renaming to a name already used is refused');
  r := pg_temp.t_call(u_a2, format('public.sn_rename_branch(%L, %L::uuid, ''Mysuru South'')', k_a, b_a2))::jsonb;
  perform pg_temp.t_ok(r ->> 'name' = 'Mysuru South' and exists (select 1 from public.sn_branches b where b.branch_id = b_a2 and b.name_norm = 'mysuru south'), 'a branch can be renamed (normalised name updated)');
  r := pg_temp.t_call(u_a1, format('public.sn_activate(%L, %L::uuid, ''Bengaluru'', ''BLR'', ''PC-1 new'', true)', k_a, b_a3))::jsonb;
  perform pg_temp.t_ok(
    not exists (select 1 from public.sn_branches b where b.branch_id = b_a1)
    and exists (select 1 from public.sn_branches b where b.branch_id = b_a3 and b.name_norm = 'bengaluru' and b.po_prefix = 'BLR')
    and exists (select 1 from public.sn_members mm where mm.user_id = u_a1 and mm.branch_id = b_a3),
    'takeover: the old branch row is removed, its name and prefix are reused by the new installation, the seat points at the new branch');
  r := pg_temp.t_call(u_b1, format('public.sn_activate(%L, %L::uuid, ''Bengaluru'', ''BLR'', ''PC-B'', false)', k_b, b_b1))::jsonb;
  perform pg_temp.t_ok((r ->> 'org_id')::uuid = org_b, 'another organisation may use the same branch name and prefix');
  r := pg_temp.t_call(u_a1, format('public.sn_list_branches(%L, %L::uuid)', k_a, b_a3))::jsonb;
  perform pg_temp.t_ok(jsonb_array_length(r) = 2, 'sn_list_branches shows only my own organisation (2 branches)');

  -- 4. push --------------------------------------------------------------------------------------------------------
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, '[]'::jsonb), 'Q3I01', 'an empty push is refused');
  select jsonb_agg(pg_temp.t_item('bill', gen_random_uuid(), 0, 'hash-bulk-' || g::text, t0)) into v_items from generate_series(1, 201) g;
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, v_items), 'Q3I03', 'more than 200 items in one push is refused (too_many)');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('nope', r7, 0, 'hash-bad-kind', t0))), 'Q3I01', 'an unknown kind is refused');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r7, -1, 'hash-bad-base', t0))), 'Q3I01', 'a negative base_version is refused');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r7, 0, 'abc', t0))), 'Q3I01', 'a payload_hash shorter than 8 characters is refused');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r7, 0, 'hash-array-1', t0, false, '[]'::jsonb))), 'Q3I01', 'a payload that is not an object is refused');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a2, jsonb_build_array(pg_temp.t_item('bill', r7, 0, 'hash-wrong-br', t0))), 'Q3M01', 'a seat cannot push as another seat branch (unknown_branch)');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r7, 0, 'hash-good-r7', t0), pg_temp.t_item('nope', r6, 0, 'hash-bad-r6', t0))), 'Q3I01', 'a push with one bad item fails as a whole');
  perform pg_temp.t_ok(not exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r7), 'all or nothing: the good item of the failed push was not written');

  select coalesce(max(p.seq), 0) into v_ping1 from public.sn_ping p where p.org_id = org_a;
  r := pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r1, 0, 'hash-r1-v1', t0)));
  v_seq1 := (r -> 0 ->> 'server_seq')::bigint;
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'accepted' and (r -> 0 ->> 'version')::int = 1 and v_seq1 > 0, 'a new record is accepted as version 1 with a server_seq');
  select p.seq into v_ping2 from public.sn_ping p where p.org_id = org_a;
  perform pg_temp.t_ok(v_ping2 > v_ping1, 'the push rang the doorbell (sn_ping.seq went up)');
  v_ping1 := v_ping2;
  r := pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r1, 0, 'hash-r1-v1', t0)));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'noop' and (r -> 0 ->> 'version')::int = 1 and (r -> 0 ->> 'server_seq')::bigint = v_seq1, 'sending the same hash again is a noop (nothing written, same version and server_seq)');
  select p.seq into v_ping2 from public.sn_ping p where p.org_id = org_a;
  perform pg_temp.t_ok(v_ping2 = v_ping1, 'an all-noop push does not ring the doorbell');
  r := pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r1, 1, 'hash-r1-v2', t0 + interval '1 minute')));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'accepted' and (r -> 0 ->> 'version')::int = 2 and (r -> 0 ->> 'server_seq')::bigint > v_seq1, 'base_version = stored version is accepted as version 2 with a newer server_seq');
  perform pg_temp.t_ok((select count(*) from public.sn_history h where h.org_id = org_a and h.rec_id = r1 and h.reason = 'superseded') = 1, 'the replaced version went to history as superseded');

  -- conflict, the incoming (later) edit wins
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r2, 0, 'hash-r2-v1', t0)));
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r2, 1, 'hash-r2-v2', t0 + interval '1 minute')));
  r := pg_temp.t_push(u_a2, k_a, b_a2, jsonb_build_array(pg_temp.t_item('bill', r2, 1, 'hash-r2-b', t0 + interval '2 minutes')));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'won' and (r -> 0 ->> 'version')::int = 3, 'conflict: the later edit coming second wins (outcome won, version + 1)');
  perform pg_temp.t_ok(
    exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r2 and x.payload_hash = 'hash-r2-b' and x.from_branch = b_a2)
    and exists (select 1 from public.sn_history h where h.org_id = org_a and h.rec_id = r2 and h.reason = 'conflict_loser' and h.payload ->> 'h' = 'hash-r2-v2'),
    'the winner is stored; the beaten stored version is kept in history (conflict_loser)');

  -- conflict, the incoming (earlier) edit loses
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r3, 0, 'hash-r3-v1', t0)));
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r3, 1, 'hash-r3-v2', t0 + interval '2 minutes')));
  r := pg_temp.t_push(u_a2, k_a, b_a2, jsonb_build_array(pg_temp.t_item('bill', r3, 1, 'hash-r3-b', t0 + interval '1 minute')));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'lost' and (r -> 0 ->> 'version')::int = 3, 'conflict: the earlier edit arriving second loses (outcome lost, stored version still + 1)');
  perform pg_temp.t_ok(
    exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r3 and x.payload_hash = 'hash-r3-v2')
    and exists (select 1 from public.sn_history h where h.org_id = org_a and h.rec_id = r3 and h.reason = 'conflict_loser' and h.payload ->> 'h' = 'hash-r3-b'),
    'the stored version stays; the loser payload is kept in history (conflict_loser)');

  -- tie on edited_at: the greater branch id wins (b_a3 is greater than b_a2, so b_a2 loses)
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r4, 0, 'hash-r4-v1', t0)));
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r4, 1, 'hash-r4-v2', t0 + interval '1 minute')));
  r := pg_temp.t_push(u_a2, k_a, b_a2, jsonb_build_array(pg_temp.t_item('bill', r4, 1, 'hash-r4-b', t0 + interval '1 minute')));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'lost', 'conflict tie on edited_at: the greater branch id wins');

  -- tombstone and restore
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r5, 0, 'hash-r5-v1', t0)));
  r := pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r5, 1, 'hash-r5-del', t0 + interval '1 minute', true, '{"gone": true}'::jsonb)));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'accepted' and exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r5 and x.deleted and x.version = 2), 'a delete is a tombstone row (deleted = true), the record is kept');
  r := pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r5, 2, 'hash-r5-back', t0 + interval '2 minutes')));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'accepted' and exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r5 and not x.deleted and x.version = 3), 'a restore after a delete is an ordinary new version');
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r5, 3, 'hash-r5-gone', t0 + interval '3 minutes', true, '{"gone": true}'::jsonb)));

  -- history cap: 25 updates in one call keep only the newest 20 history rows
  perform pg_temp.t_push(u_a1, k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r6, 0, 'hash-r6-v1', t0)));
  select jsonb_agg(pg_temp.t_item('bill', r6, g, 'hash-r6-v' || (g + 1)::text, t0 + g * interval '1 second') order by g) into v_items from generate_series(1, 25) g;
  r := pg_temp.t_push(u_a1, k_a, b_a3, v_items);
  perform pg_temp.t_ok(jsonb_array_length(r) = 25 and (r -> 24 ->> 'version')::int = 26, '25 chained updates in one push are all accepted (version 26)');
  perform pg_temp.t_ok((select count(*) from public.sn_history h where h.org_id = org_a and h.rec_id = r6) = 20, 'history is capped at 20 rows per record');

  -- 5. pull and manifest -----------------------------------------------------------------------------------------------
  select count(*) into v_total from public.sn_records x where x.org_id = org_a;
  perform pg_temp.t_ok(v_total >= 6, 'organisation A now holds at least 6 records (' || v_total::text || ')');
  v_after := 0; v_last := 0; v_got := 0; v_pages := 0;
  loop
    r := pg_temp.t_pull(u_a2, k_a, b_a2, v_after, 2);
    v_pages := v_pages + 1;
    for v_item in select e.value from jsonb_array_elements(r -> 'items') e loop
      perform pg_temp.t_ok((v_item ->> 'server_seq')::bigint > v_last, 'pull page ' || v_pages::text || ': server_seq keeps increasing');
      v_last := (v_item ->> 'server_seq')::bigint;
      v_got := v_got + 1;
    end loop;
    exit when not (r ->> 'has_more')::boolean;
    v_after := v_last;
    if v_pages > 200 then
      raise exception 'FAIL  pull cursor did not finish';
    end if;
  end loop;
  perform pg_temp.t_ok(v_got = v_total and v_pages >= 2 and r ? 'server_time', 'paging by server_seq with limit 2 returns every record exactly once (' || v_got::text || ' records, ' || v_pages::text || ' pages)');
  r := pg_temp.t_pull(u_a2, k_a, b_a2, v_last, 200);
  perform pg_temp.t_ok(jsonb_array_length(r -> 'items') = 0 and (r ->> 'has_more')::boolean is false, 'pulling after the last server_seq returns nothing');
  r := pg_temp.t_pull(u_a2, k_a, b_a2, 0, 200);
  perform pg_temp.t_ok(
    jsonb_array_length(r -> 'items') = v_total
    and exists (select 1 from jsonb_array_elements(r -> 'items') e where e.value ->> 'rec_id' = r5::text and (e.value ->> 'deleted')::boolean)
    and (select count(*) from public.sn_records x where x.org_id = org_a) = v_total,
    'a full pull includes tombstones and the pulling seat own records, and deletes nothing');
  perform pg_temp.t_expect(u_a2, format('public.sn_pull(%L, %L::uuid, 0::bigint, 0)', k_a, b_a2), 'Q3I01', 'pull limit 0 is refused');
  perform pg_temp.t_expect(u_a2, format('public.sn_pull(%L, %L::uuid, 0::bigint, 201)', k_a, b_a2), 'Q3I01', 'pull limit 201 is refused');
  perform pg_temp.t_expect(u_a2, format('public.sn_pull(%L, %L::uuid, -1::bigint, 10)', k_a, b_a2), 'Q3I01', 'a negative cursor is refused');

  m := pg_temp.t_call(u_a2, format('public.sn_manifest(%L, %L::uuid, ''bill'', null, 1000)', k_a, b_a2))::jsonb;
  perform pg_temp.t_ok(jsonb_array_length(m) = v_total and not (m -> 0 ? 'payload') and m -> 0 ? 'payload_hash' and m -> 0 ? 'version' and m -> 0 ? 'rec_id', 'the manifest lists every record without payloads');
  m := pg_temp.t_call(u_a2, format('public.sn_manifest(%L, %L::uuid, ''bill'', %L::uuid, 1)', k_a, b_a2, r1))::jsonb;
  perform pg_temp.t_ok(jsonb_array_length(m) = 1 and (m -> 0 ->> 'rec_id')::uuid = r2, 'the manifest pages by rec_id (limit 1 after r1 gives r2)');
  perform pg_temp.t_expect(u_a2, format('public.sn_manifest(%L, %L::uuid, ''nope'', null, 10)', k_a, b_a2), 'Q3I01', 'the manifest refuses an unknown kind');
  perform pg_temp.t_expect(u_a2, format('public.sn_manifest(%L, %L::uuid, ''bill'', null, 1001)', k_a, b_a2), 'Q3I01', 'the manifest refuses a limit over 1000');

  -- 6. isolation between organisations -----------------------------------------------------------------------------------
  r := pg_temp.t_push(u_b1, k_b, b_b1, jsonb_build_array(pg_temp.t_item('bill', r1, 0, 'hash-b-r1-v1', t0)));
  perform pg_temp.t_ok(r -> 0 ->> 'outcome' = 'accepted' and (r -> 0 ->> 'version')::int = 1, 'organisation B may use the same record id: it is a separate record');
  perform pg_temp.t_ok(exists (select 1 from public.sn_records x where x.org_id = org_a and x.rec_id = r1 and x.version = 2 and x.payload_hash = 'hash-r1-v2'), 'organisation A own record with that id is unchanged');
  r := pg_temp.t_pull(u_b1, k_b, b_b1, 0, 200);
  perform pg_temp.t_ok(jsonb_array_length(r -> 'items') = 1, 'organisation B pulls only its own single record');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, 'public.sn_records') = v_total, 'RLS: seat of A reads only A records (' || v_total::text || ')');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, format('public.sn_records where org_id = %L::uuid', org_b)) = 0, 'RLS: seat of A cannot see any B record, even when asking by org id');
  perform pg_temp.t_ok(pg_temp.t_count(u_b1, 'public.sn_records') = 1, 'RLS: seat of B reads only its one record');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, 'public.sn_history') = (select count(*) from public.sn_history h where h.org_id = org_a), 'RLS: seat of A reads only A history');
  perform pg_temp.t_ok(pg_temp.t_count(u_b1, 'public.sn_history') = 0, 'RLS: B has no history and does not see A history');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, 'public.sn_branches') = 2 and pg_temp.t_count(u_b1, 'public.sn_branches') = 1, 'RLS: each organisation sees only its own branches');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, 'public.sn_members') = 1 and pg_temp.t_count(u_b1, 'public.sn_members') = 1, 'RLS: a seat sees only its own membership row');
  perform pg_temp.t_ok(pg_temp.t_count(u_a1, 'public.sn_ping') = 1 and pg_temp.t_count(u_a1, format('public.sn_ping where org_id = %L::uuid', org_b)) = 0, 'RLS: a seat sees only its own organisation doorbell row');
  perform pg_temp.t_expect_dml(u_a1, format('insert into public.sn_records (org_id, kind, rec_id, payload, payload_hash, edited_at) values (%L::uuid, ''bill'', gen_random_uuid(), ''{}''::jsonb, ''hash-direct'', now())', org_a), '42501', 'a seat cannot insert into sn_records directly');
  perform pg_temp.t_expect_dml(u_a1, 'update public.sn_records set version = 99', '42501', 'a seat cannot update sn_records directly');
  perform pg_temp.t_expect_dml(u_a1, 'delete from public.sn_records', '42501', 'a seat cannot delete from sn_records directly');
  perform pg_temp.t_expect_dml(u_a1, 'delete from public.sn_history', '42501', 'a seat cannot delete history directly');
  perform pg_temp.t_expect_dml(u_a1, format('insert into public.sn_ping (org_id, seq) values (%L::uuid, 1)', org_b), '42501', 'a seat cannot ring another organisation doorbell directly');
  perform pg_temp.t_expect_dml(u_a1, format('update public.sn_members set org_id = %L::uuid', org_b), '42501', 'a seat cannot move itself to another organisation');
  perform pg_temp.t_expect_dml(u_a1, format('update public.sn_branches set po_prefix = ''ZZ'' where org_id = %L::uuid', org_a), '42501', 'a seat cannot edit branches directly');

  -- 7. suspended license -------------------------------------------------------------------------------------------------
  perform public.qt_set_license_status('selftest notebook A', 'suspended');
  perform pg_temp.t_ok(exists (select 1 from auth.users u where u.id = u_a1 and u.banned_until is not null), 'suspending a license bans its logins');
  perform pg_temp.t_expect(u_a1, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a3), 'Q3L01', 'a suspended license is refused on pull (invalid_license)');
  perform pg_temp.t_expect(u_a1, pg_temp.t_push_expr(k_a, b_a3, jsonb_build_array(pg_temp.t_item('bill', r7, 0, 'hash-suspended', t0))), 'Q3L01', 'a suspended license is refused on push (invalid_license)');
  perform pg_temp.t_ok(pg_temp.t_count(u_b1, 'public.sn_records') = 1, 'the other organisation is not affected by the suspension');
  perform public.qt_set_license_status('selftest notebook A', 'active');
  perform pg_temp.t_ok(not exists (select 1 from auth.users u where u.id = u_a1 and u.banned_until is not null), 'reactivating clears the ban');
  r := pg_temp.t_call(u_a1, format('public.sn_touch(%L, %L::uuid)', k_a, b_a3))::jsonb;
  perform pg_temp.t_ok(r ? 'server_time', 'after reactivation the same seat works again without activating again');

  -- 8. revoked seat ------------------------------------------------------------------------------------------------------
  perform public.qt_revoke_seat('selftest notebook A', 2);
  perform pg_temp.t_expect(u_a2, format('public.sn_pull(%L, %L::uuid, 0::bigint, 10)', k_a, b_a2), 'Q3A01', 'a revoked seat is refused (not_member)');
  perform pg_temp.t_ok(
    not exists (select 1 from public.sn_branches b where b.branch_id = b_a2)
    and (select count(*) from public.sn_records x where x.org_id = org_a) = v_total,
    'revoking a seat removes its branch registration but keeps the bills it synced');

  -- 9. Realtime doorbell -------------------------------------------------------------------------------------------------
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime') then
    perform pg_temp.t_ok(exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'sn_ping'), 'sn_ping is in the supabase_realtime publication (file 16)');
    perform pg_temp.t_ok(not exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename in ('sn_records', 'sn_history', 'sn_members', 'sn_branches', 'licenses')), 'no data table is published to Realtime, only the doorbell');
  else
    raise notice 'SKIP  no supabase_realtime publication in this database (not Supabase): the doorbell checks were not run';
  end if;

  raise notice 'ALL QUOT3 SHARED-NOTEBOOK SELF-TESTS PASSED';
end
$$;

rollback;
