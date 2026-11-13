-- Quot3 shared notebook - 20: Price List activity log   (Phase 243, Milestone 23; docs/MILESTONE23_DESIGN.md sections 4.5, 7.3)
-- Safe to run more than once. Run after 19. NEVER RUN from the sandbox: "works on Supabase" is a standing gap until the owner runs
-- checklist G in docs/SUPABASE_MIGRATIONS.md. Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What this file does:
--   1. sn_price_log: one row per accepted Price List change (who = seat + branch + device, when, where = category > tab > item, old and new values).
--      RLS on, no policy, all direct grants revoked: nobody reads it directly; only qt_price_log_list (seat 1 only) does.
--   2. Internal helpers (not callable by the app): qt_price_log_label, qt_price_log_change (the SQL twin of deriveServerChange() in
--      src/shared/pricelist/logEntry.ts: keep the two in step), qt_price_log_add.
--   3. Replaces sn_push (same argument list; body of file 19 + one qt_price_log_add call per accepted or winning price item). The author comes from
--      auth.uid() through sn_members, never from the client payload. A failure while logging is swallowed so it can never block a save [A].
--   4. Replaces qt_price_perms_set (file 19 body + a 'permission' log entry).
--   5. qt_price_log_list (seat 1 only, else Q3P02 seat1_only, newest first, keyset paging by id) and qt_price_log_trim (seat 1 only: retention).
-- Recording always runs, whether or not seat 1 has switched the Activity view on [A]. Retention is applied by seat 1's app through qt_price_log_trim
-- (default 365 days [A]). Device kind: an app_ver that starts with 'pwa' or 'phone' counts as a phone, everything else as a PC [A].
-- Without shared sync none of this applies: the desktop keeps its own local log and that PC counts as main [A].

-- 1. table
create table if not exists public.sn_price_log (
  id           bigint      generated always as identity primary key,
  org_id       uuid        not null,
  at           timestamptz not null default now(),
  seat_no      int         null,
  branch_id    uuid        null,
  branch_name  text        not null default '' check (pg_catalog.char_length(branch_name) <= 200),
  device       text        not null default 'pc' check (device in ('pc', 'phone')),
  kind         text        not null check (kind in ('price_tier', 'price_category', 'price_tab', 'price_row', 'price_perms')),
  rec_id       uuid        null,
  entity       text        not null check (entity in ('tier', 'category', 'tab', 'row', 'column', 'perms', 'list')),
  op           text        not null check (op in ('add', 'edit', 'overwrite', 'delete', 'restore', 'import', 'bulk', 'structure', 'permission')),
  path         text        not null default '' check (pg_catalog.char_length(path) <= 300),
  before       jsonb       null,
  after        jsonb       null,
  count        int         not null default 1 check (count >= 1)
);
create index if not exists sn_price_log_org_id_idx on public.sn_price_log (org_id, id desc);
create index if not exists sn_price_log_org_at_idx on public.sn_price_log (org_id, at);
alter table public.sn_price_log enable row level security;
revoke all on table public.sn_price_log from public, anon, authenticated;

-- 2. helpers
-- The label of a tab column (columns are [{ key, label, ... }]); the key itself when it is unknown.
create or replace function public.qt_price_log_label(p_tab jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select nullif(c.e ->> 'label', '')
       from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_tab -> 'tab' -> 'columns') = 'array' then p_tab -> 'tab' -> 'columns' else '[]'::pg_catalog.jsonb end) as c(e)
      where c.e ->> 'key' = p_key
      limit 1),
    p_key)
$$;

