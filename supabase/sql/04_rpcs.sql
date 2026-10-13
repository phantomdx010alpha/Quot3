-- Quot3 sync postbox - 04: RPC functions       (Phase 51)
--
-- The ONLY door into the tables. Every function is SECURITY DEFINER with an EMPTY search_path (everything is schema
-- qualified), validates the license first, and raises the same generic error ('invalid_license', SQLSTATE Q3L01) for a
-- malformed key, an unknown key and a suspended license, so a caller cannot tell which it was.
--
-- Error codes (SQLSTATE -> message):  Q3L01 invalid_license | Q3M01 unknown_branch | Q3B01 branch_limit
--   Q3B02 prefix_taken | Q3B03 branch_conflict | Q3I01 invalid_input | Q3I02 too_large | Q3I03 too_many
--
-- Binary values travel as BASE64 TEXT inside JSON (no line breaks): nonce, ciphertext, kdf_salt.
-- Changing a function's argument list later needs "drop function" first (create or replace cannot change it).

-- SHA-256 of the normalised key with a fixed domain-separation prefix, as lower-case hex. The generator script
-- (scripts/generate-license.mjs) computes exactly the same value.
create or replace function public.qt_license_hash(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to('quot3-license:' || p_key, 'UTF8'), 'sha256'), 'hex')
$$;

-- Internal: validates the license (and, when given, that the branch belongs to it). Returns the org id.
create or replace function public.qt_auth(p_license text, p_branch_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_org uuid;
begin
  v_key := pg_catalog.upper(pg_catalog.btrim(coalesce(p_license, '')));
  if v_key !~ '^Q3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$' then
    raise exception 'invalid_license' using errcode = 'Q3L01';
  end if;
  select l.org_id into v_org
    from public.licenses l
   where l.key_hash = public.qt_license_hash(v_key) and l.status = 'active';
  if v_org is null then
    raise exception 'invalid_license' using errcode = 'Q3L01';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.branch_id = p_branch_id and b.org_id = v_org
  ) then
    raise exception 'unknown_branch' using errcode = 'Q3M01';
  end if;
  return v_org;
end
$$;

-- Joins (or updates) a branch. Returns { org_id, kdf_salt (base64), branches: [{ branch_id, name, po_prefix }] }.
create or replace function public.qt_register_branch(
  p_license text, p_branch_id uuid, p_name text, p_po_prefix text, p_device text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_prefix text;
  v_device text;
  v_max int;
  v_salt bytea;
  v_existing_org uuid;
  v_count int;
begin
  v_org := public.qt_auth(p_license, null);
  if p_branch_id is null then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_name   := pg_catalog.btrim(coalesce(p_name, ''));
  v_prefix := pg_catalog.upper(pg_catalog.btrim(coalesce(p_po_prefix, '')));
  v_device := pg_catalog.btrim(coalesce(p_device, ''));
  if pg_catalog.char_length(v_name) not between 1 and 80
     or pg_catalog.char_length(v_device) > 80
     or v_prefix !~ '^[A-Z0-9_/-]{1,8}$' then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;

  -- Serialise registrations of one organisation, so two branches cannot both take the last seat or the same prefix.
  select l.max_branches, l.kdf_salt into v_max, v_salt from public.licenses l where l.org_id = v_org for update;

  select b.org_id into v_existing_org from public.branches b where b.branch_id = p_branch_id;
  if v_existing_org is not null and v_existing_org <> v_org then
    raise exception 'branch_conflict' using errcode = 'Q3B03';
  end if;

  if exists (
    select 1 from public.branches b
     where b.org_id = v_org and b.po_prefix = v_prefix and b.branch_id <> p_branch_id
  ) then
    raise exception 'prefix_taken' using errcode = 'Q3B02';
  end if;

  if v_existing_org is null then
    select count(*) into v_count from public.branches b where b.org_id = v_org;
    if v_count >= v_max then
      raise exception 'branch_limit' using errcode = 'Q3B01';
    end if;
    insert into public.branches (branch_id, org_id, name, po_prefix, device_name)
    values (p_branch_id, v_org, v_name, v_prefix, v_device);
  else
    update public.branches
       set name = v_name, po_prefix = v_prefix, device_name = v_device, last_seen_at = now()
     where branch_id = p_branch_id;
  end if;

  return jsonb_build_object(
    'org_id', v_org,
    'kdf_salt', pg_catalog.translate(pg_catalog.encode(v_salt, 'base64'), E'\n', ''),
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object('branch_id', b.branch_id, 'name', b.name, 'po_prefix', b.po_prefix) order by b.po_prefix), '[]'::jsonb)
        from public.branches b where b.org_id = v_org
    )
  );
