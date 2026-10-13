-- Quot3 - 99: DROP THE V1 POSTBOX   (Phase 131 writes it; it is used in Phase 142 / after the Phase 140 cutover)
-- OWNER-RUN ONLY, and only when ALL of these are true:
--   1. every computer runs the new app (Milestone 12) and has synced through the shared notebook,
--   2. the real-Supabase checklist v2 in docs/SUPABASE_MIGRATIONS.md is ticked,
--   3. you no longer need any row still waiting in the old postbox (those rows are encrypted and cannot be read without the old passphrase).
-- It is NOT wired into anything and is NOT run by the app, the tests or the self-tests. It is destructive: take a Supabase backup or
-- an export of the two tables first if in doubt.
--
-- To arm it, change the word NO below to DROP V1 and run the whole file. As shipped it refuses and changes nothing.
--
-- What it removes: the v1 tables postbox and branches, the v1 functions qt_register_branch, qt_list_branches, qt_push, qt_pull, qt_ack,
-- qt_touch, qt_sweep, qt_pending_count, qt_auth, and the daily sweep schedule when pg_cron has one.
-- What it KEEPS: public.licenses (the new notebook uses it), public.qt_license_hash (the new functions use it), every sn_* table and
-- function, every qt_create_org owner function, and all synced bills.

do $$
declare
  v_confirm constant text := 'NO';
begin
  if v_confirm <> 'DROP V1' then
    raise exception 'refused: edit v_confirm to DROP V1 in this file to run it (see the header)' using errcode = 'Q3I01';
  end if;
  if to_regclass('public.sn_records') is null or to_regclass('public.sn_members') is null then
    raise exception 'refused: the notebook tables (files 11 and 12) are missing, so this is not the new schema' using errcode = 'Q3I01';
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'qt_sweep_daily';
  end if;
end
$$;

drop function if exists public.qt_register_branch(text, uuid, text, text, text);
drop function if exists public.qt_list_branches(text, uuid);
drop function if exists public.qt_push(text, uuid, jsonb);
drop function if exists public.qt_pull(text, uuid, bigint, int);
drop function if exists public.qt_ack(text, uuid, bigint[]);
drop function if exists public.qt_touch(text, uuid);
drop function if exists public.qt_pending_count(text, uuid);
drop function if exists public.qt_sweep();
drop function if exists public.qt_auth(text, uuid);

drop table if exists public.postbox;
drop table if exists public.branches;