-- SQL twin of deriveServerChange(old, new, ctx). Returns { entity, op, path, before, after } or null when nothing worth logging changed.
create or replace function public.qt_price_log_change(p_kind text, p_has_old boolean, p_old_deleted boolean, p_old jsonb, p_new jsonb, p_new_deleted boolean,
                                                      p_cat text, p_tab text, p_tab_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
  v_o jsonb;
  v_n jsonb;
  v_name text;
  v_op text := null;
  v_path text;
  v_before jsonb := '{}'::pg_catalog.jsonb;
  v_after jsonb := '{}'::pg_catalog.jsonb;
  v_oc jsonb;
  v_nc jsonb;
  v_k text;
  v_b text;
  v_a text;
  v_ow boolean := false;
  v_lab text;
  v_cnt int := 0;
  v_f text;
begin
  v_key := case p_kind when 'price_tier' then 'tier' when 'price_category' then 'category' when 'price_tab' then 'tab' when 'price_row' then 'row' else null end;
  if v_key is null then
    return null;
  end if;
  v_o := case when pg_catalog.jsonb_typeof(p_old -> v_key) = 'object' then p_old -> v_key else '{}'::pg_catalog.jsonb end;
  v_n := case when pg_catalog.jsonb_typeof(p_new -> v_key) = 'object' then p_new -> v_key else '{}'::pg_catalog.jsonb end;
  if v_key = 'tier' then
    v_name := coalesce(v_n ->> 'label', v_o ->> 'label', '');
  elsif v_key = 'row' then
    v_name := public.qt_price_row_name(v_n -> 'nameRuns');
  else
    v_name := coalesce(v_n ->> 'name', v_o ->> 'name', '');
  end if;

  if coalesce(p_new_deleted, false) then
    if coalesce(p_has_old, false) and not coalesce(p_old_deleted, false) then
      v_op := 'delete';
    else
      return null;
    end if;
  elsif v_key = 'row' then
    if not coalesce(p_has_old, false) then
      v_op := 'add';
    elsif coalesce(p_old_deleted, false) then
      v_op := 'restore';
    else
      if public.qt_price_row_name(v_o -> 'nameRuns') <> v_name then
        v_before := v_before || pg_catalog.jsonb_build_object('Name', pg_catalog.left(public.qt_price_row_name(v_o -> 'nameRuns'), 200));
        v_after  := v_after  || pg_catalog.jsonb_build_object('Name', pg_catalog.left(v_name, 200));
        v_cnt := v_cnt + 1;
      end if;
      v_oc := case when pg_catalog.jsonb_typeof(v_o -> 'cells') = 'object' then v_o -> 'cells' else '{}'::pg_catalog.jsonb end;
      v_nc := case when pg_catalog.jsonb_typeof(v_n -> 'cells') = 'object' then v_n -> 'cells' else '{}'::pg_catalog.jsonb end;
      for v_k in
        select k from (select pg_catalog.jsonb_object_keys(v_oc) as k union select pg_catalog.jsonb_object_keys(v_nc)) u order by k
      loop
        v_b := coalesce(v_oc ->> v_k, '');
        v_a := coalesce(v_nc ->> v_k, '');
        if v_b <> v_a and v_cnt < 50 then
          if v_b <> '' then
            v_ow := true;
          end if;
          v_lab := public.qt_price_log_label(p_tab_payload, v_k);
          v_before := v_before || pg_catalog.jsonb_build_object(v_lab, pg_catalog.left(v_b, 200));
          v_after  := v_after  || pg_catalog.jsonb_build_object(v_lab, pg_catalog.left(v_a, 200));
          v_cnt := v_cnt + 1;
        end if;
      end loop;
      if v_cnt = 0 then
        return null;
      end if;
      v_op := case when v_ow then 'overwrite' else 'edit' end;
    end if;
  else
    if not coalesce(p_has_old, false) then
      v_op := case when v_key = 'tab' then 'add' else 'structure' end;
    elsif coalesce(p_old_deleted, false) then
      v_op := 'restore';
    else
      foreach v_f in array array['name', 'label', 'key', 'position', 'columns', 'categoryId'] loop
        if (v_o -> v_f) is distinct from (v_n -> v_f) then
          v_op := 'structure';
        end if;
      end loop;
      if v_op is null then
        return null;
      end if;
    end if;
  end if;

  v_path := case v_key
              when 'row' then pg_catalog.concat_ws(' > ', p_cat, p_tab, v_name)
              when 'tab' then pg_catalog.concat_ws(' > ', p_cat, v_name)
              else v_name end;
  v_path := pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(v_path, '\s+', ' ', 'g')), 300);
  return pg_catalog.jsonb_build_object('entity', v_key, 'op', v_op, 'path', v_path,
                                       'before', case when v_before = '{}'::pg_catalog.jsonb then null else v_before end,
                                       'after',  case when v_after  = '{}'::pg_catalog.jsonb then null else v_after  end);
end
$$;

