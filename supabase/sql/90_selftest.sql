-- Quot3 sync postbox - 90: SELF-TEST             (Phase 51)
-- Run AFTER 01..05, in a SCRATCH project (or any database you can throw away). Everything happens inside one
-- transaction that ends in ROLLBACK, so no test data is kept. Each check prints "PASS ..." (Messages / Notices); the first
-- failure stops the script with "FAIL ...". A clean run ends with: ALL QUOT3 SYNC SELF-TESTS PASSED
--
-- Supabase SQL editor: paste the whole file and press Run. The role used must be allowed to "set role anon" (postgres is).

begin;

create or replace function pg_temp.t_expect(p_sql text, p_state text, p_label text, p_role text default null)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    if p_role is not null then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql;
    reset role;
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
  return v_msg;
end
$$;

do $$
declare
  k_a   constant text := 'Q3-AAAA-BBBB-CCCC';   -- org A, max 2 branches
  k_o   constant text := 'Q3-DDDD-EEEE-FFFF';   -- org O (another organisation)
  k_s   constant text := 'Q3-GGGG-HHHH-2222';   -- suspended license
  k_x   constant text := 'Q3-QQQQ-RRRR-SSSS';   -- well-formed, never issued
  b1    constant uuid := '00000000-0000-0000-0000-0000000000b1';
  b2    constant uuid := '00000000-0000-0000-0000-0000000000b2';
  b3    constant uuid := '00000000-0000-0000-0000-0000000000b3';
  bo    constant uuid := '00000000-0000-0000-0000-0000000000c1';
  bill  constant uuid := '00000000-0000-0000-0000-0000000000d1';
  r jsonb;
  m1 text; m2 text; m3 text;
  v_ids jsonb;
  v_first bigint;
  v_n bigint;
  v_arr bigint[];
  item_ok jsonb;
