-- Quot3 shared notebook - 14: license + login generator   (Phase 129; spec: docs/SYNC_SHARED_STORE_SPEC.md section 5)
-- Safe to run more than once. Run after 04 (needs public.qt_license_hash) and 11 (needs sn_members). NOT yet run on a real Supabase.
--
-- OWNER-ONLY: run these from the Supabase SQL editor. No function here is granted to anon / authenticated, so the app can never
-- call them (Supabase grants new public functions to the app roles by default; every function below revokes that explicitly).
--
--   select * from public.qt_create_org('Acme Traders', 3);
--   select * from public.qt_create_org('Acme Traders', 3, array['blr@acme.in','mys@acme.in','hub@acme.in']);
--
-- It returns one row per seat: license_key (same on every row), seat_no, email, password. SHOWN ONCE: the key is stored only as
-- its SHA-256 hash, and passwords only as bcrypt inside auth.users. Nothing here logs, notices or stores a password or key.
--
-- [A] MECHANISM NOT PROVEN until the owner runs it: qt_make_login inserts into auth.users and auth.identities (Supabase-internal
-- tables, the usual SQL-editor technique). If it fails, create the logins in Dashboard -> Authentication -> Users (auto-confirm)
-- and attach each one with: select * from public.qt_attach_seat('Acme Traders', 'user@email');
-- Before use: Dashboard -> Authentication -> Providers -> Email -> turn OFF "Allow new users to sign up".

-- ---------------------------------------------------------------- internal helpers

-- 16 characters from a 32-symbol alphabet without look-alikes (no I, O, 0, 1): byte & 31 is uniform, 80 bits.
create or replace function public.qt_gen_password()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(16);
  v_out text := '';
  v_i int;
begin
  for v_i in 0..15 loop
    v_out := v_out || pg_catalog.substr(v_alphabet, (pg_catalog.get_byte(v_bytes, v_i) & 31) + 1, 1);
  end loop;
  return v_out;
end
$$;

-- License key Q3-XXXX-XXXX-XXXX, letters A-Z and 2-7 (same alphabet as scripts/generate-license.mjs), 60 bits.
create or replace function public.qt_gen_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_chars text := '';
  v_i int;
begin
  for v_i in 0..11 loop
    v_chars := v_chars || pg_catalog.substr(v_alphabet, (pg_catalog.get_byte(v_bytes, v_i) & 31) + 1, 1);
  end loop;
  return 'Q3-' || pg_catalog.substr(v_chars, 1, 4) || '-' || pg_catalog.substr(v_chars, 5, 4) || '-' || pg_catalog.substr(v_chars, 9, 4);
end
$$;

-- Lower-case a-z0-9 and single dashes, at most 24 characters, never empty (used only for generated emails).
create or replace function public.qt_slug(p_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_label, '')), '[^a-z0-9]+', '-', 'g'), '-'), 24), ''), 'org')
$$;

-- The organisation for a label (case- and space-insensitive). Raises when there is none or more than one.
create or replace function public.qt_org_by_label(p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_org uuid;
begin
  select pg_catalog.count(*), pg_catalog.min(l.org_id::text)::uuid into v_n, v_org
    from public.licenses l
   where pg_catalog.lower(pg_catalog.btrim(l.label)) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_label, '')));
  if v_n = 0 then
    raise exception 'no organisation with that label' using errcode = 'Q3I01';
  elsif v_n > 1 then
    raise exception 'more than one organisation has that label' using errcode = 'Q3I01';
  end if;
  return v_org;
end
$$;

-- Creates one confirmed email/password login in Supabase Auth and returns its user id. [A] unproven until run on a real project.
create or replace function public.qt_make_login(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_uid uuid := pg_catalog.gen_random_uuid();
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.char_length(v_email) > 200 then
    raise exception 'invalid email address' using errcode = 'Q3I01';
  end if;
  if coalesce(p_password, '') = '' then
    raise exception 'empty password' using errcode = 'Q3I01';
  end if;
  if exists (select 1 from auth.users u where pg_catalog.lower(u.email) = v_email) then
    raise exception 'that email already has a login' using errcode = 'Q3I01';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now(),
    '', '', '', '',
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    pg_catalog.gen_random_uuid(), v_uid, v_uid::text, 'email',
    pg_catalog.jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  );
  return v_uid;
