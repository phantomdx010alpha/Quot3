-- Quot3 MASTER project - M04: up to 50 seats per company   (Defect fix 0.1.61; API_CONTRACTS.md M24-0)
-- Safe to run more than once. Run on the MASTER project only (never on a company project). Run it AFTER seat 1's PC runs 0.1.61 and BEFORE adding seat 16.
-- Never edit this file after the owner has run it; a later change is a new numbered file.
--
-- What it does: M01 allowed 15 seats (max_seats 1..15, seat_no 1..15). This widens both checks to 50, makes 50 the default for new companies and
-- raises every existing company to 50. Seats, codes, devices and profiles already stored are not touched.

do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl
      from pg_catalog.pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.companies'::regclass, 'public.seats'::regclass)
       and (   (c.conrelid = 'public.companies'::regclass and pg_catalog.pg_get_constraintdef(c.oid) ilike '%max_seats%<= 15%')
            or (c.conrelid = 'public.seats'::regclass and pg_catalog.pg_get_constraintdef(c.oid) ilike '%seat_no%<= 15%'))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$$;

alter table public.companies drop constraint if exists companies_max_seats_check;
alter table public.companies add constraint companies_max_seats_check check (max_seats between 1 and 50);
alter table public.companies alter column max_seats set default 50;

alter table public.seats drop constraint if exists seats_seat_no_check;
alter table public.seats add constraint seats_seat_no_check check (seat_no between 1 and 50);

update public.companies set max_seats = 50 where max_seats < 50;
