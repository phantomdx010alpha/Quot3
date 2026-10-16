-- Quot3 shared notebook - 17: shared themes   (Phase 170; design: docs/MILESTONE16_DESIGN.md section 3.8; contract: API_CONTRACTS.md "Phase 170")
-- Safe to run more than once. Run after 11-16 (it reuses public.sn_member_org from 15). NOT yet run on a real Postgres.
-- Files 01-16, 90, 91 and 99 are NOT edited by this file.
--
-- A theme is DATA (JSON), never code. The server only stores it and hands it back; the app validates every received theme exactly like a
-- local file (validateTheme) before it is ever written to a themes folder. The server checks only shape and size, not the theme's meaning.
--
-- sn_themes        : the CURRENT version of each shared theme, one row per (organisation, theme id). No tombstones: removing a shared
--                    theme is local to a PC [A], so nothing here is ever deleted by the app.
-- sn_theme_history : older versions and conflict losers, newest 20 kept per theme (nothing is silently lost).
-- Writes: ONLY through sn_theme_push (security definer). Reads: RLS select of the own organisation, or sn_theme_pull.
-- Sharing is OFF by default in the app; this file changes nothing for an organisation that never turns it on.
--
-- Error codes reuse file 15: Q3L01 invalid_license | Q3A01 not_member | Q3M01 unknown_branch | Q3I01 invalid_input | Q3I03 too_many
--   Q3R01 payload_too_large

-- One monotonic counter for pull ordering (gaps allowed). Separate from sn_server_seq so bill pulls are unaffected.
create sequence if not exists public.sn_theme_seq as bigint;