end
$$;

-- ---------------------------------------------------------------- the owner's functions

create or replace function public.qt_create_org(
  p_label   text,
  p_seats   int,
  p_emails  text[] default null,
  p_domain  text   default 'quot3.example.com'
)
returns table (license_key text, seat_no int, email text, password text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_label text := pg_catalog.btrim(coalesce(p_label, ''));
  v_domain text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_domain, '')));
  v_key text;
  v_org uuid;
  v_i int;
  v_email text;
  v_pw text;
  v_uid uuid;
begin
  if pg_catalog.char_length(v_label) not between 1 and 100 then
    raise exception 'label must be 1 to 100 characters' using errcode = 'Q3I01';
  end if;
  if p_seats is null or p_seats not between 1 and 50 then
    raise exception 'seats must be between 1 and 50' using errcode = 'Q3I01';
  end if;
  if p_emails is not null and coalesce(pg_catalog.array_length(p_emails, 1), 0) <> p_seats then
    raise exception 'give exactly one email per seat, or none' using errcode = 'Q3I01';
  end if;
  if p_emails is null and v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then
    raise exception 'invalid email domain' using errcode = 'Q3I01';
  end if;
  if exists (select 1 from public.licenses l where pg_catalog.lower(pg_catalog.btrim(l.label)) = pg_catalog.lower(v_label)) then
    raise exception 'an organisation with that label already exists' using errcode = 'Q3I01';
  end if;

  loop
    v_key := public.qt_gen_key();
    exit when not exists (select 1 from public.licenses l where l.key_hash = public.qt_license_hash(v_key));
  end loop;

  insert into public.licenses (key_hash, label, max_branches)
  values (public.qt_license_hash(v_key), v_label, p_seats)
  returning org_id into v_org;

  for v_i in 1..p_seats loop
    if p_emails is not null then
      v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_emails[v_i], '')));
    else
      v_email := public.qt_slug(v_label) || '-' || v_i::text || '@' || v_domain;
    end if;
    v_pw := public.qt_gen_password();
    v_uid := public.qt_make_login(v_email, v_pw);
    insert into public.sn_members (user_id, org_id, seat_no) values (v_uid, v_org, v_i);
    return query select v_key, v_i, v_email, v_pw;
  end loop;
end
$$;

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
  v_last int;
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
  select coalesce(pg_catalog.max(m.seat_no), 0) into v_last from public.sn_members m where m.org_id = v_org;
  if v_last + p_n > 50 then
    raise exception 'an organisation can have at most 50 seats' using errcode = 'Q3I01';
  end if;
  update public.licenses l set max_branches = pg_catalog.greatest(l.max_branches, v_last + p_n) where l.org_id = v_org;

  for v_i in 1..p_n loop
    v_no := v_last + v_i;
    v_email := public.qt_slug(v_label) || '-' || v_no::text || '@' || v_domain;
    v_pw := public.qt_gen_password();
    v_uid := public.qt_make_login(v_email, v_pw);
    insert into public.sn_members (user_id, org_id, seat_no) values (v_uid, v_org, v_no);
    return query select v_no, v_email, v_pw;
  end loop;
end
$$;

