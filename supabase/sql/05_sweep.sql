-- Quot3 sync postbox - 05: sweep               (Phase 51)
-- Deletes postbox rows nobody acknowledged before expires_at (default 30 days). NOT callable by the app: it takes no
-- license because it touches nothing but expired ciphertext, and only the database owner / pg_cron may run it.

create or replace function public.qt_sweep()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  with d as (
    delete from public.postbox p where p.expires_at < now() returning 1
  )
  select count(*) into v_n from d;
  return v_n;
end
$$;

revoke all on function public.qt_sweep() from public, anon, authenticated;

-- Schedule it daily at 03:17 when the pg_cron extension is enabled (Supabase: Database > Extensions > pg_cron).
-- Without pg_cron this only prints a notice; run "select public.qt_sweep();" by hand now and then, or add an Edge
-- Function on a schedule that calls it with the service role (that key stays on the server, never in the app).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'qt_sweep_daily';
    perform cron.schedule('qt_sweep_daily', '17 3 * * *', 'select public.qt_sweep()');
    raise notice 'qt_sweep_daily scheduled (03:17 daily)';
  else
    raise notice 'pg_cron is not enabled: qt_sweep is NOT scheduled. See docs/SUPABASE_MIGRATIONS.md';
  end if;
end
$$;