create table if not exists public.sn_themes (
  org_id          uuid        not null references public.licenses (org_id) on delete cascade,
  -- Same rule as the theme file's own id (validateTheme): 1-40 chars, a-z 0-9 and "-", not starting with "-".
  theme_id        text        not null check (theme_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  version         int         not null default 1 check (version >= 1),
  server_seq      bigint      not null default nextval('public.sn_theme_seq'),
  -- The theme file as jsonb. 64 KB cap per theme [A].
  payload         jsonb       not null check (octet_length(payload::text) <= 65536),
  payload_hash    text        not null check (char_length(payload_hash) between 8 and 128),
  -- The theme file's own "schema" number (1 = v1 flat, 2 = Themes 2.0).
  schema_ver      int         not null default 1 check (schema_ver >= 1),
  -- A reader older than this sets the theme aside ("Update the app to use N themes"); it never strips or overwrites it.
  min_reader_ver  int         not null default 1 check (min_reader_ver >= 1),
  app_ver         text        not null default '' check (char_length(app_ver) <= 40),
  edited_at       timestamptz not null,
  -- The author seat's branch (the computer that last wrote this version).
  from_branch     uuid        null,
  updated_at      timestamptz not null default now(),
  primary key (org_id, theme_id)
);

create index if not exists sn_themes_seq_idx on public.sn_themes (org_id, server_seq);

create table if not exists public.sn_theme_history (
  id           bigserial   primary key,
  org_id       uuid        not null references public.licenses (org_id) on delete cascade,
  theme_id     text        not null check (theme_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  version      int         not null check (version >= 1),
  payload      jsonb       not null check (octet_length(payload::text) <= 65536),
  from_branch  uuid        null,
  edited_at    timestamptz not null,
  replaced_at  timestamptz not null default now(),
  reason       text        not null check (reason in ('superseded', 'conflict_loser'))
);

create index if not exists sn_theme_history_rec_idx on public.sn_theme_history (org_id, theme_id, id);

alter table public.sn_themes        enable row level security;
alter table public.sn_theme_history enable row level security;
revoke all on table public.sn_themes        from public, anon, authenticated;
revoke all on table public.sn_theme_history from public, anon, authenticated;
revoke all on sequence public.sn_theme_seq             from public, anon, authenticated;
revoke all on sequence public.sn_theme_history_id_seq  from public, anon, authenticated;

-- ---------------------------------------------------------------- row level security (select own organisation only)
-- Same shape as file 13: no insert / update / delete policy exists, so every write is the RPC below. anon has nothing.

drop policy if exists sn_themes_select_org on public.sn_themes;
create policy sn_themes_select_org on public.sn_themes
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

drop policy if exists sn_theme_history_select_org on public.sn_theme_history;
create policy sn_theme_history_select_org on public.sn_theme_history
  for select to authenticated
  using (org_id in (select m.org_id from public.sn_members m where m.user_id = (select auth.uid())));

grant select on table public.sn_themes        to authenticated;
grant select on table public.sn_theme_history to authenticated;

-- ---------------------------------------------------------------- internal helper (never granted)

-- Adds one superseded / conflict_loser row and keeps only the newest 20 per theme.
create or replace function public.sn_theme_history_add(
  p_org uuid, p_theme text, p_version int, p_payload jsonb, p_from uuid, p_edited timestamptz, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sn_theme_history (org_id, theme_id, version, payload, from_branch, edited_at, reason)
  values (p_org, p_theme, pg_catalog.greatest(p_version, 1), p_payload, p_from, p_edited, p_reason);
  delete from public.sn_theme_history h
   where h.id in (
     select x.id from public.sn_theme_history x
      where x.org_id = p_org and x.theme_id = p_theme
      order by x.id desc
     offset 20
   );
end
$$;

-- ---------------------------------------------------------------- app functions

-- Push 1-20 themes. Each item: { theme_id, payload, payload_hash, schema_ver?, min_reader_ver?, app_ver?, edited_at }.
-- Same theme id: the newer edited_at wins (equal times: the larger branch id wins, so every server picks the same one); the older
-- version goes to sn_theme_history, never deleted. Outcomes: accepted (new theme) | noop (same hash) | won (replaced an older
-- version) | lost (an older edit than the stored one; kept in history, the stored version stays current).
-- Returns an array of { theme_id, outcome, version, server_seq }.
create or replace function public.sn_theme_push(p_license text, p_branch_id uuid, p_items jsonb)
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
  v_theme text;
  v_payload jsonb;
  v_hash text;
  v_schema int;
  v_minr int;
  v_app text;
  v_edited timestamptz;
  v_row public.sn_themes%rowtype;
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
  if v_n > 20 then
    raise exception 'too_many' using errcode = 'Q3I03';
  end if;
  if pg_catalog.octet_length(p_items::text) > 2097152 then
    raise exception 'payload_too_large' using errcode = 'Q3R01';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snt:' || v_org::text, 0));

  for v_i in 0..(v_n - 1) loop
    v_item := p_items -> v_i;
    begin
      if pg_catalog.jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_input' using errcode = 'Q3I01';
      end if;
      v_theme   := v_item ->> 'theme_id';
      v_payload := v_item -> 'payload';
      v_hash    := v_item ->> 'payload_hash';
      v_schema  := coalesce((v_item ->> 'schema_ver')::int, 1);
      v_minr    := coalesce((v_item ->> 'min_reader_ver')::int, 1);
      v_app     := coalesce(v_item ->> 'app_ver', '');
      v_edited  := (v_item ->> 'edited_at')::timestamptz;
    exception
      when others then
        raise exception 'invalid_input' using errcode = 'Q3I01';
    end;
    if v_theme is null or v_theme !~ '^[a-z0-9][a-z0-9-]{0,39}$'
       or v_payload is null or pg_catalog.jsonb_typeof(v_payload) <> 'object'
       or v_hash is null or pg_catalog.char_length(v_hash) not between 8 and 128
       or v_schema < 1 or v_minr < 1 or pg_catalog.char_length(v_app) > 40
       or v_edited is null then
      raise exception 'invalid_input' using errcode = 'Q3I01';
    end if;
    if pg_catalog.octet_length(v_payload::text) > 65536 then
      raise exception 'payload_too_large' using errcode = 'Q3R01';
    end if;

    select * into v_row from public.sn_themes t where t.org_id = v_org and t.theme_id = v_theme for update;

    if not found then
      insert into public.sn_themes (org_id, theme_id, version, payload, payload_hash, schema_ver, min_reader_ver, app_ver, edited_at, from_branch)
      values (v_org, v_theme, 1, v_payload, v_hash, v_schema, v_minr, v_app, v_edited, p_branch_id)
      returning version, server_seq into v_version, v_seq;
      v_outcome := 'accepted';
      v_changed := true;

    elsif v_row.payload_hash = v_hash then
      v_outcome := 'noop';
      v_version := v_row.version;
      v_seq := v_row.server_seq;

    else
      v_wins := v_edited > v_row.edited_at
                or (v_edited = v_row.edited_at and p_branch_id > coalesce(v_row.from_branch, '00000000-0000-0000-0000-000000000000'::uuid));
      if v_wins then
        perform public.sn_theme_history_add(v_org, v_theme, v_row.version, v_row.payload, v_row.from_branch, v_row.edited_at, 'superseded');
        update public.sn_themes t
           set version = t.version + 1, server_seq = pg_catalog.nextval('public.sn_theme_seq'), payload = v_payload,
               payload_hash = v_hash, schema_ver = v_schema, min_reader_ver = v_minr, app_ver = v_app, edited_at = v_edited,
               from_branch = p_branch_id, updated_at = pg_catalog.now()
         where t.org_id = v_org and t.theme_id = v_theme
        returning t.version, t.server_seq into v_version, v_seq;
        v_outcome := 'won';
      else
        perform public.sn_theme_history_add(v_org, v_theme, v_row.version, v_payload, p_branch_id, v_edited, 'conflict_loser');
        update public.sn_themes t
           set version = t.version + 1, server_seq = pg_catalog.nextval('public.sn_theme_seq'), updated_at = pg_catalog.now()
         where t.org_id = v_org and t.theme_id = v_theme
        returning t.version, t.server_seq into v_version, v_seq;
        v_outcome := 'lost';
      end if;
      v_changed := true;
    end if;

    v_results := v_results || pg_catalog.jsonb_build_object('theme_id', v_theme, 'outcome', v_outcome, 'version', v_version, 'server_seq', v_seq);
  end loop;

  -- Same doorbell as bills (one tiny row per organisation) so the other computers look for changes soon [A].
  if v_changed then
    insert into public.sn_ping (org_id, seq, at) values (v_org, 1, pg_catalog.now())
    on conflict (org_id) do update set seq = public.sn_ping.seq + 1, at = pg_catalog.now();
  end if;
  update public.sn_branches b set last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id;
  return v_results;
end
$$;

-- Changed themes with server_seq > p_after_seq, in order: at most p_limit (default 50, max 50) rows and about 2 MB of payload
-- (always at least one row). Returns { items, has_more, server_time }. Pulling deletes nothing; it includes the caller's own themes.
create or replace function public.sn_theme_pull(p_license text, p_branch_id uuid, p_after_seq bigint default 0, p_limit int default 50)
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
  if v_after < 0 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_input' using errcode = 'Q3I01';
  end if;
  for r in
    select x.theme_id, x.version, x.server_seq, x.payload, x.payload_hash, x.schema_ver, x.min_reader_ver, x.app_ver, x.edited_at, x.from_branch
      from public.sn_themes x
     where x.org_id = v_org and x.server_seq > v_after
     order by x.server_seq
     limit p_limit + 1
  loop
    v_size := pg_catalog.octet_length(r.payload::text);
    if v_n >= p_limit or (v_n > 0 and v_bytes + v_size > 2097152) then
      v_more := true;
      exit;
    end if;
    v_items := v_items || pg_catalog.jsonb_build_object(
      'theme_id', r.theme_id, 'version', r.version, 'server_seq', r.server_seq, 'payload', r.payload,
      'payload_hash', r.payload_hash, 'schema_ver', r.schema_ver, 'min_reader_ver', r.min_reader_ver,
      'app_ver', r.app_ver, 'edited_at', r.edited_at, 'from_branch', r.from_branch
    );
    v_n := v_n + 1;
    v_bytes := v_bytes + v_size;
  end loop;
  update public.sn_branches b set last_seen_at = pg_catalog.now() where b.branch_id = p_branch_id;
  return pg_catalog.jsonb_build_object('items', v_items, 'has_more', v_more, 'server_time', pg_catalog.now());
end
$$;

-- ---------------------------------------------------------------- privileges: nothing for anon; the two app functions for signed-in seats

revoke all on function public.sn_theme_history_add(uuid, text, int, jsonb, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.sn_theme_push(text, uuid, jsonb)                                      from public, anon, authenticated;
revoke all on function public.sn_theme_pull(text, uuid, bigint, int)                                from public, anon, authenticated;

grant execute on function public.sn_theme_push(text, uuid, jsonb)                                   to authenticated;
grant execute on function public.sn_theme_pull(text, uuid, bigint, int)                             to authenticated;
