# SUPABASE_MIGRATIONS — Quot3 sync postbox

The SQL for the optional multi-branch sync (design: `docs/SYNC_POSTBOX_SPEC.md`). Phase 51 wrote it; **it has never been run against a real Postgres** (no database was available when it was written). Run it in a **scratch Supabase project first**, then run the self-test, then record the result in `PHASE_STATUS.md`.

## Milestone 12 (shared notebook) — files 11-16, 91 and 99 WRITTEN (Phases 128-131, 2026-10-12); none of them has been run

Design: `docs/SYNC_SHARED_STORE_SPEC.md`. The v1 files below stay as they are (never edit a file that was run); the new files are added after them. **Nothing in this section has been run against a real Supabase.** Files 11-13 are only checked by the static test in `src/__tests__/supabaseSql.test.ts`. Run 11, 12, 13 in order after 01-06; each is safe to re-run. Plan limits (Free plan size, pause, Realtime) were NOT re-read from Supabase's own page in Phase 128: recorded as "not checked".

| File | What it does |
|---|---|
| `11_members_branches.sql` ✅ written | `sn_members` (login -> organisation, seat), `sn_branches` (unique name_norm and PO prefix per organisation) |
| `12_records.sql` ✅ written | `sn_records` (versioned `jsonb` records, 1 MB cap), `sn_history`, `sn_ping`, the `sn_server_seq` sequence |
| `13_rls.sql` ✅ written | RLS on every `sn_*` table: one select policy each (own organisation via `sn_members`), no write policies, nothing for `anon` |
| `14_license_admin.sql` ✅ written | `qt_create_org` and the owner-only helpers (see below); internal helpers `qt_gen_key`, `qt_gen_password`, `qt_slug`, `qt_org_by_label`, `qt_make_login`; nothing granted to `anon` / `authenticated` |
| `15_rpcs.sql` ✅ written | `sn_now`, `sn_activate`, `sn_branch_name_free`, `sn_rename_branch`, `sn_list_branches`, `sn_manifest`, `sn_push`, `sn_pull`, `sn_touch` |
| `16_realtime.sql` ✅ written | adds ONLY `sn_ping` to the `supabase_realtime` publication (the doorbell); guarded, so re-running only prints a notice; no data table is published |
| `91_selftest_v2.sql` ✅ written | the v2 self-test (see "Run the self-test v2" below); one transaction, ends in ROLLBACK, keeps nothing |
| `99_drop_v1.sql` ✅ written; an OWNER-RUN step (documented in Phase 142, never run by the app or by any test) | OWNER-RUN, only after the cutover (Phase 140) and the checklist: drops the old `postbox` and `branches` tables and the v1 `qt_*` RPCs. It **refuses to run as shipped**: change `v_confirm` from `NO` to `DROP V1` first. It keeps `licenses`, `qt_license_hash`, every `sn_*` object and every `qt_create_org` owner function |
| `17_themes.sql` ✅ written (Phase 170, Milestone 16; NOT run) | shared themes: `sn_themes` + `sn_theme_history` (RLS select-own-organisation, no write policy, nothing for `anon`), `sn_theme_push` / `sn_theme_pull` (the only write / read doors, `authenticated` only), 64 KB per theme, newest `edited_at` wins and the older version is kept (20 per theme). Run it after `16`; safe to re-run; it edits nothing from `01`-`16`. Not part of `91_selftest_v2.sql` (that file may already have been run; see checklist F) |

### App RPC reference (file 15; all `authenticated` only, all need the license key and this seat's branch id)
Named `sn_*` because the v1 `qt_*` functions share signatures (see the header of `15_rpcs.sql`). Errors: `Q3L01` generic license, `Q3A01` not a member, `Q3M01` not this seat's branch, `Q3B02` prefix taken, `Q3B03` branch conflict, `Q3B04` name taken, `Q3B05` seat in use, `Q3I01` invalid input, `Q3I03` too many items, `Q3R01` too large.

