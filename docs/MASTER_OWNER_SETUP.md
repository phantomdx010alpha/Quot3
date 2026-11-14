# MASTER_OWNER_SETUP - stand up the master and add companies (Phase 262, Milestone 24)

For the OWNER, on his own PC. Nothing here was run against a real Supabase when it was written (Phase 262 is tested only against fakes); the real run is the checklist of Phase 273 (`docs/M24_OWNER_CHECKLIST.md`). If a step fails, stop and tell the next session the exact message.

The master is ONE extra Supabase project that holds only: the company list, each seat's sealed login, device tokens (hashed) and the company profile. **Never bills, never Price List data.** Everything secret in it is sealed (AES-256-GCM) with `MASTER_KEK`, which lives only in the function secrets and in your password manager.

All commands run from the project folder: `node tools/master-cli.mjs <command>`. Run `node tools/master-cli.mjs help` any time.

## 1. Create the master project (once)
1. supabase.com > your account > **turn on 2FA** (Account > Security). A stolen Supabase login would reach the master.
2. New project, any name (e.g. `quot3-master`), a strong database password stored in your password manager, a region near you.
3. Authentication > Providers > Email: turn **OFF "Allow new users to sign up"**. (The master has no users; it must stay that way.)
4. Settings > API: copy the **Project URL**, the **anon key** and the **service_role key**. The service_role key is a master key: never put it in the app, in a file in the project, or in chat.

## 2. Create the tables (once)
SQL editor of the **master** project: paste and run, in this order, `supabase/master/M01_tables.sql`, `M02_rls.sql`, `M03_helpers.sql`. Each is safe to run again. Never paste the company files (`supabase/sql/`) here and never paste these into a company project.

## 3. Make and set the secrets (once)
1. `node tools/master-cli.mjs init` prints the steps and makes a new `MASTER_KEK` and `MASTER_PEPPER`. **Copy both into your password manager now; they are shown once.** If `MASTER_KEK` is lost, every sealed password and code is unreadable (the seats would need resets); keep a second copy somewhere separate from the export file of step 8.
2. Set them as function secrets (Supabase CLI, installed once with `npm i -g supabase` or from supabase.com/docs/guides/cli):
   `supabase login`, then
   `supabase secrets set MASTER_KEK=<kek> MASTER_PEPPER=<pepper> ALLOWED_ORIGIN=<the address your phone app opens from> --project-ref <master ref>`
   `ALLOWED_ORIGIN` is the web address of the phone app (for example `https://yourname.github.io`). Without it the phone cannot call the master; the desktop is not affected.

## 4. Bundle and deploy the 13 functions
The functions use extension-less imports, so they are bundled first (needs `npm install` done once in the project folder):
1. `node tools/master-cli.mjs bundle` writes `build/master-functions/supabase/functions/<name>/index.ts` for all 13 (redeem, adopt, refresh, heartbeat, profile-get, seat-list, seat-create, seat-reset, seat-revoke, seat-rename, seat-regen, profile-set, enrol).
2. `cd build/master-functions` then `supabase functions deploy --project-ref <master ref> --no-verify-jwt`. (`--no-verify-jwt` because devices authenticate with their own device token, not a Supabase login.)
3. Check the dashboard: Edge Functions shows 13 functions. [A: the exact `supabase functions deploy` flags can differ between CLI versions; if it complains, read `supabase functions deploy --help` and tell the next session what it said.]

## 5. Put the master settings in your shell (not in a file in the project)
In the terminal you use for the CLI (PowerShell: `$env:NAME = "value"`):
`MASTER_URL`, `MASTER_SERVICE_ROLE_KEY`, `MASTER_KEK`. Closing the terminal forgets them, which is what you want. Later steps also read `COMPANY_URL`, `COMPANY_ANON_KEY`, `COMPANY_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` the same way; setting them as environment variables keeps them out of your command history (the matching `--flags` also work).

## 6. First company: a NEW one (the CLI does the SQL)
1. Make a new Supabase project for the company (sign-ups OFF, 2FA as above). Copy its URL, anon key and service_role key.
2. Optional, to skip pasting SQL by hand: supabase.com > Account > Access Tokens > make one and set `SUPABASE_ACCESS_TOKEN`.
3. Preview: `node tools/master-cli.mjs onboard "Acme Traders" 3 --url https://<ref>.supabase.co --anon <anon> --service-role <service> --dry-run`
4. Real run: the same without `--dry-run`. It runs `supabase/sql/11..21` (only if a token was given; otherwise it prints "paste these files in this order" and you paste them in the company's SQL editor, then run the command again), creates the organisation and its seats, seals every login in the master, and prints the **Seat-1 code** once. Give that code to the person who runs seat 1; seat 1 sees the other codes inside the app.
5. If it prints a **RECOVERY** block, the company was made but the master write failed. Keep that block (it is the only copy of the passwords), fix the master problem (usually a wrong `MASTER_URL` / key), and tell the next session.

## 7. Link a company that already exists (nobody is logged out)
1. `node tools/master-cli.mjs enrol-token "Acme Traders"` (the label EXACTLY as in the company's `licenses.label`). It prints a one-use token, valid 24 hours (`--hours 48` to change).
2. On seat 1's PC (Phase 264 screen): Settings > Company seats > Link to master: paste the token, the label and the company project's service_role key once. The master checks that the PC is really seat 1, registers the company and records every existing seat as "legacy" (no code until its first reset). Existing phones and PCs keep working and adopt silently.
3. The token works once. A lost or expired token: mint another.

## 8. Backups
`node tools/master-cli.mjs export --out master-backup.json` writes companies and seats. Passwords, codes, keys and the license stay **sealed** in it (useless without `MASTER_KEK`); device tokens are never exported. Keep the file and `MASTER_KEK` in **different** places. `--no-sealed` leaves the sealed values out. Also use Supabase's own project backups if your plan has them.

## 9. Keep the free master from being paused
A free Supabase project is paused after a week without activity; a paused master means nobody can link a new device or get new credentials (devices that are already working keep syncing with their company projects).
1. In the GitHub repository: Settings > Secrets and variables > Actions: add `MASTER_URL` and `MASTER_ANON_KEY` (the **anon** key, never the service_role).
2. The workflow `.github/workflows/master-keepalive.yml` then pings the master once a day (you can also press "Run workflow" to test). GitHub switches scheduled workflows off after 60 days without any commit to the repository: push something now and then, or run it by hand. [A]
3. Check once a week at first: Actions > "Master keep-alive" is green.

## 10. If the master is paused or down
1. Supabase dashboard > the master project > **Restore project** (a paused free project can be restored for a limited time; do it soon).
2. Run `node tools/master-cli.mjs keepalive` (set `MASTER_URL` and `MASTER_ANON_KEY`); "It is awake" means the project answers.
3. Nothing is lost for devices that already work: bills and the Price List sync through each company's own project. Only linking, redeeming a code, a password reset's pick-up and the company profile wait for the master.
4. If the project is gone for good: create a new master (steps 1-4 with the SAME `MASTER_KEK`), then re-link each company with an enrol token (step 7). The export file is a record of what was there; restoring from it is not automated.

## 11. What the CLI will never do
It never prints a password, a service_role key, a license key, a device token or a sealed value, except the few things you must see once: a new `MASTER_KEK` / `MASTER_PEPPER`, an enrol token, the Seat-1 code, and the recovery block. It never runs anything on a real Supabase unless you give it the keys and run it.
