-- Quot3 shared notebook - 15: app RPCs   (Phase 130; spec: docs/SYNC_SHARED_STORE_SPEC.md sections 6, 7, 11)
-- Safe to run more than once. Run after 11-14 (and 04: it reuses public.qt_license_hash). NOT yet run on a real Postgres.
--
-- NAMING (deviation from the spec text, recorded in PHASE_STATUS): the app-callable functions are called sn_* (like the sn_* tables),
-- NOT qt_*. The v1 postbox functions qt_list_branches(text, uuid), qt_push(text, uuid, jsonb), qt_touch(text, uuid) and qt_pull(...)
-- have the same signatures; "create or replace" with a qt_ name would silently overwrite the v1 functions that the installed v1 app
-- still calls until the Phase 140 cutover. The owner-only qt_create_org family (file 14) keeps its qt_ names (no collision).
--
-- The ONLY write door into sn_* tables. Every function is SECURITY DEFINER with an EMPTY search_path, reads auth.uid(), checks that the
-- caller is a member of an organisation whose license (the key passed in) is active, and enforces the size limits
-- (200 items per push, 1 MB per payload, 8 MB per push call, 1000 per manifest page, 200 rows / 4 MB per pull).
--
-- Error codes (SQLSTATE -> message): Q3L01 invalid_license (generic: bad / unknown / suspended) | Q3A01 not_member | Q3M01 unknown_branch
--   Q3B02 prefix_taken | Q3B03 branch_conflict | Q3B04 name_taken | Q3B05 seat_in_use | Q3I01 invalid_input | Q3I03 too_many
--   Q3R01 payload_too_large
-- Changing a function's argument list later needs "drop function" first (create or replace cannot change it).

-- ---------------------------------------------------------------- internal helpers (never granted)