| Function | Returns | Notes |
|---|---|---|
| `sn_now()` | timestamptz | server clock for the client's skew measurement |
| `sn_activate(license, branch_id, name, po_prefix, device, takeover)` | `{ org_id, seat_no, server_time, max_server_seq, branches }` | unique name (case/space-insensitive) and prefix; a seat already bound to another branch id needs `takeover = true` (reinstall; the old branch row is removed, freeing its name and prefix) |
| `sn_branch_name_free(license, name, own_branch_id?)` | boolean | |
| `sn_rename_branch(license, branch_id, name)` | `{ branch_id, name }` | |
| `sn_list_branches(license, branch_id)` | array | name, prefix, device, last seen |
| `sn_manifest(license, branch_id, kind, after_rec_id?, limit<=1000)` | array `{ rec_id, version, payload_hash, server_seq, deleted }` | no payloads; ordered by rec_id |
| `sn_push(license, branch_id, items)` | array `{ kind, rec_id, outcome, version, server_seq }` | 1-200 items, 1 MB per payload, 8 MB per call; outcome `accepted` / `noop` / `won` / `lost` (table in `SYNC_SHARED_STORE_SPEC.md` section 6, executable in `src/main/sync/__tests__/pushTruthTable.cases.ts`); history capped at 20 per record; one doorbell touch per call |
| `sn_pull(license, branch_id, after_seq, limit<=200)` | `{ items, has_more, server_time }` | ordered by `server_seq`, about 4 MB per page, deletes nothing |
| `sn_touch(license, branch_id)` | `{ server_time }` | |

