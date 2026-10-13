-- Quot3 sync postbox - 01: licenses            (Phase 51; spec: docs/SYNC_POSTBOX_SPEC.md section 3)
-- Safe to run more than once. Run the files in numeric order (see docs/SUPABASE_MIGRATIONS.md).
--
-- One license = one organisation. The license KEY is never stored: only its SHA-256 (see qt_license_hash in 04).
-- The table is unreachable from the app's anon key: RLS is ON, there are NO policies, and all privileges are revoked.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.licenses (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null unique default gen_random_uuid(),
  key_hash      text        not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label         text        not null default '' check (char_length(label) <= 100),
  -- Public per-organisation salt for the passphrase KDF (PBKDF2). Not a secret; returned by qt_register_branch.
  kdf_salt      bytea       not null default extensions.gen_random_bytes(16) check (octet_length(kdf_salt) >= 16),
  status        text        not null default 'active' check (status in ('active', 'suspended')),
  max_branches  int         not null default 5 check (max_branches between 1 and 50),
  created_at    timestamptz not null default now()
);

alter table public.licenses enable row level security;
-- Deliberately NO "create policy" for licenses: with RLS on and no policy, anon / authenticated can read and write nothing.
revoke all on table public.licenses from public, anon, authenticated;
