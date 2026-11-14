-- Quot3 MASTER project - M02: row level security and revokes   (Phase 258, Milestone 24; API_CONTRACTS.md "M24-0" section C3)
-- Safe to run more than once. Run after M01. NEVER RUN from the sandbox (see M01). Never edit after the owner has run it.
--
-- The rule: RLS is ON for every master table and there is NOT A SINGLE POLICY, and every client role is revoked. A phone, a PC or anyone holding
-- the master's public anon key can therefore read and write NOTHING in these tables; they can only call the Edge Functions, which use the
-- master's own service role (it bypasses RLS). There is deliberately no grant to anon or authenticated anywhere in this series.
-- Also switch OFF "Allow new users to sign up" in the master project's Auth settings (the master has no end-users at all).

alter table public.companies    enable row level security;
alter table public.seats        enable row level security;
alter table public.devices      enable row level security;
alter table public.enrol_tokens enable row level security;
alter table public.attempts     enable row level security;
alter table public.master_log   enable row level security;

revoke all on table public.companies    from public, anon, authenticated;
revoke all on table public.seats        from public, anon, authenticated;
revoke all on table public.devices      from public, anon, authenticated;
revoke all on table public.enrol_tokens from public, anon, authenticated;
revoke all on table public.attempts     from public, anon, authenticated;
revoke all on table public.master_log   from public, anon, authenticated;

revoke all on sequence public.attempts_id_seq   from public, anon, authenticated;
revoke all on sequence public.master_log_id_seq from public, anon, authenticated;