begin
  insert into public.licenses (org_id, key_hash, label, max_branches) values
    ('00000000-0000-0000-0000-0000000000a1', public.qt_license_hash(k_a), 'selftest A', 2),
    ('00000000-0000-0000-0000-0000000000a2', public.qt_license_hash(k_o), 'selftest O', 5);
  insert into public.licenses (org_id, key_hash, label, status) values
    ('00000000-0000-0000-0000-0000000000a3', public.qt_license_hash(k_s), 'selftest suspended', 'suspended');

  -- registration ---------------------------------------------------------------------------------------------
  r := public.qt_register_branch(k_a, b1, 'Bengaluru', 'blr-', 'PC-1');
  assert r ->> 'org_id' = '00000000-0000-0000-0000-0000000000a1', 'org id returned';
  assert length(r ->> 'kdf_salt') >= 22 and position(E'\n' in (r ->> 'kdf_salt')) = 0, 'kdf_salt is clean base64';
  assert jsonb_array_length(r -> 'branches') = 1 and r -> 'branches' -> 0 ->> 'po_prefix' = 'BLR-', 'prefix upper-cased';
  raise notice 'PASS  register first branch (prefix upper-cased, salt returned)';

  r := public.qt_register_branch(k_a, b2, 'Pune', 'PUNE', '');
  assert jsonb_array_length(r -> 'branches') = 2, 'two branches listed';
  raise notice 'PASS  register second branch';

  perform pg_temp.t_expect(format('select public.qt_register_branch(%L, %L, ''Third'', ''THR'', '''')', k_a, b3), 'Q3B01', 'third branch refused (branch_limit)');
  perform pg_temp.t_expect(format('select public.qt_register_branch(%L, %L, ''Pune'', ''BLR-'', '''')', k_a, b2), 'Q3B02', 'prefix already used by another branch (prefix_taken)');
  perform pg_temp.t_expect(format('select public.qt_register_branch(%L, %L, ''X'', ''bad prefix!'', '''')', k_a, b1), 'Q3I01', 'malformed prefix refused');
  perform pg_temp.t_expect(format('select public.qt_register_branch(%L, %L, '''', ''OK'', '''')', k_a, b1), 'Q3I01', 'blank name refused');
  perform pg_temp.t_expect(format('select public.qt_register_branch(%L, %L, ''Hijack'', ''HJ'', '''')', k_o, b1), 'Q3B03', 'a branch id of another organisation is refused (branch_conflict)');

  r := public.qt_register_branch(k_a, b1, 'Bengaluru HQ', 'BLR-', 'PC-9');
  assert jsonb_array_length(r -> 'branches') = 2 and exists (select 1 from public.branches where branch_id = b1 and name = 'Bengaluru HQ'), 're-register updates in place';
  raise notice 'PASS  re-registering a branch updates it and does not use a new seat';

  -- generic license errors -----------------------------------------------------------------------------------
  m1 := pg_temp.t_expect(format('select public.qt_list_branches(%L, %L)', 'not-a-key', b1), 'Q3L01', 'malformed key refused');
  m2 := pg_temp.t_expect(format('select public.qt_list_branches(%L, %L)', k_x, b1), 'Q3L01', 'unknown key refused');
  m3 := pg_temp.t_expect(format('select public.qt_list_branches(%L, %L)', k_s, b1), 'Q3L01', 'suspended license refused');
  assert m1 = 'invalid_license' and m1 = m2 and m2 = m3, 'the three refusals are indistinguishable';
  raise notice 'PASS  malformed, unknown and suspended licenses give the same message';
  perform public.qt_register_branch(k_o, bo, 'Other org', 'OTH', '');
  perform pg_temp.t_expect(format('select public.qt_list_branches(%L, %L)', lower(k_a), bo), 'Q3M01', 'branch of another organisation is not accepted (unknown_branch)');
  assert jsonb_array_length(public.qt_list_branches(' ' || lower(k_a) || ' ', b1)) = 2, 'key is trimmed and case-insensitive';
  raise notice 'PASS  list branches (key trimmed and case-insensitive)';

  -- push -----------------------------------------------------------------------------------------------------
  item_ok := jsonb_build_object('to_branch', b2, 'bill_id', bill, 'op', 'upsert', 'revision', 3,
                                'updated_at', '2026-10-09T10:00:00Z',
                                'nonce', encode('\x000102030405060708090a0b'::bytea, 'base64'),
                                'ciphertext', encode('\x00112233445566778899aabbccddeeff0011'::bytea, 'base64'));
  v_ids := public.qt_push(k_a, b1, jsonb_build_array(item_ok, item_ok || jsonb_build_object('revision', 4, 'op', 'delete')));
  assert jsonb_array_length(v_ids -> 'ids') = 2, 'two ids returned';
  v_first := (v_ids -> 'ids' ->> 0)::bigint;
  raise notice 'PASS  push two items to the other branch';

  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('to_branch', bo))::text), 'Q3M01', 'cannot push to another organisation');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('to_branch', b1))::text), 'Q3M01', 'cannot push to yourself');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('nonce', 'AAAA'))::text), 'Q3I01', 'wrong nonce length refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('ciphertext', '!!!'))::text), 'Q3I01', 'bad base64 refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('op', 'merge'))::text), 'Q3I01', 'unknown op refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('updated_at', 'yesterday-ish'))::text), 'Q3I01', 'bad timestamp refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, ''[]''::jsonb)', k_a, b1), 'Q3I01', 'empty push refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, ''{}''::jsonb)', k_a, b1), 'Q3I01', 'non-array push refused');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, (select jsonb_agg(%L::jsonb) from generate_series(1, 201)))', k_a, b1, item_ok::text), 'Q3I03', '201 items refused (too_many)');
  perform pg_temp.t_expect(format('select public.qt_push(%L, %L, %L::jsonb)', k_a, b1, jsonb_build_array(item_ok || jsonb_build_object('ciphertext', repeat('QUFB', 400000)))::text), 'Q3I02', 'ciphertext over 1 MB refused (too_large)');
  select count(*) into v_n from public.postbox;
  assert v_n = 2, 'rejected pushes stored nothing';
  raise notice 'PASS  rejected pushes stored nothing (all or nothing)';

  -- pull / ack -----------------------------------------------------------------------------------------------
  r := public.qt_pull(k_a, b2, 0, 100);
  assert jsonb_array_length(r -> 'items') = 2 and (r ->> 'has_more')::boolean = false, 'pull returns both';
  assert (r -> 'items' -> 0 ->> 'id')::bigint = v_first and r -> 'items' -> 0 ->> 'from_branch' = b1::text, 'oldest first, sender shown';
  assert decode(r -> 'items' -> 0 ->> 'ciphertext', 'base64') = '\x00112233445566778899aabbccddeeff0011'::bytea, 'ciphertext round-trips';
  assert r -> 'items' -> 1 ->> 'op' = 'delete' and (r -> 'items' -> 1 ->> 'revision')::int = 4, 'second item intact';
  raise notice 'PASS  pull returns the two items, oldest first, ciphertext intact';

  assert jsonb_array_length(public.qt_pull(k_a, b2, v_first, 100) -> 'items') = 1, 'after_id skips the first';
  r := public.qt_pull(k_a, b2, 0, 1);
  assert jsonb_array_length(r -> 'items') = 1 and (r ->> 'has_more')::boolean = true, 'limit 1 reports has_more';
  assert jsonb_array_length(public.qt_pull(k_a, b1, 0, 100) -> 'items') = 0, 'the sender has nothing waiting';
  raise notice 'PASS  cursor, limit / has_more, and a sender sees only its own mailbox';

  assert (public.qt_ack(k_a, b1, array[v_first]) ->> 'deleted')::int = 0, 'sender cannot ack the recipient''s rows';
  select count(*) into v_n from public.postbox;
  assert v_n = 2, 'rows still there';
  select array_agg(x::bigint) into v_arr from jsonb_array_elements_text(v_ids -> 'ids') as t(x);
  assert (public.qt_ack(k_o, bo, v_arr) ->> 'deleted')::int = 0, 'another organisation cannot ack either';
  assert (public.qt_ack(k_a, b2, v_arr) ->> 'deleted')::int = 2, 'the recipient acks both';
  select count(*) into v_n from public.postbox;
  assert v_n = 0, 'acknowledged rows are gone';
  assert (public.qt_ack(k_a, b2, array[]::bigint[]) ->> 'deleted')::int = 0, 'empty ack is a no-op';
  raise notice 'PASS  ack: only the addressed branch can delete, and the rows are gone afterwards';

  assert (public.qt_touch(k_a, b1) ->> 'ok')::boolean, 'touch ok';
  raise notice 'PASS  touch';

  -- sweep ----------------------------------------------------------------------------------------------------
  insert into public.postbox (org_id, from_branch, to_branch, bill_id, op, revision, updated_at, nonce, ciphertext, expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', b1, b2, bill, 'upsert', 1, now(), '\x000102030405060708090a0b'::bytea,
          '\x00112233445566778899aabbccddeeff0011'::bytea, now() - interval '1 day'),
         ('00000000-0000-0000-0000-0000000000a1', b1, b2, bill, 'upsert', 2, now(), '\x000102030405060708090a0b'::bytea,
          '\x00112233445566778899aabbccddeeff0011'::bytea, now() + interval '1 day');
  assert public.qt_sweep() = 1, 'sweep removes exactly the expired row';
  select count(*) into v_n from public.postbox;
  assert v_n = 1, 'the unexpired row stays';
  raise notice 'PASS  sweep removes only expired rows';
