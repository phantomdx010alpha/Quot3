-- Quot3 shared notebook - 16: Realtime doorbell   (Phase 131; spec: docs/SYNC_SHARED_STORE_SPEC.md section 10)
-- Safe to run more than once. Run after 11-15. NOT yet run on a real Supabase.
--
-- Adds ONLY public.sn_ping to the Realtime publication. sn_ping holds one tiny row per organisation (a counter and a time);
-- sn_push touches it once per call that changed something. The app listens to postgres_changes on it, filtered to its own
-- organisation, and the event carries no bill data: on a ring the app simply runs its normal pull. A 60 s poll is always the backup.
-- Row visibility for Realtime follows the SELECT policy on sn_ping (file 13): a seat only receives its own organisation's ring.
-- No other table is published, so bills, customers and history never travel through Realtime.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime does not exist: nothing added (on Supabase it always exists; plain Postgres needs it set up first)';
  elsif exists (
    select 1 from pg_catalog.pg_publication_tables t
     where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'sn_ping'
  ) then
    raise notice 'sn_ping is already in the supabase_realtime publication';
  else
    alter publication supabase_realtime add table public.sn_ping;
    raise notice 'sn_ping added to the supabase_realtime publication';
  end if;
end
$$;
