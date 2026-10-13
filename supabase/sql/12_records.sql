-- Quot3 shared notebook - 12: records, history, doorbell   (Phase 128; spec sections 4, 6, 10)
-- Safe to run more than once. Run after 11. NOT yet run on a real Postgres.
--
-- sn_records: the notebook. One row per (organisation, kind, record id), holding the CURRENT readable version as jsonb.
-- sn_history: older versions and conflict losers (capped at 20 per record by the push RPC, Phase 130).
-- sn_ping   : one tiny row per organisation; Realtime watches it as a data-less doorbell (Phase 131 adds it to the publication).

-- One monotonic counter for pull ordering (gaps allowed).
create sequence if not exists public.sn_server_seq as bigint;

create table if not exists public.sn_records (
  org_id          uuid        not null references public.licenses (org_id) on delete cascade,
  kind            text        not null check (kind in ('bill', 'party', 'party_merge', 'item_rule')),
  rec_id          uuid        not null,
  version         int         not null default 1 check (version >= 1),
  server_seq      bigint      not null default nextval('public.sn_server_seq'),
  deleted         boolean     not null default false,
  payload         jsonb       not null check (octet_length(payload::text) <= 1048576),
  payload_hash    text        not null check (char_length(payload_hash) between 8 and 128),
  schema_ver      int         not null default 1 check (schema_ver >= 1),
  -- A reader older than this sets the record aside; it never strips or overwrites it.
  min_reader_ver  int         not null default 1 check (min_reader_ver >= 1),
  app_ver         text        not null default '' check (char_length(app_ver) <= 40),
  edited_at       timestamptz not null,
  from_branch     uuid        null,
  updated_at      timestamptz not null default now(),
  primary key (org_id, kind, rec_id)
);

create index if not exists sn_records_seq_idx on public.sn_records (org_id, server_seq);

create table if not exists public.sn_history (
  id           bigserial   primary key,
  org_id       uuid        not null references public.licenses (org_id) on delete cascade,
  kind         text        not null check (kind in ('bill', 'party', 'party_merge', 'item_rule')),
  rec_id       uuid        not null,
  version      int         not null check (version >= 1),
  payload      jsonb       not null check (octet_length(payload::text) <= 1048576),
  from_branch  uuid        null,
  edited_at    timestamptz not null,
  replaced_at  timestamptz not null default now(),
  reason       text        not null check (reason in ('superseded', 'conflict_loser'))
);

create index if not exists sn_history_rec_idx on public.sn_history (org_id, kind, rec_id, id);

create table if not exists public.sn_ping (
  org_id  uuid        primary key references public.licenses (org_id) on delete cascade,
  seq     bigint      not null default 0,
  at      timestamptz not null default now()
);

alter table public.sn_records enable row level security;
alter table public.sn_history enable row level security;
alter table public.sn_ping    enable row level security;
revoke all on table public.sn_records from public, anon, authenticated;
revoke all on table public.sn_history from public, anon, authenticated;
revoke all on table public.sn_ping    from public, anon, authenticated;
revoke all on sequence public.sn_server_seq from public, anon, authenticated;
revoke all on sequence public.sn_history_id_seq from public, anon, authenticated;
