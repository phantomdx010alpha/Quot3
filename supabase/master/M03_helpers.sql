-- Quot3 MASTER project - M03: the two small helpers   (Phase 258, Milestone 24; API_CONTRACTS.md "M24-0" section C3)
-- Safe to run more than once. Run after M02. NEVER RUN from the sandbox (see M01). Never edit after the owner has run it.
--
-- Kept minimal on purpose: hashing of codes and tokens is done inside the Edge Functions, not here. These two functions only count and purge the
-- rate-limit rows of the table `attempts`. Both are SECURITY DEFINER with an empty search_path, are revoked from every client role, and are
-- executable by the master's own service role only (the Edge Functions).

-- 1. failures from one ip_hash in the last 15 minutes (redeem / adopt / enrol answer Q3M02 at 10)
create or replace function public.m_attempts_recent(p_ip_hash text)
returns int
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::int
  from public.attempts a
  where a.ip_hash = p_ip_hash
    and a.ok = false
    and a.at > pg_catalog.now() - interval '15 minutes'
$$;

-- 2. delete rate-limit rows older than one day; returns how many were removed
create or replace function public.m_attempts_purge()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.attempts a where a.at < pg_catalog.now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.m_attempts_recent(text) from public, anon, authenticated;
revoke all on function public.m_attempts_purge()      from public, anon, authenticated;
grant execute on function public.m_attempts_recent(text) to service_role;
grant execute on function public.m_attempts_purge()      to service_role;
