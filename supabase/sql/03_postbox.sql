-- Quot3 sync postbox - 03: postbox             (Phase 51)
-- A transient, ENCRYPTED mailbox. The server never sees a party name, an amount or an item: only routing metadata
-- and an AES-256-GCM ciphertext. Rows are deleted when the recipient acknowledges them, or swept after expires_at.

create table if not exists public.postbox (
  id           bigint      generated always as identity primary key,
  org_id       uuid        not null references public.licenses (org_id) on delete cascade,
  from_branch  uuid        not null references public.branches (branch_id) on delete cascade,
  to_branch    uuid        not null references public.branches (branch_id) on delete cascade,
  bill_id      uuid        not null,
  op           text        not null check (op in ('upsert', 'delete')),
  revision     int         not null check (revision >= 0),
  updated_at   timestamptz not null,
  nonce        bytea       not null check (octet_length(nonce) = 12),
  -- 16 bytes is the GCM tag alone; 1 MB is the per-message cap from the spec.
  ciphertext   bytea       not null check (octet_length(ciphertext) between 16 and 1048576),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 days'),
  check (from_branch <> to_branch)
);

create index if not exists postbox_to_branch_idx on public.postbox (to_branch, id);
create index if not exists postbox_expires_idx   on public.postbox (expires_at);

alter table public.postbox enable row level security;
revoke all on table public.postbox from public, anon, authenticated;
