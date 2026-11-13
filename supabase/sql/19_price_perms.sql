-- Quot3 shared notebook - 19: Price List seat permissions   (Phase 242, Milestone 23; docs/MILESTONE23_DESIGN.md sections 4.4, 7.3)
-- Safe to run more than once. Run after 11-18. NEVER RUN from the sandbox: "works on Supabase" is a standing gap until the owner runs
-- checklist G in docs/SUPABASE_MIGRATIONS.md. Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What this file does:
--   1. sn_price_perms: one row per seat that seat 1 has granted rights to (flags add / edit / overwrite / delete / structure). RLS on, no
--      policies, all direct grants revoked: only the security-definer functions below touch it.
--   2. Internal helpers (not callable by the app): qt_price_seat, qt_price_norm, qt_price_flags, qt_price_row_name, qt_price_required.
--      qt_price_required is the SQL twin of requiredFlags() in src/shared/pricelist/perms.ts (keep the two in step).
--   3. Replaces sn_push (same argument list; body of file 18 + the permission check). A Price List item the seat may not make is NOT written:
--      it comes back as { outcome: 'refused', code: 'Q3P01', missing: [...] } and the other items of the batch still go through.
--      Seat 1 is never refused. Only the four price kinds are checked; bills, parties and item rules are untouched.
--   4. qt_price_perms_get (any seat: its own flags), qt_price_perms_list and qt_price_perms_set (seat 1 only, else Q3P02 seat1_only).
-- Default for a seat with no row = no rights (it can still view, search and use the suggestions in billing). Seat 1 cannot lose its rights.
-- The activity log (sn_price_log, qt_price_log_list) is Phase 243 and will be a later numbered file or an addition made BEFORE this one is run.
-- Without shared sync none of this applies: the desktop gives full rights to a PC that is not synced.

-- 1. table
create table if not exists public.sn_price_perms (
  org_id      uuid        not null,
  seat_no     int         not null check (seat_no between 1 and 50),
  flags       jsonb       not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(flags) = 'object'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid        null,
  primary key (org_id, seat_no),
  -- a removed seat takes its rights with it (a new seat with the same number starts with none)
  foreign key (org_id, seat_no) references public.sn_members (org_id, seat_no) on delete cascade
);
alter table public.sn_price_perms enable row level security;
revoke all on table public.sn_price_perms from public, anon, authenticated;

-- 2. helpers
create or replace function public.qt_price_seat()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select m.seat_no from public.sn_members m where m.user_id = auth.uid()
$$;

-- Any stored value -> the five flags, each a real boolean true or false (anything but jsonb true is false).
create or replace function public.qt_price_norm(p_flags jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'add',       coalesce(p_flags -> 'add'       = 'true'::pg_catalog.jsonb, false),
    'edit',      coalesce(p_flags -> 'edit'      = 'true'::pg_catalog.jsonb, false),
    'overwrite', coalesce(p_flags -> 'overwrite' = 'true'::pg_catalog.jsonb, false),
    'delete',    coalesce(p_flags -> 'delete'    = 'true'::pg_catalog.jsonb, false),
    'structure', coalesce(p_flags -> 'structure' = 'true'::pg_catalog.jsonb, false))
$$;

create or replace function public.qt_price_flags(p_org uuid, p_seat int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_f jsonb;
begin
  if p_seat = 1 then
    return pg_catalog.jsonb_build_object('add', true, 'edit', true, 'overwrite', true, 'delete', true, 'structure', true);
  end if;
  select p.flags into v_f from public.sn_price_perms p where p.org_id = p_org and p.seat_no = p_seat;
  return public.qt_price_norm(v_f);
end
$$;

-- The row name = the text of its runs joined together (formatting alone is not a name change [A]).
create or replace function public.qt_price_row_name(p_runs jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.string_agg(coalesce(x.e ->> 't', ''), '' order by x.o), '')
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_runs) = 'array' then p_runs else '[]'::pg_catalog.jsonb end)
         with ordinality as x(e, o)
$$;

