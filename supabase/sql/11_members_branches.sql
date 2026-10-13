-- Quot3 shared notebook - 11: members and branches   (Phase 128; spec: docs/SYNC_SHARED_STORE_SPEC.md sections 3, 4, 11)
-- Safe to run more than once. Run after 01-06 (it reuses public.licenses; files 01-06 are NOT edited). NOT yet run on a real Postgres.
--
-- sn_members : one row per seat = one Supabase Auth login (email + password) belonging to one organisation.
-- sn_branches: one row per installation (branch). Name and PO prefix are unique per organisation.
-- RLS is turned on in 13_rls.sql; the tables are never written by the app directly, only by security-definer RPCs.

create table if not exists public.sn_members (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  org_id      uuid        not null references public.licenses (org_id) on delete cascade,
  seat_no     int         not null check (seat_no between 1 and 50),
  -- The branch this seat is bound to right now (null until the computer activates). A seat holds one branch id at a time.
  branch_id   uuid        null,
  created_at  timestamptz not null default now(),
  unique (org_id, seat_no)
);

create index if not exists sn_members_org_idx on public.sn_members (org_id);

create table if not exists public.sn_branches (
  branch_id      uuid        primary key,
  org_id         uuid        not null references public.licenses (org_id) on delete cascade,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  name           text        not null check (char_length(name) between 1 and 80),
  -- Lower-case, trimmed, inner spaces collapsed: "Main  Shop" and "main shop" are the same name.
  name_norm      text        not null check (char_length(name_norm) between 1 and 80),
  -- Same alphabet / length the app validates (validatePoPrefix): upper-case letters, digits, - _ /  (1 to 8 chars).
  po_prefix      text        not null check (po_prefix ~ '^[A-Z0-9_/-]{1,8}$'),
  device_name    text        not null default '' check (char_length(device_name) <= 80),
  registered_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (org_id, name_norm),
  unique (org_id, po_prefix)
);

create index if not exists sn_branches_org_idx  on public.sn_branches (org_id);
create index if not exists sn_branches_user_idx on public.sn_branches (user_id);

-- A seat's current branch must be a real branch (added after both tables exist; guarded so a re-run does not fail).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sn_members_branch_fk') then
    alter table public.sn_members
      add constraint sn_members_branch_fk foreign key (branch_id) references public.sn_branches (branch_id) on delete set null;
  end if;
end
$$;

alter table public.sn_members  enable row level security;
alter table public.sn_branches enable row level security;
revoke all on table public.sn_members  from public, anon, authenticated;
revoke all on table public.sn_branches from public, anon, authenticated;