### Create an organisation, its license key and the logins (the one query)
Run in the SQL editor (after `04` and `11`–`14`; it does not need `15`); it replaces `scripts/generate-license.mjs` (kept, marked legacy):
```sql
select * from public.qt_create_org('Acme Traders', 3);
-- or with your own emails:
select * from public.qt_create_org('Acme Traders', 3, array['blr@acme.in','mys@acme.in','hub@acme.in']);
```
It returns one row per computer: the **license key** (same on every row), `seat_no`, `email`, `password`. **Copy them now; they are shown once.** Only the key's hash is stored, and passwords exist only as Supabase's bcrypt hash. Give one email/password to each computer; the license key goes in with it at activation; the branch name and PO prefix are chosen in the app. Helpers (all return what they did; new passwords are shown once): `select * from public.qt_add_seats('Acme Traders', 1);`, `select * from public.qt_reset_seat('Acme Traders', 2);` (new password; that login's sessions end), `select public.qt_revoke_seat('Acme Traders', 2);` (deletes the login, its seat and branch registration; synced bills stay), `select public.qt_set_license_status('Acme Traders', 'suspended');` (also bans the logins; a token already issued can still read until it expires, about 1 hour). Labels are matched ignoring case and spaces; a label must be unique. Generated emails look like `acme-traders-1@quot3.example.com` (the domain is the 4th argument of `qt_create_org`; [A] check on the real project that Supabase accepts it; give your own emails to avoid the question).
**Before using it:** Dashboard -> Authentication -> Providers -> Email -> turn **off** "Allow new users to sign up".
**If the query cannot create users** (it writes into Supabase's internal `auth` tables, which is not an official API and is unproven): create the logins in Dashboard -> Authentication -> Users -> Add user (tick auto-confirm), then run `select public.qt_attach_seat('Acme Traders', 'user@email');` for each.
**Free plan reminders:** projects pause after about 7 days without activity (click Restore); there are no automatic backups, so keep the local backups on; recheck the plan limits on Supabase's own page.

### Run the self-test v2 (`91_selftest_v2.sql`)
1. In a **scratch** Supabase project run `01`–`06` (v1 objects that the new files reuse: `licenses`, `qt_license_hash`) and then `11`–`16`, in order. Turn off "Allow new users to sign up" (Authentication -> Providers -> Email).
2. Paste `91_selftest_v2.sql` and press Run. In the **Messages / Notices** panel you should see a `PASS ...` line per check and finally `ALL QUOT3 SHARED-NOTEBOOK SELF-TESTS PASSED`. The script ends in ROLLBACK, so no organisation, login, bill or history row is left behind.
3. Any `FAIL ...` stops the script; copy that line into `PHASE_STATUS.md` -> STANDING GAPS. If the failure is in the first block (creating the test organisations), the direct write into Supabase's `auth` tables is not accepted: use the dashboard fallback described under "If the query cannot create users" above, and tell the next session.
It covers: organisation creation (the key is stored only as its hash), anon and signed-in strangers refused, a wrong or other-organisation license key refused, activation (name clash, PO prefix clash, a branch id owned by another organisation, seat takeover, rename), push (accepted, noop, conflict won and lost, tie on `edited_at`, tombstone and restore, history cap 20, validation, 201 items, all-or-nothing, doorbell touched once and not on an all-noop push), pull cursor and limits, manifest without payloads, RLS isolation between two organisations (reads and direct writes refused), suspended license, revoked seat, and that only `sn_ping` is in the Realtime publication. If the database has no `supabase_realtime` publication (not Supabase) the last block prints `SKIP`.
**Not covered by it (owner checks them in the checklist below):** the real app, sign-in over HTTPS, Realtime delivery, project pause, the Free plan limits. The script uses simulated sign-in (JWT claims + role switch), so "`auth.uid()` works inside these `security definer` functions with an empty `search_path`" is exactly what its first successful push proves; if every call fails with `Q3A01`, that is the thing to look at first.

### Real-Supabase checklist v2 (owner ticks it, then records the date, the Supabase region and anything that failed in `PHASE_STATUS.md` -> STANDING GAPS)
The automated tests only ever talk to the in-memory server (Phase 132 onward) or read the SQL as text; this checklist is the proof against the real thing. **Until it is ticked, "works on Supabase" is a standing gap.** You need two computers (or one computer and a second Windows user / a second `%LOCALAPPDATA%\\Quot3` copy) and a fresh scratch Supabase project. Phases 132-140 build the app side; steps marked (app) can only be done once those phases exist.

**A. Server**
1. [ ] Run `01`-`06`, then `11`-`16` in order in the SQL editor. No errors (re-running any file is also fine).
2. [ ] Authentication -> Providers -> Email: "Allow new users to sign up" is **off**.
3. [ ] Run `91_selftest_v2.sql`: every line passes and the last line is `ALL QUOT3 SHARED-NOTEBOOK SELF-TESTS PASSED`.
4. [ ] Database -> Replication (or Realtime): `sn_ping` is listed as published and no other `sn_*` table is.
5. [ ] Run the one query `select * from public.qt_create_org('My Company', 2);` (or with your own emails). Copy the license key and both passwords now; they are shown once. Table Editor: `licenses.key_hash` is a hash, not the key.
6. [ ] With the anon key only (a curl to `/rest/v1/sn_records` or the API tab), no rows come back and a sign-up request is refused.

**B. Sign-in and activation (app)**
7. [ ] Computer 1: Settings -> Sync: enter URL, anon key, license key, e-mail and password, then pick a branch name and PO prefix. Sign-in and activation succeed.
8. [ ] Computer 2: a different login, the same license key; a repeated branch name or PO prefix is refused with a clear message; a different name and prefix succeed.
9. [ ] A wrong password and a wrong license key each show their own clear message (not "offline"). `qt_set_license_status('My Company', 'suspended')` shows a license message on both computers; `'active'` brings them back without activating again.

**C. Normal flow (app)**
10. [ ] Computer 1: Compare and sync: every bill and customer uploads. Computer 2: Compare and sync: identical bills are skipped, one-sided ones transfer, nothing is duplicated, PO numbers are kept.
11. [ ] Save a bill on 1: it shows on 2 within a few seconds (Realtime doorbell). Turn Realtime off (or block it): it still shows within about a minute (60 s poll).
12. [ ] Edit on 2, delete on 1, restore from Recently deleted on 1: every step arrives on the other computer.
13. [ ] Table Editor: `sn_records.payload` holds readable bill data (this is the accepted trade-off of the new design); RLS is ON for every `sn_*` table and no sign-in of one organisation can see another organisation's rows (the self-test proves it; spot-check with a second organisation if you made one).

**D. Bad network and conflicts (app)**
14. [ ] Turn Wi-Fi off on computer 1, save three bills, turn it on: Sync status goes Offline, then catches up; all three arrive on 2 (no duplicates, no missing PO numbers).
15. [ ] Edit the SAME bill on both computers while both are offline, reconnect both: both end with the later edit (whichever branch made it); the earlier version is in History -> compare on the computer that lost.
16. [ ] Open a bill in the Create editor on 2, edit it on 1: 2 shows the "Changed on another branch" banner and does not overwrite what is on screen.
17. [ ] Set one computer's Windows clock 10 minutes wrong: the app shows its quiet clock warning, and the later *real* edit still wins.

**E. Limits, pause and housekeeping**
18. [ ] A very large bill (thousands of long rows) is refused as too large with a clear message; the other bills still sync.
19. [ ] Free plan: re-read Supabase's own pricing / limits page (project pause after about 7 days of inactivity, no automatic backups, database size) and record what it says today; keep the app's local backups on. (Realtime limits were re-read in Phase 138 on 2026-10-13: Free = 200 connections, 100 messages per second, 100 joins per second, 256 KB payload; no monthly message figure on that page. See `SYNC_SHARED_STORE_SPEC.md` section 10.)
20. [ ] A paused project (Dashboard -> Pause project, then try to sync) shows "server paused" or the equivalent message, not "offline" and not a crash; Restore project and the app recovers on its own.
21. [ ] `qt_revoke_seat('My Company', 2)` ends that computer's access (it shows a sign-in message) while its synced bills stay on the other computer.
22. [ ] Only after every box above is ticked and every computer runs the new app: run `99_drop_v1.sql` (change `NO` to `DROP V1` first). Afterwards `select count(*) from information_schema.tables where table_name in ('postbox','branches');` returns 0 and the app still syncs.

## Files — run in this order, in the Supabase SQL editor (v1 postbox, Phase 51-89; replaced by Milestone 12)

| File | What it does |
|---|---|
| `supabase/sql/01_licenses.sql` | `pgcrypto`, table `licenses` (key **hash**, org id, KDF salt, status, seat limit) |
| `supabase/sql/02_branches.sql` | table `branches` (unique PO prefix per organisation) |
| `supabase/sql/03_postbox.sql` | table `postbox` (routing metadata + ciphertext only) |
| `supabase/sql/04_rpcs.sql` | the license check and the six RPCs the app calls, with their grants |
| `supabase/sql/05_sweep.sql` | `qt_sweep()` and (if `pg_cron` is on) its daily schedule |
| `supabase/sql/06_pending_count.sql` | `qt_pending_count(license, branch)` - rows waiting for this branch (Phase 89; **written, not yet run against a real project**) |
| `supabase/sql/90_selftest.sql` | **optional checks, ends in ROLLBACK** — keeps nothing |

Every file can be run again safely (`if not exists` / `create or replace`). Never edit a file that has already been run in the live project; add `06_...sql` instead. A function whose argument list changes needs `drop function ...` first.

## Security shape (what the self-test and `src/__tests__/supabaseSql.test.ts` guard)

- RLS is **enabled** on `licenses`, `branches`, `postbox`; there is **no policy** at all and all table privileges are revoked from `anon` / `authenticated`. The tables cannot be read or written through the API.
- The app talks to **six `SECURITY DEFINER` RPCs** only: `qt_register_branch`, `qt_list_branches`, `qt_push`, `qt_pull`, `qt_ack`, `qt_touch`. Each starts with the license check, has an empty `search_path`, and nothing else is granted. `qt_auth`, `qt_license_hash` and `qt_sweep` are not callable by the app.
- A malformed key, an unknown key and a suspended license all raise the identical error `invalid_license` (SQLSTATE `Q3L01`).
- The license **key is never stored**: only `sha256('quot3-license:' + KEY)`.
- The server holds ciphertext + routing metadata only (no party name, amount or item exists in any column).
- **No `service_role` key goes in the app.** The only place it could be used is a scheduled Edge Function for the sweep (below), which runs on Supabase's side.

Error codes the client sees: `Q3L01 invalid_license` · `Q3M01 unknown_branch` · `Q3B01 branch_limit` · `Q3B02 prefix_taken` · `Q3B03 branch_conflict` · `Q3I01 invalid_input` · `Q3I02 too_large` · `Q3I03 too_many`.

## RPC reference (what Phase 52+ will call)

Binary values are **base64 text without line breaks** inside JSON.

| RPC | Arguments | Returns |
|---|---|---|
| `qt_register_branch` | `p_license, p_branch_id uuid, p_name, p_po_prefix, p_device` | `{ org_id, kdf_salt, branches: [{ branch_id, name, po_prefix }] }` (re-registering the same branch id updates it and uses no new seat) |
| `qt_list_branches` | `p_license, p_branch_id` | `[{ branch_id, name, po_prefix, last_seen_at }]` |
| `qt_push` | `p_license, p_branch_id, p_items jsonb` — `[{ to_branch, bill_id, op:'upsert'\|'delete', revision, updated_at, nonce, ciphertext }]` | `{ ids: [bigint] }` — all or nothing; 1–200 items, ciphertext 16 B–1 MB, 12-byte nonce, 8 MB JSON in total |
| `qt_pull` | `p_license, p_branch_id, p_after_id bigint = 0, p_limit int = 100` | `{ items: [{ id, from_branch, bill_id, op, revision, updated_at, nonce, ciphertext }], has_more }` — max 200 rows and about 4 MB per call; pulling deletes nothing |
| `qt_ack` | `p_license, p_branch_id, p_ids bigint[]` | `{ deleted }` — only rows addressed to this branch; max 1000 ids |
| `qt_touch` | `p_license, p_branch_id` | `{ ok, server_time }` |

## Create a license

On any machine with Node 22 (nothing is installed, no network needed):

```
node scripts/generate-license.mjs --label "Acme Traders" --max-branches 3
```

It prints the **key** (give it to the customer; it is not stored anywhere — if lost, make a new one) and one `insert into public.licenses ...` line holding only the hash. Run that line in the SQL editor. To suspend a license: `update public.licenses set status = 'suspended' where label = '...';` (its branches then get `invalid_license`; no data is deleted).

## Run the self-test

1. Run `01` to `05` in a **scratch** project.
2. Paste `90_selftest.sql` and press Run. In the **Messages / Notices** panel you should see a `PASS ...` line per check and finally `ALL QUOT3 SYNC SELF-TESTS PASSED`.
3. Any `FAIL ...` stops the script; copy the line into `PHASE_STATUS.md`. The script always rolls back, so nothing is left behind.

It covers: registration (seat limit, prefix clash, cross-organisation branch id, in-place update), generic license errors, push validation (all-or-nothing), pull cursor / limit, ack ownership, sweep, anonymous access refused on every table and on the internal functions, RLS on and no policies.

## The sweep (expired rows)

Rows nobody acknowledged are deleted after 30 days (`postbox.expires_at`). `05_sweep.sql` schedules `qt_sweep()` daily at 03:17 **if `pg_cron` is enabled** (Database → Extensions → pg_cron) — re-run `05` after enabling it. Without `pg_cron`, either run `select public.qt_sweep();` now and then, or schedule a Supabase Edge Function that calls it with the service role *on the server side*.

## Known limits (recorded, not hidden)

- **Key entropy.** The format `Q3-XXXX-XXXX-XXXX` is 60 bits. The spec asked for a per-row salt, but a salted hash cannot be looked up by equality, so a fixed domain prefix is used instead; a leaked `licenses` table could in principle be brute-forced offline at 2^60 effort. The key only lets someone add a branch and push / pull ciphertext they still cannot read without the org passphrase.
- **No server-side throttle on wrong keys.** A failed call raises, so any counter written in the same call would roll back. Rely on Supabase's built-in rate limits; a lockout would need a separate (non-rolling-back) mechanism and is a later decision.
- **`max_branches`** counts registered branches; there is no "remove branch" RPC yet (delete the row in the SQL editor).
- A suspended or deleted license makes all of its branches fail with `invalid_license`; the app must show that as "license problem", never as "no internet".

## Owner-run real-Supabase checklist (Phase 60)

The automated tests only ever talk to the in-memory server (`InMemoryTransport`), which copies the RPC rules but is not Postgres. This checklist is the proof against the real thing. **Until you have ticked it, "real Supabase works" is a standing gap.** You need two computers (or one computer and a second Windows user / a second `%LOCALAPPDATA%\Quot3` copy) and a fresh Supabase project.

**A. Server**
1. [ ] Run `supabase/sql/01` to `05` in order in the SQL editor (see "Files" above). No errors.
2. [ ] Run the self-test (see "Run the self-test"): every line passes.
3. [ ] Create a license (see "Create a license") with `max_branches` of at least 2. Keep the key and choose an org passphrase.
4. [ ] Table Editor: `postbox` has Row Level Security ON and the `anon` role cannot `select` from it directly (the API tab / a curl with the anon key to `/rest/v1/postbox` returns no rows or an error).

**B. Activation (computer 1, then computer 2)**
5. [ ] Settings -> Sync: enter URL, anon key, license, passphrase, branch name, PO prefix. Activation succeeds. On computer 2 use a DIFFERENT prefix; confirm a repeated prefix is refused with a clear message.
6. [ ] Settings -> Sync status shows both branches; a wrong license key shows "license problem" (not "offline").

**C. Normal flow**
7. [ ] Create and save a bill on 1. Within about a minute it appears on 2 (History, PO number kept, same rows, badge `synced`). In the Supabase `postbox` table the row existed only briefly and is gone after 2 pulled it.
8. [ ] Open the `postbox` row while it exists (pause computer 2 first): `ciphertext` is unreadable text; no party name, item or amount is visible anywhere.
9. [ ] Edit on 2, delete on 1, restore from Recently deleted on 1: every step arrives on the other computer.
10. [ ] Wrong passphrase on a third install: the activation or first pull says wrong key; nothing is applied.

**D. Bad network**
11. [ ] Turn Wi-Fi off on computer 1, save three bills, turn it on: Sync status goes Offline then catches up; all three arrive on 2 (no duplicates, no missing PO numbers).
12. [ ] Edit the SAME bill on both computers while both are offline, reconnect both: both end with the later edit; the earlier one shows a conflict entry on the losing computer.
13. [ ] Open a bill in the Create editor on 2, edit it on 1: 2 shows the "Changed on another branch" banner and does not overwrite what is on screen.

**E. Limits and housekeeping**
14. [ ] A very large bill (thousands of long rows) is refused with "too large to send" and shows as failed in Sync status; the other bills still sync.
15. [ ] Suspend the license (`update licenses set status='suspended' ...`): both computers show "license problem"; set it back to `active` and they recover without re-activating.
16. [ ] `select public.qt_sweep();` runs without error; `select count(*) from postbox;` returns 0 after everything was pulled.

Record the date, the Supabase region and anything that failed in `PHASE_STATUS.md` -> STANDING GAPS.

## Clock skew and limits - what Phase 60 pinned down

- **Who wins** is decided by the revision, then `updated_at` (each computer's own clock), then the deleted flag and author (docs/SYNC_POSTBOX_SPEC.md section 6). The server never stamps or reorders. A computer whose clock is fast therefore wins every race against a correct one, and a slow one loses them. All branches still **converge to the same bill** (proved by the skew test in the harness); the only damage is that the "wrong" edit can win, and the loser is kept in the conflict list.
- **What to tell the owner:** keep Windows time sync on (Settings -> Time & language -> "Set time automatically"). A clock more than a few minutes off is the only realistic way to get a surprising winner. There is no automatic detection yet (a later hardening item: compare `qt_touch.server_time` with the local clock and warn above 2 minutes).
- **Size limits (client and server agree):** one sealed bill at most 1 048 576 bytes of ciphertext (`POSTBOX_MAX_CIPHERTEXT`); at most 200 items per push (`PUSH_MAX_ITEMS`), 4 MB of base64 per push call (`PUSH_BATCH_MAX_BYTES`), 8 MB JSON server-side, 200 items / about 4 MB per pull, 1000 ids per ack. The push worker checks the size BEFORE sending, so an oversized bill is blamed on its own outbox row (it goes to `failed` after 10 attempts, with the message "too large") and never blocks the bills behind it.
- **Lost answers:** a push the server processed but whose answer was lost is sent again, so the postbox can hold duplicates; the receiver's apply is idempotent (same bill id + revision = once). Covered by the harness.

### Theme sharing (Milestone 16, file `17_themes.sql`): owner steps and checklist F
Written in Phase 170 (server side only; the app side is Phase 171). **Nothing here has been run against a real Supabase**: "theme sharing works on Supabase" is a standing gap until the boxes below are ticked and the result is recorded in `PHASE_STATUS.md`. Sharing is OFF by default in the app, so running or skipping this file changes nothing until the owner turns the switch on.

Run order: `01`-`06`, `11`-`16` (as before), then `17_themes.sql` in the SQL editor. Re-running is safe.

| Function | Returns | Notes |
|---|---|---|
| `sn_theme_push(license, branch_id, items)` | array `{ theme_id, outcome, version, server_seq }` | 1-20 items, 2 MB per call, 64 KB per theme; outcome `accepted` / `noop` / `won` / `lost`; newest `edited_at` wins, older version kept in history |
| `sn_theme_pull(license, branch_id, after_seq, limit<=50)` | `{ items, has_more, server_time }` | ordered by `server_seq`, about 2 MB per page, deletes nothing |

**F. Theme sharing (owner ticks, then records the date and anything that failed in `PHASE_STATUS.md` -> STANDING GAPS)**
1. [ ] Run `17_themes.sql`: no errors; running it a second time is also fine.
2. [ ] Table Editor: `sn_themes` and `sn_theme_history` show RLS ON; with the anon key only (curl to `/rest/v1/sn_themes`) no rows come back.
3. [ ] SQL editor, as a test (replace the values with your own; do not paste a real license key anywhere public): a signed-in seat calling `sn_theme_push` with one small theme returns `accepted`; the same call again returns `noop`; the same theme id with an older `edited_at` and a different hash returns `lost` and the stored theme is unchanged; with a newer `edited_at` it returns `won`, and `sn_theme_history` then holds the previous version.
4. [ ] A payload over 64 KB is refused with `payload_too_large`; a theme id with capitals or spaces is refused with `invalid_input`; 21 items in one call are refused with `too_many`.
5. [ ] A second organisation's login (if you made one) cannot see the first organisation's `sn_themes` rows.
6. [ ] (app, after Phase 171) Computer 1: turn on "Share my themes with the other PCs" and add a theme file; computer 2 (switch on) shows it in Settings > Themes and its own `themes` folder, a bad file is set aside and listed, and the app does not break.