-- SQL twin of requiredFlags(old, new) in src/shared/pricelist/perms.ts. p_old / p_new are whole record payloads ({ "row": {...} } etc.).
-- Tombstone = delete. Tier / category / tab: create, restore, rename, reorder, column change, move = structure (a tier KEY change too).
-- Row: create / restore = add; name, kind or position change = edit; filling an empty cell = edit; changing or clearing a value = overwrite.
create or replace function public.qt_price_required(p_kind text, p_has_old boolean, p_old_deleted boolean, p_old jsonb, p_new jsonb, p_new_deleted boolean)
returns pg_catalog.text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_o jsonb;
  v_n jsonb;
  v_oc jsonb;
  v_nc jsonb;
  v_need pg_catalog.text[] := '{}'::pg_catalog.text[];
  v_k text;
  v_flag text;
  v_before text;
  v_after text;
begin
  v_key := case p_kind when 'price_tier' then 'tier' when 'price_category' then 'category' when 'price_tab' then 'tab' when 'price_row' then 'row' else null end;
  if v_key is null then
    return v_need;
  end if;
  if coalesce(p_new_deleted, false) then
    if coalesce(p_has_old, false) and not coalesce(p_old_deleted, false) then
      return array['delete']::pg_catalog.text[];
    end if;
    return v_need;
  end if;
  v_o := case when pg_catalog.jsonb_typeof(p_old -> v_key) = 'object' then p_old -> v_key else '{}'::pg_catalog.jsonb end;
  v_n := case when pg_catalog.jsonb_typeof(p_new -> v_key) = 'object' then p_new -> v_key else '{}'::pg_catalog.jsonb end;

  if v_key <> 'row' then
    if not coalesce(p_has_old, false) or coalesce(p_old_deleted, false) then
      return array['structure']::pg_catalog.text[];
    end if;
    foreach v_k in array array['name', 'label', 'key', 'position', 'columns', 'categoryId'] loop
      if (v_o -> v_k) is distinct from (v_n -> v_k) then
        return array['structure']::pg_catalog.text[];
      end if;
    end loop;
    return v_need;
  end if;

  if not coalesce(p_has_old, false) or coalesce(p_old_deleted, false) then
    return array['add']::pg_catalog.text[];
  end if;
  if public.qt_price_row_name(v_o -> 'nameRuns') <> public.qt_price_row_name(v_n -> 'nameRuns')
     or (v_o -> 'kind') is distinct from (v_n -> 'kind')
     or (v_o -> 'idx') is distinct from (v_n -> 'idx') then
    v_need := array['edit']::pg_catalog.text[];
  end if;
  v_oc := case when pg_catalog.jsonb_typeof(v_o -> 'cells') = 'object' then v_o -> 'cells' else '{}'::pg_catalog.jsonb end;
  v_nc := case when pg_catalog.jsonb_typeof(v_n -> 'cells') = 'object' then v_n -> 'cells' else '{}'::pg_catalog.jsonb end;
  for v_k in
    select pg_catalog.jsonb_object_keys(v_oc) union select pg_catalog.jsonb_object_keys(v_nc)
  loop
    v_before := coalesce(v_oc ->> v_k, '');
    v_after  := coalesce(v_nc ->> v_k, '');
    if v_before <> v_after then
      v_flag := case when v_before = '' then 'edit' else 'overwrite' end;
      if not (v_flag = any (v_need)) then
        v_need := v_need || v_flag;
      end if;
    end if;
  end loop;
  return v_need;
end
$$;

-- 3. sn_push