-- "Main  Shop" and " main shop" are the same name.
create or replace function public.sn_name_norm(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
$$;

-- The caller's organisation id. Checks, in this order: signed in and a member (Q3A01), the license key is right and active
-- (Q3L01, same generic error for wrong / unknown / suspended), and, when a branch id is given, that it is THIS seat's branch (Q3M01).
create or replace function public.sn_member_org(p_license text, p_branch_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_branch uuid;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'not_member' using errcode = 'Q3A01';
  end if;
  select m.org_id, m.branch_id into v_org, v_branch from public.sn_members m where m.user_id = v_uid;
  if v_org is null then
    raise exception 'not_member' using errcode = 'Q3A01';
  end if;
  select true into v_ok
    from public.licenses l
   where l.org_id = v_org
     and l.key_hash = public.qt_license_hash(pg_catalog.upper(pg_catalog.btrim(coalesce(p_license, ''))))
     and l.status = 'active';
  if v_ok is not true then
    raise exception 'invalid_license' using errcode = 'Q3L01';
  end if;
  if p_branch_id is not null and (v_branch is null or v_branch <> p_branch_id) then
    raise exception 'unknown_branch' using errcode = 'Q3M01';
  end if;
  return v_org;
end
$$;

-- Adds one superseded / conflict_loser row and keeps only the newest 20 per record.
create or replace function public.sn_history_add(
  p_org uuid, p_kind text, p_rec uuid, p_version int, p_payload jsonb, p_from uuid, p_edited timestamptz, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sn_history (org_id, kind, rec_id, version, payload, from_branch, edited_at, reason)
  values (p_org, p_kind, p_rec, pg_catalog.greatest(p_version, 1), p_payload, p_from, p_edited, p_reason);
  delete from public.sn_history h
   where h.id in (
     select x.id from public.sn_history x
      where x.org_id = p_org and x.kind = p_kind and x.rec_id = p_rec
      order by x.id desc
     offset 20
   );
end
$$;

-- ---------------------------------------------------------------- app functions

-- Server clock, for the client's skew measurement (spec section 6).
create or replace function public.sn_now()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.now()
$$;

-- Binds this seat to a branch id (this installation) with a unique name and PO prefix.
-- A seat already bound to ANOTHER branch id is refused (Q3B05) unless p_takeover is true (a reinstall): then the old branch row is
-- removed first, which frees its name and prefix for the new installation. Returns { org_id, seat_no, server_time, max_server_seq, branches }.
create or replace function public.sn_activate(
  p_license text, p_branch_id uuid, p_name text, p_po_prefix text, p_device text default '', p_takeover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_norm text := public.sn_name_norm(p_name);
  v_prefix text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_po_prefix, '')));
  v_device text := pg_catalog.btrim(coalesce(p_device, ''));
  v_cur uuid;
  v_seat int;
  v_owner_org uuid;
  v_owner_user uuid;
  v_constraint text;
begin
  v_org := public.sn_member_org(p_license, null);
  if p_branch_id is null
     or pg_catalog.char_length(v_name) not between 1 and 80
     or v_norm = ''
     or pg_catalog.char_length(v_device) > 80
     or v_prefix !~ '^[A-Z0-9_/-]{1,8}$' then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;

  -- Serialise activations of one organisation, so two computers cannot take the same name or prefix at once.
  perform 1 from public.licenses l where l.org_id = v_org for update;
  select m.branch_id, m.seat_no into v_cur, v_seat from public.sn_members m where m.user_id = v_uid for update;

  if v_cur is not null and v_cur <> p_branch_id then
    if coalesce(p_takeover, false) is not true then
      raise exception 'seat_in_use' using errcode = 'Q3B05';
    end if;
    update public.sn_members m set branch_id = null where m.user_id = v_uid;
    delete from public.sn_branches b where b.branch_id = v_cur and b.org_id = v_org;
  end if;

  select b.org_id, b.user_id into v_owner_org, v_owner_user from public.sn_branches b where b.branch_id = p_branch_id;
  if v_owner_org is not null and (v_owner_org <> v_org or v_owner_user <> v_uid) then
    raise exception 'branch_conflict' using errcode = 'Q3B03';
  end if;
  if exists (select 1 from public.sn_branches b where b.org_id = v_org and b.name_norm = v_norm and b.branch_id <> p_branch_id) then
    raise exception 'name_taken' using errcode = 'Q3B04';
  end if;
  if exists (select 1 from public.sn_branches b where b.org_id = v_org and b.po_prefix = v_prefix and b.branch_id <> p_branch_id) then
    raise exception 'prefix_taken' using errcode = 'Q3B02';
  end if;

  insert into public.sn_branches (branch_id, org_id, user_id, name, name_norm, po_prefix, device_name)
  values (p_branch_id, v_org, v_uid, v_name, v_norm, v_prefix, v_device)
  on conflict (branch_id) do update
     set name = excluded.name, name_norm = excluded.name_norm, po_prefix = excluded.po_prefix,
         device_name = excluded.device_name, last_seen_at = pg_catalog.now();
  update public.sn_members m set branch_id = p_branch_id where m.user_id = v_uid;

  return pg_catalog.jsonb_build_object(
    'org_id', v_org,
    'seat_no', v_seat,
    'server_time', pg_catalog.now(),
    'max_server_seq', (select coalesce(pg_catalog.max(r.server_seq), 0) from public.sn_records r where r.org_id = v_org),
    'branches', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('branch_id', b.branch_id, 'name', b.name, 'po_prefix', b.po_prefix) order by b.po_prefix), '[]'::pg_catalog.jsonb)
        from public.sn_branches b where b.org_id = v_org
    )
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint like '%po_prefix%' then
      raise exception 'prefix_taken' using errcode = 'Q3B02';
    end if;
    raise exception 'name_taken' using errcode = 'Q3B04';
end
$$;

-- Is this branch name free in my organisation? p_branch_id (optional) is my own branch, which does not count against me.
create or replace function public.sn_branch_name_free(p_license text, p_name text, p_branch_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_norm text := public.sn_name_norm(p_name);
begin
  if v_norm = '' or pg_catalog.char_length(pg_catalog.btrim(p_name)) > 80 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  return not exists (
    select 1 from public.sn_branches b
     where b.org_id = v_org and b.name_norm = v_norm and (p_branch_id is null or b.branch_id <> p_branch_id)
  );
end
$$;

create or replace function public.sn_rename_branch(p_license text, p_branch_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_norm text := public.sn_name_norm(p_name);
begin
  if v_norm = '' or pg_catalog.char_length(v_name) > 80 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  if exists (select 1 from public.sn_branches b where b.org_id = v_org and b.name_norm = v_norm and b.branch_id <> p_branch_id) then
    raise exception 'name_taken' using errcode = 'Q3B04';
  end if;
  update public.sn_branches b set name = v_name, name_norm = v_norm, last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id;
  return pg_catalog.jsonb_build_object('branch_id', p_branch_id, 'name', v_name);
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = 'Q3B04';
end
$$;

-- The organisation's branches (name, PO prefix, last seen).
create or replace function public.sn_list_branches(p_license text, p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
begin
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'branch_id', b.branch_id, 'name', b.name, 'po_prefix', b.po_prefix, 'device_name', b.device_name, 'last_seen_at', b.last_seen_at
           ) order by b.po_prefix), '[]'::pg_catalog.jsonb)
      from public.sn_branches b where b.org_id = v_org
  );
