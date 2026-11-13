-- Quot3 shared notebook - 18: Price List record kinds   (Phase 241, Milestone 23; docs/MILESTONE23_DESIGN.md sections 7.2-7.3)
-- Safe to run more than once. Run after 11-17. NEVER RUN from the sandbox: "works on Supabase" is a standing gap until the owner runs
-- checklist G in docs/SUPABASE_MIGRATIONS.md. Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What this file does (Phase 241 only):
--   1. Extends the record kind of sn_records and sn_history with price_tier, price_category, price_tab and price_row.
--   2. Replaces sn_manifest and sn_push (same argument lists, so "create or replace" is enough: no "drop function" needed) with copies of
--      the file-15 versions whose ONLY change is the allowed kind list. sn_pull has no kind list and is not touched.
-- What it does NOT do: seat permissions (sn_price_perms, qt_price_perms_*, Q3P01 / Q3P02) are Phase 242 and the activity log
-- (sn_price_log, qt_price_log_list) is Phase 243. Both are added to this file ONLY IF it has not been run yet; otherwise to a new file.
--
-- A reader older than this change sets the new kinds aside as "unknown_kind" (codecV2.decodeRecord) and keeps them in sync_aside; after
-- an app update retryAside applies them. The records keep min_reader_ver 1 because the unknown-kind rule already protects them.
-- Record ids are uuids (the app's own ids); one record per tier, category, tab and row; deletes are tombstones (deleted = true).

-- 1. kind CHECKs. The inline checks of file 12 got the default names <table>_kind_check; drop by name, then add the wider one.
alter table public.sn_records drop constraint if exists sn_records_kind_check;
alter table public.sn_records add constraint sn_records_kind_check
  check (kind in ('bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row'));

alter table public.sn_history drop constraint if exists sn_history_kind_check;
alter table public.sn_history add constraint sn_history_kind_check
  check (kind in ('bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row'));

-- 2. RPCs (bodies identical to file 15 except the kind list).

create or replace function public.sn_manifest(p_license text, p_branch_id uuid, p_kind text, p_after_rec_id uuid default null, p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.sn_member_org(p_license, p_branch_id);
begin
  if p_kind is null or p_kind not in ('bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row') then
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

-- Grants stay as file 15 set them (create or replace keeps them); repeated here so this file is complete on its own.
revoke all on function public.sn_manifest(text, uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.sn_push(text, uuid, jsonb)               from public, anon, authenticated;
grant execute on function public.sn_manifest(text, uuid, text, uuid, int) to authenticated;
grant execute on function public.sn_push(text, uuid, jsonb)               to authenticated;
