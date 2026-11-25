-- Quot3 MASTER project - M05: one Payments list per company   (Phase 280; API_CONTRACTS.md M25-3)
-- NEVER RUN from the sandbox. The owner runs it ONCE in the MASTER project's SQL editor, before deploying `payments-get` / `payments-set`.
-- Safe to run more than once. Never edit this file after the owner has run it; a change is a new numbered file (M06_...).
--
-- What it does: adds two columns to `companies`: `payments` (a PaymentsBody: recipient, defaultId, accounts[]; `{}` = never set) and
-- `payments_version` (0 = never set; the function raises it by exactly 1 per real change). No policy or grant change: RLS stays on with no
-- policy (M02), so only the Edge Functions (service role) can read or write these columns. Bank details are never logged.

alter table public.companies add column if not exists payments jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(payments) = 'object');
alter table public.companies add column if not exists payments_version int not null default 0 check (payments_version >= 0);