-- New password for one seat (shown once). Existing sessions of that login are ended.
create or replace function public.qt_reset_seat(p_label text, p_seat_no int)
returns table (seat_no int, email text, password text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := public.qt_org_by_label(p_label);
  v_uid uuid;
  v_email text;
  v_pw text := public.qt_gen_password();
begin
  select m.user_id into v_uid from public.sn_members m where m.org_id = v_org and m.seat_no = p_seat_no;
  if v_uid is null then
    raise exception 'no such seat' using errcode = 'Q3I01';
  end if;
  update auth.users u
     set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = pg_catalog.now()
   where u.id = v_uid
  returning u.email into v_email;
  delete from auth.sessions s where s.user_id = v_uid;
  return query select p_seat_no, v_email, v_pw;
end
$$;

-- Removes a seat's login (its membership and its branch registration go with it; the bills it synced stay in the notebook).
create or replace function public.qt_revoke_seat(p_label text, p_seat_no int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.qt_org_by_label(p_label);
  v_uid uuid;
begin
  select m.user_id into v_uid from public.sn_members m where m.org_id = v_org and m.seat_no = p_seat_no;
  if v_uid is null then
    raise exception 'no such seat' using errcode = 'Q3I01';
  end if;
  delete from auth.users u where u.id = v_uid;
  return 'seat ' || p_seat_no::text || ' revoked';
end
$$;

-- 'suspended' also bans the seats' logins (no sign-in, no token refresh); a token already issued can still read until it expires (about 1 hour).
create or replace function public.qt_set_license_status(p_label text, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.qt_org_by_label(p_label);
begin
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'status must be active or suspended' using errcode = 'Q3I01';
  end if;
  update public.licenses l set status = p_status where l.org_id = v_org;
  update auth.users u
     set banned_until = case when p_status = 'suspended' then 'infinity'::timestamptz else null end
   where u.id in (select m.user_id from public.sn_members m where m.org_id = v_org);
  return 'license is now ' || p_status;
end
$$;

-- Fallback when qt_make_login cannot create users: the login already exists (made in the dashboard); give it the next free seat.
create or replace function public.qt_attach_seat(p_label text, p_email text)
returns table (seat_no int, email text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := public.qt_org_by_label(p_label);
  v_max int;
  v_uid uuid;
  v_email text;
  v_no int;
begin
  select u.id, u.email into v_uid, v_email from auth.users u where pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  if v_uid is null then
    raise exception 'no login with that email; create it in Authentication -> Users first' using errcode = 'Q3I01';
  end if;
  if exists (select 1 from public.sn_members m where m.user_id = v_uid) then
    raise exception 'that login already has a seat' using errcode = 'Q3I01';
  end if;
  select l.max_branches into v_max from public.licenses l where l.org_id = v_org;
  select g.n into v_no
    from pg_catalog.generate_series(1, v_max) as g(n)
   where not exists (select 1 from public.sn_members m where m.org_id = v_org and m.seat_no = g.n)
   order by g.n limit 1;
  if v_no is null then
    raise exception 'no free seat; raise the seat count with qt_add_seats or revoke one' using errcode = 'Q3I01';
  end if;
  insert into public.sn_members (user_id, org_id, seat_no) values (v_uid, v_org, v_no);
  return query select v_no, v_email::text;
end
$$;

-- ---------------------------------------------------------------- owner-only: nothing is granted to the app roles
revoke all on function public.qt_gen_password()                       from public, anon, authenticated;
revoke all on function public.qt_gen_key()                            from public, anon, authenticated;
revoke all on function public.qt_slug(text)                           from public, anon, authenticated;
revoke all on function public.qt_org_by_label(text)                   from public, anon, authenticated;
revoke all on function public.qt_make_login(text, text)               from public, anon, authenticated;
revoke all on function public.qt_create_org(text, int, text[], text)  from public, anon, authenticated;
revoke all on function public.qt_add_seats(text, int, text)           from public, anon, authenticated;
revoke all on function public.qt_reset_seat(text, int)                from public, anon, authenticated;
revoke all on function public.qt_revoke_seat(text, int)               from public, anon, authenticated;
revoke all on function public.qt_set_license_status(text, text)       from public, anon, authenticated;
revoke all on function public.qt_attach_seat(text, text)              from public, anon, authenticated;