-- Writes one log row for an accepted price change. The caller passes the seat it already read from auth.uid(). Never raises: a logging problem must not stop a save [A].
create or replace function public.qt_price_log_add(p_org uuid, p_seat int, p_branch uuid, p_app text, p_kind text, p_rec uuid, p_has_old boolean,
                                                   p_old_deleted boolean, p_old jsonb, p_new jsonb, p_new_deleted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab jsonb := null;
  v_cat jsonb := null;
  v_tab_id uuid;
  v_cat_id uuid;
  v_ch jsonb;
  v_bname text;
begin
  begin
    if p_kind = 'price_row' then
      v_tab_id := nullif(p_new -> 'row' ->> 'tabId', '')::uuid;
      select r.payload into v_tab from public.sn_records r where r.org_id = p_org and r.kind = 'price_tab' and r.rec_id = v_tab_id;
    elsif p_kind = 'price_tab' then
      v_tab := p_new;
    end if;
    if v_tab is not null then
      v_cat_id := nullif(v_tab -> 'tab' ->> 'categoryId', '')::uuid;
      select r.payload into v_cat from public.sn_records r where r.org_id = p_org and r.kind = 'price_category' and r.rec_id = v_cat_id;
    end if;
    v_ch := public.qt_price_log_change(p_kind, p_has_old, p_old_deleted, p_old, p_new, p_new_deleted,
                                       v_cat -> 'category' ->> 'name', case when p_kind = 'price_row' then v_tab -> 'tab' ->> 'name' else null end, v_tab);
    if v_ch is null then
      return;
    end if;
    select b.name into v_bname from public.sn_branches b where b.branch_id = p_branch;
    insert into public.sn_price_log (org_id, seat_no, branch_id, branch_name, device, kind, rec_id, entity, op, path, before, after, count)
    values (p_org, p_seat, p_branch, coalesce(pg_catalog.left(v_bname, 200), ''),
            case when pg_catalog.lower(coalesce(p_app, '')) like 'pwa%' or pg_catalog.lower(coalesce(p_app, '')) like 'phone%' then 'phone' else 'pc' end,
            p_kind, p_rec, v_ch ->> 'entity', v_ch ->> 'op', v_ch ->> 'path',
            case when pg_catalog.jsonb_typeof(v_ch -> 'before') = 'object' then v_ch -> 'before' else null end,
            case when pg_catalog.jsonb_typeof(v_ch -> 'after') = 'object' then v_ch -> 'after' else null end, 1);
  exception
    when others then
      null;
  end;
end
$$;

-- 3. sn_push (file 19 body + the log call)

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

    -- Phase 243: one activity-log entry per accepted or winning Price List change. Author = the seat of auth.uid(), never the client. A noop (same hash)
    -- and a lost conflict changed nothing, so they are not logged.
    if v_kind in ('price_tier', 'price_category', 'price_tab', 'price_row') and v_outcome in ('accepted', 'won') then
      perform public.qt_price_log_add(v_org, v_seat, p_branch_id, v_app, v_kind, v_rec, v_has_old,
                                      case when v_has_old then v_row.deleted else false end,
                                      case when v_has_old then v_row.payload else null end, v_payload, v_deleted);
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

-- 4. qt_price_perms_set (file 19 body + a 'permission' entry in the log)
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
  end if;
  return pg_catalog.jsonb_build_object('seat_no', p_seat, 'flags', v_flags);
end
$$;

-- 5. Public functions (seat 1 only)

-- Newest first. p_limit 1..500 (default 100); p_before_id = keyset paging (rows with a smaller id). Any other seat gets Q3P02 seat1_only and nothing else.
create or replace function public.qt_price_log_list(p_license text, p_limit int default 100, p_before_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_lim int := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', x.id, 'at', x.at, 'seat_no', x.seat_no, 'branch_id', x.branch_id, 'branch_name', x.branch_name, 'device', x.device,
             'entity', x.entity, 'rec_id', x.rec_id, 'op', x.op, 'path', x.path, 'before', x.before, 'after', x.after, 'count', x.count
           ) order by x.id desc), '[]'::pg_catalog.jsonb)
      from (select l.* from public.sn_price_log l
             where l.org_id = v_org and (p_before_id is null or l.id < p_before_id)
             order by l.id desc limit v_lim) x
  );
end
$$;

-- Retention: removes this organisation's entries older than p_days (clamped 30..3650). Returns how many.
create or replace function public.qt_price_log_trim(p_license text, p_days int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, null);
  v_days int := greatest(30, least(coalesce(p_days, 365), 3650));
  v_n int;
begin
  if public.qt_price_seat() is distinct from 1 then
    raise exception 'seat1_only' using errcode = 'Q3P02';
  end if;
  delete from public.sn_price_log l where l.org_id = v_org and l.at < pg_catalog.now() - pg_catalog.make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 6. Grants. Helpers are internal; the app may call sn_push, qt_price_perms_set and the two log functions.
revoke all on function public.qt_price_log_label(jsonb, text)                                                                       from public, anon, authenticated;
revoke all on function public.qt_price_log_change(text, boolean, boolean, jsonb, jsonb, boolean, text, text, jsonb)                  from public, anon, authenticated;
revoke all on function public.qt_price_log_add(uuid, int, uuid, text, text, uuid, boolean, boolean, jsonb, jsonb, boolean)          from public, anon, authenticated;
revoke all on function public.sn_push(text, uuid, jsonb)                                                                            from public, anon, authenticated;
revoke all on function public.qt_price_perms_set(text, int, jsonb)                                                                  from public, anon, authenticated;
revoke all on function public.qt_price_log_list(text, int, bigint)                                                                  from public, anon, authenticated;
revoke all on function public.qt_price_log_trim(text, int)                                                                          from public, anon, authenticated;
grant execute on function public.sn_push(text, uuid, jsonb)                                                                         to authenticated;
grant execute on function public.qt_price_perms_set(text, int, jsonb)                                                               to authenticated;
grant execute on function public.qt_price_log_list(text, int, bigint)                                                               to authenticated;
grant execute on function public.qt_price_log_trim(text, int)                                                                       to authenticated;
