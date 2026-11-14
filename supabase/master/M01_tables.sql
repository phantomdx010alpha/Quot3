-- Quot3 MASTER project - M01: tables   (Phase 258, Milestone 24; API_CONTRACTS.md "M24-0" section C3 is the spec, docs/MILESTONE24_DESIGN.md section 4)
-- This is the MASTER project's own series (M01..). It is NEVER mixed into supabase/sql/ (the per-company series) and NEVER run on a company project.
-- Safe to run more than once. Run M01, then M02, then M03. NEVER RUN from the sandbox: "works on Supabase" is a standing gap until the owner
-- runs the checklist of Phase 273 (docs/M24_OWNER_CHECKLIST.md). Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What the master holds: the company registry, seat credentials (sealed), device tokens (hashed), the company profile. NEVER bills, Price List data
-- or any company data. Every *_enc column holds text sealed by shared/master/seal.ts (AES-256-GCM, key MASTER_KEK lives only in the Edge Function
-- secrets, never in this database), so a dump of these tables alone reveals no password, license key or service_role key.
-- Only the master's own Edge Functions (its service role) touch these tables; M02 switches RLS on with no policy and revokes every client role.

-- 1. companies: one row per company project
create table if not exists public.companies (
  id               uuid primary key default gen_random_uuid(),
  label            text not null unique check (char_length(label) between 1 and 80),
  org_id           uuid not null,                       -- licenses.org_id inside the company project (read at enrol)
  supabase_url     text not null unique check (supabase_url ~ '^https://'),
  anon_key         text not null,
  license_key_enc  text not null,
  service_role_enc text not null,
  status           text not null default 'active' check (status in ('active', 'suspended')),
  max_seats        int  not null default 15 check (max_seats between 1 and 15),
  profile          jsonb not null default '{}'::jsonb,
  profile_version  int  not null default 0 check (profile_version >= 0),
  created_at       timestamptz not null default now()
);

-- 2. seats: up to 15 per company; a legacy seat existed before the master and its password is unknown until its first reset
create table if not exists public.seats (
  company_id    uuid not null references public.companies (id) on delete cascade,
  seat_no       int  not null check (seat_no between 1 and 15),
  label         text not null check (char_length(label) between 1 and 40),
  email         text,                                   -- null only for a legacy seat not seen yet (filled at first adopt)
  auth_user_id  uuid,                                   -- the company project's auth user id (adopt maps a session to a seat with it)
  password_enc  text,                                   -- null for a legacy seat until its first reset
  code_hash     text unique,                            -- sha256 hex of the 16 normalised code characters (never the code itself)
  code_enc      text,                                   -- the full Q3C-... code, sealed, so seat 1 can show it again
  code_hint     text check (code_hint is null or char_length(code_hint) = 4),
  legacy        boolean not null default false,
  status        text not null default 'active' check (status in ('active', 'revoked')),
  created_at    timestamptz not null default now(),
  reset_at      timestamptz,
  primary key (company_id, seat_no),
  check (not legacy or (password_enc is null and code_hash is null and code_enc is null)),
  check (status = 'active' or (code_hash is null and code_enc is null))
);

-- 3. devices: one row per linked phone / PC; only the hash of its token is stored
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  seat_no      int  not null,
  token_hash   text not null unique,
  label        text not null default '' check (char_length(label) <= 40),
  platform     text not null check (platform in ('desktop', 'phone')),
  app_version  text not null default '' check (char_length(app_version) <= 40),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  foreign key (company_id, seat_no) references public.seats (company_id, seat_no) on delete cascade
);

-- 4. enrol_tokens: owner-minted, one use, lets ONE existing company be registered
create table if not exists public.enrol_tokens (
  token_hash    text primary key,
  company_label text not null check (char_length(company_label) between 1 and 80),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- 5. attempts: the rate limit for redeem / adopt / enrol (10 failures per 15 minutes per ip_hash, counted by m_attempts_recent in M03)
create table if not exists public.attempts (
  id      bigserial primary key,
  ip_hash text not null,
  at      timestamptz not null default now(),
  ok      boolean not null
);
create index if not exists attempts_ip_at_idx on public.attempts (ip_hash, at);

-- 6. master_log: what happened, never a secret (detail is 'ok' or an error code); req_id makes a write idempotent (a repeat is refused Q3M13)
create table if not exists public.master_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  company_id uuid,
  seat_no    int,
  action     text not null,
  req_id     uuid,
  detail     text not null default '' check (char_length(detail) <= 500)
);
create unique index if not exists master_log_req_idx on public.master_log (company_id, action, req_id) where req_id is not null;