exception
  when unique_violation then
    raise exception 'prefix_taken' using errcode = 'Q3B02';
end
$$;

-- The organisation's branches (History branch filter, fan-out list).
create or replace function public.qt_list_branches(p_license text, p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := public.qt_auth(p_license, p_branch_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('branch_id', b.branch_id, 'name', b.name, 'po_prefix', b.po_prefix, 'last_seen_at', b.last_seen_at) order by b.po_prefix), '[]'::jsonb)
      from public.branches b where b.org_id = v_org
  );
end
$$;

-- Puts encrypted items in other branches' mailboxes. All or nothing: one bad item rejects the whole call.
-- p_items: [{ to_branch, bill_id, op, revision, updated_at, nonce (base64), ciphertext (base64) }]  (1..200 items,
-- 1 MB of ciphertext each, 8 MB of JSON in total). Returns { ids: [bigint] } in input order.
create or replace function public.qt_push(p_license text, p_branch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_n int;
  v_item jsonb;
  v_to uuid;
  v_bill uuid;
  v_op text;
  v_rev int;
  v_upd timestamptz;
  v_nonce bytea;
  v_ct bytea;
  v_id bigint;
  v_ids bigint[] := '{}';
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  v_org := public.qt_auth(p_license, p_branch_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  elsif v_n > 200 then
    raise exception 'too_many' using errcode = 'Q3I03';
  end if;
  if pg_catalog.char_length(p_items::text) > 8388608 then
    raise exception 'too_large' using errcode = 'Q3I02';
  end if;

  for v_item in select e from jsonb_array_elements(p_items) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if coalesce(v_item ->> 'to_branch', '') !~ v_uuid_re or coalesce(v_item ->> 'bill_id', '') !~ v_uuid_re then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    v_to   := (v_item ->> 'to_branch')::uuid;
    v_bill := (v_item ->> 'bill_id')::uuid;
    v_op   := v_item ->> 'op';
    if v_op is null or v_op not in ('upsert', 'delete') then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if coalesce(v_item ->> 'revision', '') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    v_rev := (v_item ->> 'revision')::int;
    begin
      v_upd := (v_item ->> 'updated_at')::timestamptz;
    exception when others then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end;
    if v_upd is null then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if coalesce(v_item ->> 'nonce', '') !~ '^[A-Za-z0-9+/]+={0,2}$'
       or coalesce(v_item ->> 'ciphertext', '') !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    begin
      v_nonce := pg_catalog.decode(v_item ->> 'nonce', 'base64');
      v_ct    := pg_catalog.decode(v_item ->> 'ciphertext', 'base64');
    exception when others then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end;
    if pg_catalog.octet_length(v_nonce) <> 12 or pg_catalog.octet_length(v_ct) < 16 then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if pg_catalog.octet_length(v_ct) > 1048576 then
      raise exception 'too_large' using errcode = 'Q3I02';
    end if;
    -- The recipient must be another branch of the SAME organisation.
    if v_to = p_branch_id or not exists (
      select 1 from public.branches b where b.branch_id = v_to and b.org_id = v_org
    ) then
      raise exception 'unknown_branch' using errcode = 'Q3M01';
    end if;

    insert into public.postbox (org_id, from_branch, to_branch, bill_id, op, revision, updated_at, nonce, ciphertext)
    values (v_org, p_branch_id, v_to, v_bill, v_op, v_rev, v_upd, v_nonce, v_ct)
    returning id into v_id;
    v_ids := pg_catalog.array_append(v_ids, v_id);
  end loop;

  return jsonb_build_object('ids', to_jsonb(v_ids));
end
$$;

-- Rows addressed to this branch with id > p_after_id, oldest first. At most p_limit (1..200, default 100) rows and
-- about 4 MB of ciphertext per call (always at least one row). Returns { items: [...], has_more: bool }.
-- Pulling does not delete anything: the caller applies the rows, then calls qt_ack.
create or replace function public.qt_pull(p_license text, p_branch_id uuid, p_after_id bigint default 0, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit int;
  v_after bigint;
  v_items jsonb;
  v_last bigint;
  v_more boolean;
begin
  v_org := public.qt_auth(p_license, p_branch_id);
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_after := greatest(coalesce(p_after_id, 0), 0);

  with r as (
    select p.id, p.from_branch, p.bill_id, p.op, p.revision, p.updated_at, p.nonce, p.ciphertext,
           sum(pg_catalog.octet_length(p.ciphertext)) over (order by p.id) as run
      from public.postbox p
     where p.org_id = v_org and p.to_branch = p_branch_id and p.id > v_after
     order by p.id
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'from_branch', r.from_branch,
           'bill_id', r.bill_id,
           'op', r.op,
           'revision', r.revision,
           'updated_at', r.updated_at,
           'nonce', pg_catalog.translate(pg_catalog.encode(r.nonce, 'base64'), E'\n', ''),
           'ciphertext', pg_catalog.translate(pg_catalog.encode(r.ciphertext, 'base64'), E'\n', '')
         ) order by r.id), '[]'::jsonb),
         max(r.id)
    into v_items, v_last
    from r
   where r.run - pg_catalog.octet_length(r.ciphertext) < 4194304;

  select exists (
    select 1 from public.postbox p
     where p.org_id = v_org and p.to_branch = p_branch_id and p.id > coalesce(v_last, v_after)
  ) into v_more;

  return jsonb_build_object('items', v_items, 'has_more', v_more);
end
$$;

-- Deletes acknowledged rows - only rows addressed to the calling branch (others are ignored). Max 1000 ids per call.
create or replace function public.qt_ack(p_license text, p_branch_id uuid, p_ids bigint[])
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
  if p_ids is null or coalesce(pg_catalog.array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if pg_catalog.array_length(p_ids, 1) > 1000 then
    raise exception 'too_many' using errcode = 'Q3I03';
  end if;
  with d as (
    delete from public.postbox p
     where p.org_id = v_org and p.to_branch = p_branch_id and p.id = any (p_ids)
    returning 1
  )
  select count(*) into v_n from d;
  return jsonb_build_object('deleted', v_n);
end
$$;

-- "I am online": updates last_seen_at.
create or replace function public.qt_touch(p_license text, p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.qt_auth(p_license, p_branch_id);
  update public.branches set last_seen_at = now() where branch_id = p_branch_id;
  return jsonb_build_object('ok', true, 'server_time', now());
end
$$;

-- Privileges. Supabase grants EXECUTE on new functions to anon / authenticated by default, so the internal ones are
-- revoked explicitly; the seven RPCs the app calls are granted explicitly.
revoke all on function public.qt_license_hash(text)       from public, anon, authenticated;
revoke all on function public.qt_auth(text, uuid)         from public, anon, authenticated;

revoke all on function public.qt_register_branch(text, uuid, text, text, text) from public;
revoke all on function public.qt_list_branches(text, uuid)                     from public;
revoke all on function public.qt_push(text, uuid, jsonb)                       from public;
revoke all on function public.qt_pull(text, uuid, bigint, int)                 from public;
revoke all on function public.qt_ack(text, uuid, bigint[])                     from public;
revoke all on function public.qt_touch(text, uuid)                             from public;

grant execute on function public.qt_register_branch(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.qt_list_branches(text, uuid)                     to anon, authenticated;
grant execute on function public.qt_push(text, uuid, jsonb)                       to anon, authenticated;
grant execute on function public.qt_pull(text, uuid, bigint, int)                 to anon, authenticated;
grant execute on function public.qt_ack(text, uuid, bigint[])                     to anon, authenticated;
grant execute on function public.qt_touch(text, uuid)                             to anon, authenticated;
