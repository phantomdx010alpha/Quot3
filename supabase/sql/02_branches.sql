-- Quot3 sync postbox - 02: branches            (Phase 51)
-- A branch is one installation. PO prefix is unique within an organisation (the sync spec's PO-number rule).

create table if not exists public.branches (
  branch_id      uuid        primary key,
  org_id         uuid        not null references public.licenses (org_id) on delete cascade,
  name           text        not null check (char_length(name) between 1 and 80),
  -- Same alphabet / length the app validates (validatePoPrefix): upper-case letters, digits, - _ /  (1 to 8 chars).
  po_prefix      text        not null check (po_prefix ~ '^[A-Z0-9_/-]{1,8}$'),
  device_name    text        not null default '' check (char_length(device_name) <= 80),
  registered_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (org_id, po_prefix)
);

create index if not exists branches_org_idx on public.branches (org_id);

alter table public.branches enable row level security;
revoke all on table public.branches from public, anon, authenticated;