end
$$;

-- direct access is closed ------------------------------------------------------------------------------------
select pg_temp.t_expect('select count(*) from public.licenses', '42501', 'anon cannot read licenses', 'anon');
select pg_temp.t_expect('select count(*) from public.branches', '42501', 'anon cannot read branches', 'anon');
select pg_temp.t_expect('select count(*) from public.postbox', '42501', 'anon cannot read the postbox', 'anon');
select pg_temp.t_expect('insert into public.postbox (org_id) values (gen_random_uuid())', '42501', 'anon cannot write the postbox', 'anon');
select pg_temp.t_expect('select count(*) from public.postbox', '42501', 'authenticated cannot read the postbox', 'authenticated');
select pg_temp.t_expect('select public.qt_sweep()', '42501', 'anon cannot run the sweep', 'anon');
select pg_temp.t_expect('select public.qt_auth(''x'', null)', '42501', 'anon cannot call the internal license check', 'anon');
select pg_temp.t_expect('select public.qt_license_hash(''x'')', '42501', 'anon cannot call the hash helper', 'anon');
select pg_temp.t_expect('select public.qt_list_branches(''bad'', null)', 'Q3L01', 'anon CAN call the public RPCs (and gets the generic refusal)', 'anon');

do $$
declare
  v_tables int;
  v_rls int;
begin
  select count(*), count(*) filter (where c.relrowsecurity) into v_tables, v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('licenses', 'branches', 'postbox');
  assert v_tables = 3 and v_rls = 3, 'RLS is enabled on all three tables';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('licenses', 'branches', 'postbox')), 'there are no policies on the three tables';
  raise notice 'PASS  RLS is on for licenses, branches and postbox, and there are no policies';
  raise notice 'ALL QUOT3 SYNC SELF-TESTS PASSED';
end
$$;

rollback;