-- THE write door (file 15 / 18 body + the Phase 242 Price List permission check). p_items: 1 to 200 items { kind, rec_id, base_version, payload, payload_hash, schema_ver, min_reader_ver, app_ver,
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
  v_seat int;
  v_flags jsonb;
  v_has_old boolean;
  v_req pg_catalog.text[];
  v_miss pg_catalog.text[];
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

  -- Phase 242: who is calling. The seat comes from auth.uid() (sn_members), never from the client.
  v_seat  := public.qt_price_seat();
  v_flags := public.qt_price_flags(v_org, v_seat);

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
    if v_kind is null or v_kind not in ('bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row')
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
    v_has_old := found;

    -- Phase 242: Price List kinds need the seat's flags. Seat 1 is never refused. An idempotent resend (same hash) writes nothing, so it is not checked.
    -- A refused item writes nothing (no record, no history row) and does not stop the other items of the batch.
    if v_kind in ('price_tier', 'price_category', 'price_tab', 'price_row') and v_seat is distinct from 1
       and not (v_has_old and v_row.payload_hash = v_hash) then
      v_req := public.qt_price_required(v_kind, v_has_old, case when v_has_old then v_row.deleted else false end,
                                        case when v_has_old then v_row.payload else null end, v_payload, v_deleted);
      select coalesce(pg_catalog.array_agg(f.flag), '{}'::pg_catalog.text[]) into v_miss
        from pg_catalog.unnest(v_req) as f(flag)
       where coalesce(v_flags -> f.flag = 'true'::pg_catalog.jsonb, false) is not true;
      if pg_catalog.cardinality(v_miss) > 0 then
        v_results := v_results || pg_catalog.jsonb_build_object('kind', v_kind, 'rec_id', v_rec, 'outcome', 'refused', 'code', 'Q3P01',
                                                                 'missing', pg_catalog.to_jsonb(v_miss), 'version', 0, 'server_seq', 0);
        continue;
      end if;
    end if;

    if not v_has_old then
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

-- 4. Public functions (the app's only door to the permissions)

-- Any seat: its own rights. Seat 1 always reads all-true.
create or replace function public.qt_price_perms_get(p_license text)
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
  return pg_catalog.jsonb_build_object('seat_no', v_seat, 'flags', public.qt_price_flags(v_org, v_seat));
end
$$;

-- Seat 1 only: every seat of the organisation with its flags (a seat without a row reads all-false; seat 1 all-true).
create or replace function public.qt_price_perms_list(p_license text)
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
             'seat_no', m.seat_no, 'branch_name', b.name, 'flags', public.qt_price_flags(m.org_id, m.seat_no), 'updated_at', p.updated_at
           ) order by m.seat_no), '[]'::pg_catalog.jsonb)
      from public.sn_members m
      left join public.sn_branches b on b.branch_id = m.branch_id
      left join public.sn_price_perms p on p.org_id = m.org_id and p.seat_no = m.seat_no
     where m.org_id = v_org
  );
end
$$;

-- Seat 1 only: store the flags of one seat. Seat 1's own row is forced to all-true. Returns { seat_no, flags } as stored.
create or replace function public.qt_price_perms_set(p_license text, p_seat int, p_flags jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_flags jsonb;
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  if p_seat is null or p_seat not between 1 and 50 or p_flags is null or pg_catalog.jsonb_typeof(p_flags) <> 'object'
     or not exists (select 1 from public.sn_members m where m.org_id = v_org and m.seat_no = p_seat) then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  v_flags := case when p_seat = 1
                  then pg_catalog.jsonb_build_object('add', true, 'edit', true, 'overwrite', true, 'delete', true, 'structure', true)
                  else public.qt_price_norm(p_flags) end;
  insert into public.sn_price_perms (org_id, seat_no, flags, updated_at, updated_by)
  values (v_org, p_seat, v_flags, pg_catalog.now(), auth.uid())
  on conflict (org_id, seat_no) do update set flags = excluded.flags, updated_at = pg_catalog.now(), updated_by = auth.uid();
  return pg_catalog.jsonb_build_object('seat_no', p_seat, 'flags', v_flags);
end
$$;

-- 5. Grants. Helpers are internal; the app may call sn_push and the three qt_price_perms_* functions only.
revoke all on function public.qt_price_seat()                                                          from public, anon, authenticated;
revoke all on function public.qt_price_norm(jsonb)                                                     from public, anon, authenticated;
revoke all on function public.qt_price_flags(uuid, int)                                                from public, anon, authenticated;
revoke all on function public.qt_price_row_name(jsonb)                                                 from public, anon, authenticated;
revoke all on function public.qt_price_required(text, boolean, boolean, jsonb, jsonb, boolean)         from public, anon, authenticated;
revoke all on function public.sn_push(text, uuid, jsonb)                                               from public, anon, authenticated;
revoke all on function public.qt_price_perms_get(text)                                                 from public, anon, authenticated;
revoke all on function public.qt_price_perms_list(text)                                                from public, anon, authenticated;
revoke all on function public.qt_price_perms_set(text, int, jsonb)                                     from public, anon, authenticated;
grant execute on function public.sn_push(text, uuid, jsonb)                                            to authenticated;
grant execute on function public.qt_price_perms_get(text)                                              to authenticated;
grant execute on function public.qt_price_perms_list(text)                                             to authenticated;
grant execute on function public.qt_price_perms_set(text, int, jsonb)                                  to authenticated;
