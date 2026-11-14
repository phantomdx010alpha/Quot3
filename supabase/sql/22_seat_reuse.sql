-- Quot3 shared notebook - 22: a new seat takes the LOWEST FREE number   (Defect fix 0.1.61; docs/MILESTONE24_DESIGN.md)
-- Safe to run more than once. Run after 21, in each COMPANY project (never on the master). NEVER RUN from the sandbox.
-- Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What this file does: replaces qt_add_seats (same argument list and result as file 14). File 14 numbered a new seat "highest number + 1", so a
-- deleted seat in the middle was never given out again and 15 deletions did not make room. Now the lowest unused number from 1 to 50 is used, so
-- deleting seat 3 and adding a seat makes seat 3 again. An organisation can still hold at most 50 seats at once.

create or replace function public.qt_add_seats(p_label text, p_n int, p_domain text default 'quot3.example.com')
returns table (seat_no int, email text, password text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := public.qt_org_by_label(p_label);
  v_label text;
  v_domain text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_domain, '')));
  v_cnt int;
  v_i int;
  v_no int;
  v_email text;
  v_pw text;
  v_uid uuid;
begin
  if p_n is null or p_n not between 1 and 50 then
    raise exception 'n must be between 1 and 50' using errcode = 'Q3I01';
  end if;
  if v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then
    raise exception 'invalid email domain' using errcode = 'Q3I01';
  end if;
  select l.label into v_label from public.licenses l where l.org_id = v_org;
  select pg_catalog.count(*) into v_cnt from public.sn_members m where m.org_id = v_org;
  if v_cnt + p_n > 50 then
    raise exception 'an organisation can have at most 50 seats' using errcode = 'Q3I01';
  end if;

  for v_i in 1..p_n loop
    select pg_catalog.min(g.n) into v_no
      from pg_catalog.generate_series(1, 50) as g(n)
     where not exists (select 1 from public.sn_members m where m.org_id = v_org and m.seat_no = g.n);
    update public.licenses l set max_branches = pg_catalog.greatest(l.max_branches, v_no, v_cnt + v_i) where l.org_id = v_org;
    v_email := public.qt_slug(v_label) || '-' || v_no::text || '@' || v_domain;
    v_pw := public.qt_gen_password();
    v_uid := public.qt_make_login(v_email, v_pw);
    insert into public.sn_members (user_id, org_id, seat_no) values (v_uid, v_org, v_no);
    return query select v_no, v_email, v_pw;
  end loop;
end
$$;

revoke all on function public.qt_add_seats(text, int, text) from public, anon, authenticated;