end
$$;

-- What the server holds, without payloads: one page (at most 1000) of one kind, ordered by rec_id, after p_after_rec_id.
-- The client's first compare uses it to skip identical records (spec section 7).
create or replace function public.sn_manifest(p_license text, p_branch_id uuid, p_kind text, p_after_rec_id uuid default null, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
begin
  if p_kind is null or p_kind not in ('bill', 'party', 'party_merge', 'item_rule') then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'rec_id', t.rec_id, 'version', t.version, 'payload_hash', t.payload_hash, 'server_seq', t.server_seq, 'deleted', t.deleted
           ) order by t.rec_id), '[]'::pg_catalog.jsonb)
      from (
        select r.rec_id, r.version, r.payload_hash, r.server_seq, r.deleted
          from public.sn_records r
         where r.org_id = v_org and r.kind = p_kind and (p_after_rec_id is null or r.rec_id > p_after_rec_id)
         order by r.rec_id
         limit p_limit
      ) t
  );
end
$$;

-- THE write door. p_items: 1 to 200 items { kind, rec_id, base_version, payload, payload_hash, schema_ver, min_reader_ver, app_ver,
-- edited_at, deleted }. Returns [{ kind, rec_id, outcome, version, server_seq }], outcome = accepted | noop | won | lost.
-- Rules per item (spec section 6), all in this one transaction, pushes of one organisation serialised:
--   no row yet                                -> insert, version 1, accepted
--   payload_hash equals the stored hash       -> nothing written, noop (idempotent resend; the client's hash must cover the deleted flag [A])
--   base_version = stored version             -> old row to sn_history (superseded), version + 1, accepted
--   otherwise (both sides changed)            -> the later edited_at wins; a tie goes to the greater branch id (uuid order).
--        incoming newer: the old stored row goes to sn_history (conflict_loser); the row becomes the incoming one; outcome won
--        incoming older: the incoming payload goes to sn_history (conflict_loser, version = its base_version, at least 1); the stored
--                        payload stays; outcome lost. Either way the stored version is +1 with a new server_seq, so every branch pulls it.
-- One sn_ping touch per call that changed anything (the Realtime doorbell), never per item.
create or replace function public.sn_push(p_license text, p_branch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_n int;
  v_i int;
  v_item jsonb;
  v_kind text;
  v_rec uuid;
  v_base int;
  v_payload jsonb;
  v_hash text;
  v_schema int;
  v_minr int;
  v_app text;
  v_edited timestamptz;
  v_deleted boolean;
  v_row public.sn_records%rowtype;
  v_outcome text;
  v_version int;
  v_seq bigint;
  v_wins boolean;
  v_changed boolean := false;
  v_results jsonb := '[]'::pg_catalog.jsonb;
begin
  v_org := public.sn_member_org(p_license, p_branch_id);
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_n := pg_catalog.jsonb_array_length(p_items);
  if v_n = 0 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  if v_n > 200 then
    raise exception 'too_many' using errcode = 'Q3I03';
  end if;
  if pg_catalog.octet_length(p_items::text) > 8388608 then
    raise exception 'payload_too_large' using errcode = 'Q3R01';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sn:' || v_org::text, 0));

  for v_i in 0..(v_n - 1) loop
    v_item := p_items -> v_i;
    begin
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_input' using errcode = 'Q3I01';
      end if;
      v_kind    := v_item ->> 'kind';
      v_rec     := (v_item ->> 'rec_id')::uuid;
      v_base    := (v_item ->> 'base_version')::int;
      v_payload := v_item -> 'payload';
      v_hash    := v_item ->> 'payload_hash';
      v_schema  := coalesce((v_item ->> 'schema_ver')::int, 1);
      v_minr    := coalesce((v_item ->> 'min_reader_ver')::int, 1);
      v_app     := coalesce(v_item ->> 'app_ver', '');
      v_edited  := (v_item ->> 'edited_at')::timestamptz;
      v_deleted := coalesce((v_item ->> 'deleted')::boolean, false);
    exception
      when others then
        raise exception 'invalid_input' using errcode = 'Q3I01';
    end;
    if v_kind is null or v_kind not in ('bill', 'party', 'party_merge', 'item_rule')
       or v_rec is null or v_base is null or v_base < 0
       or v_payload is null or pg_catalog.jsonb_typeof(v_payload) <> 'object'
       or v_hash is null or pg_catalog.char_length(v_hash) not between 8 and 128
       or v_schema < 1 or v_minr < 1 or pg_catalog.char_length(v_app) > 40
       or v_edited is null then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if pg_catalog.octet_length(v_payload::text) > 1048576 then
      raise exception 'payload_too_large' using errcode = 'Q3R01';
    end if;

    select * into v_row from public.sn_records r where r.org_id = v_org and r.kind = v_kind and r.rec_id = v_rec for update;

    if not found then
      insert into public.sn_records (org_id, kind, rec_id, version, deleted, payload, payload_hash, schema_ver, min_reader_ver, app_ver, edited_at, from_branch)
      values (v_org, v_kind, v_rec, 1, v_deleted, v_payload, v_hash, v_schema, v_minr, v_app, v_edited, p_branch_id)
      returning version, server_seq into v_version, v_seq;
      v_outcome := 'accepted';
      v_changed := true;

    elsif v_row.payload_hash = v_hash then
      v_outcome := 'noop';
      v_version := v_row.version;
      v_seq := v_row.server_seq;

    elsif v_base = v_row.version then
      perform public.sn_history_add(v_org, v_kind, v_rec, v_row.version, v_row.payload, v_row.from_branch, v_row.edited_at, 'superseded');
      update public.sn_records r
         set version = r.version + 1, server_seq = pg_catalog.nextval('public.sn_server_seq'), deleted = v_deleted, payload = v_payload,
             payload_hash = v_hash, schema_ver = v_schema, min_reader_ver = v_minr, app_ver = v_app, edited_at = v_edited,
             from_branch = p_branch_id, updated_at = pg_catalog.now()
       where r.org_id = v_org and r.kind = v_kind and r.rec_id = v_rec
      returning r.version, r.server_seq into v_version, v_seq;
      v_outcome := 'accepted';
      v_changed := true;

    else
      v_wins := v_edited > v_row.edited_at
                or (v_edited = v_row.edited_at and p_branch_id > coalesce(v_row.from_branch, '00000000-0000-0000-0000-000000000000'::uuid));
      if v_wins then
        perform public.sn_history_add(v_org, v_kind, v_rec, v_row.version, v_row.payload, v_row.from_branch, v_row.edited_at, 'conflict_loser');
        update public.sn_records r
           set version = r.version + 1, server_seq = pg_catalog.nextval('public.sn_server_seq'), deleted = v_deleted, payload = v_payload,
               payload_hash = v_hash, schema_ver = v_schema, min_reader_ver = v_minr, app_ver = v_app, edited_at = v_edited,
               from_branch = p_branch_id, updated_at = pg_catalog.now()
         where r.org_id = v_org and r.kind = v_kind and r.rec_id = v_rec
        returning r.version, r.server_seq into v_version, v_seq;
        v_outcome := 'won';
      else
        perform public.sn_history_add(v_org, v_kind, v_rec, v_base, v_payload, p_branch_id, v_edited, 'conflict_loser');
        update public.sn_records r
           set version = r.version + 1, server_seq = pg_catalog.nextval('public.sn_server_seq'), updated_at = pg_catalog.now()
         where r.org_id = v_org and r.kind = v_kind and r.rec_id = v_rec
        returning r.version, r.server_seq into v_version, v_seq;
        v_outcome := 'lost';
      end if;
      v_changed := true;
    end if;

    v_results := v_results || pg_catalog.jsonb_build_object('kind', v_kind, 'rec_id', v_rec, 'outcome', v_outcome, 'version', v_version, 'server_seq', v_seq);
  end loop;

  if v_changed then
    insert into public.sn_ping (org_id, seq, at) values (v_org, 1, pg_catalog.now())
    on conflict (org_id) do update set seq = public.sn_ping.seq + 1, at = pg_catalog.now();
  end if;
  update public.sn_branches b set last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id;
  return v_results;
end
$$;

-- Changed records with server_seq > p_after_seq, in order: at most p_limit (default 200, max 200) rows and about 4 MB of payload
-- (always at least one row). Returns { items, has_more, server_time }. Pulling deletes nothing; it includes the caller's own records.
create or replace function public.sn_pull(p_license text, p_branch_id uuid, p_after_seq bigint default 0, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
  v_after bigint := coalesce(p_after_seq, 0);
  v_items jsonb := '[]'::pg_catalog.jsonb;
  v_n int := 0;
  v_bytes bigint := 0;
  v_size bigint;
  v_more boolean := false;
  r record;
begin
  if v_after < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  for r in
    select x.kind, x.rec_id, x.version, x.server_seq, x.deleted, x.payload, x.payload_hash, x.schema_ver, x.min_reader_ver, x.app_ver, x.edited_at, x.from_branch
      from public.sn_records x
     where x.org_id = v_org and x.server_seq > v_after
     order by x.server_seq
     limit p_limit + 1
  loop
    v_size := pg_catalog.octet_length(r.payload::text);
    if v_n >= p_limit or (v_n > 0 and v_bytes + v_size > 4194304) then
      v_more := true;
      exit;
    end if;
    v_items := v_items || pg_catalog.jsonb_build_object(
      'kind', r.kind, 'rec_id', r.rec_id, 'version', r.version, 'server_seq', r.server_seq, 'deleted', r.deleted,
      'payload', r.payload, 'payload_hash', r.payload_hash, 'schema_ver', r.schema_ver, 'min_reader_ver', r.min_reader_ver,
      'app_ver', r.app_ver, 'edited_at', r.edited_at, 'from_branch', r.from_branch
    );
    v_n := v_n + 1;
    v_bytes := v_bytes + v_size;
  end loop;
  update public.sn_branches b set last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id;
  return pg_catalog.jsonb_build_object('items', v_items, 'has_more', v_more, 'server_time', pg_catalog.now());
end
$$;

-- Keep-alive: marks this branch as seen and returns the server clock.
create or replace function public.sn_touch(p_license text, p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
begin
  update public.sn_branches b set last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id and b.org_id = v_org;
  return pg_catalog.jsonb_build_object('server_time', pg_catalog.now());
end
$$;

-- ---------------------------------------------------------------- privileges: authenticated only, helpers never
revoke all on function public.sn_name_norm(text)                                                       from public, anon, authenticated;
revoke all on function public.sn_member_org(text, uuid)                                                from public, anon, authenticated;
revoke all on function public.sn_history_add(uuid, text, uuid, int, jsonb, uuid, timestamptz, text)    from public, anon, authenticated;

revoke all on function public.sn_now()                                                                 from public, anon, authenticated;
revoke all on function public.sn_activate(text, uuid, text, text, text, boolean)                       from public, anon, authenticated;
revoke all on function public.sn_branch_name_free(text, text, uuid)                                    from public, anon, authenticated;
revoke all on function public.sn_rename_branch(text, uuid, text)                                       from public, anon, authenticated;
revoke all on function public.sn_list_branches(text, uuid)                                             from public, anon, authenticated;
revoke all on function public.sn_manifest(text, uuid, text, uuid, int)                                 from public, anon, authenticated;
revoke all on function public.sn_push(text, uuid, jsonb)                                               from public, anon, authenticated;
revoke all on function public.sn_pull(text, uuid, bigint, int)                                         from public, anon, authenticated;
revoke all on function public.sn_touch(text, uuid)                                                     from public, anon, authenticated;

grant execute on function public.sn_now()                                                              to authenticated;
grant execute on function public.sn_activate(text, uuid, text, text, text, boolean)                    to authenticated;
grant execute on function public.sn_branch_name_free(text, text, uuid)                                 to authenticated;
grant execute on function public.sn_rename_branch(text, uuid, text)                                    to authenticated;
grant execute on function public.sn_list_branches(text, uuid)                                          to authenticated;
grant execute on function public.sn_manifest(text, uuid, text, uuid, int)                              to authenticated;
grant execute on function public.sn_push(text, uuid, jsonb)                                            to authenticated;
grant execute on function public.sn_pull(text, uuid, bigint, int)                                      to authenticated;
grant execute on function public.sn_touch(text, uuid)                                                  to authenticated;
