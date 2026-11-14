# GITHUB UPDATE PUSH — Guide for Claude and the owner

Read this whenever the owner asks for a change that must reach the installed Quot3 apps. It explains how updates are shipped and what Claude must hand back every time. Last verified working: 2026-10-13 (0.1.2 -> 0.1.3 update flow confirmed by the owner).

---

## 1. The setup in one paragraph

The code lives in the **public** GitHub repo `phantomdx010alpha/Quot3`. Pushing a git tag like `v0.1.4` starts the GitHub Action `.github/workflows/release.yml`. GitHub's Windows runner builds the installer and publishes it as a GitHub Release (`Quot3-Setup-X.Y.Z.exe`, its `.blockmap`, and `latest.yml`). Installed apps check that release (first check 45 s after launch, then every 6 h, or the "Check for updates" button), download the newer installer in the background, and install only when the owner clicks **Restart**. **Nothing is built on the owner's PC. `npm run dist` is not part of releasing.**

Key facts:

| Thing | Value |
|---|---|
| Repo | `github.com/phantomdx010alpha/Quot3` (must stay public: the app cannot read a private repo's releases) |
| Update address in the app | `github:phantomdx010alpha/Quot3` (Settings > Updates). **Hardcoded in the app since 0.1.4** (`DEFAULT_GITHUB_FEED` in `src/shared/updater.ts`, used by `updaterPort.ts` when the Settings box is empty), so a fresh install needs nothing typed. If the repo is ever renamed or moved, change that constant and ship a new version (an address typed in Settings overrides it) |
| Owner's local repo folder | `C:\Users\Ankush\Desktop\vvvv\release\quot3` (has the `.git` folder) |
| Release trigger | pushing a tag `vX.Y.Z` that equals `"version"` in `package.json` |
| Token | none needed; the workflow uses GitHub's automatic `GITHUB_TOKEN`. Never put a token in the repo or in a message |

---

## 2. What Claude must do for EVERY change request

1. Read `CLAUDE_MUST_READ.md` as usual, then this file. Make the change with `str_replace` (never rewrite whole files).
2. **Bump the version** to the next patch (`0.1.3` -> `0.1.4`) in all three places, or the update will not be offered:
   - `package.json` -> `"version"`
   - `package-lock.json` -> the first `"version"` (top of file) **and** the one under `"packages": { "": { ... } }`
3. Update the tests that pin whatever changed. Do not run `npm run build` / `dist` (not needed). Run `typecheck` and the relevant tests if a `node_modules` is available; if not, say plainly that nothing was run.
4. Add a short entry at the bottom of `PHASE_STATUS.md` (what changed, new version, what was NOT run).
5. Hand back **both**:
   - **Changed-files zip**: only the files that changed, keeping their folder structure, so the owner can extract it over the repo folder. Name it `quot3_vX.Y.Z_changed_files.zip`.
   - **Full project zip** per `CLAUDE_MUST_READ.md` section 8, named `quot3_phase144_vX.Y.Z.zip` (or the real phase name). It has no `.git` folder.
6. End the reply with the **push steps from section 3, with the real version number filled in** and a list of the files with their locations.
7. Tell the owner anything that changes behaviour for existing data (e.g. column order and pasted data), and what Claude did not test.

Do not touch these unless the owner asks, because they took several rounds to get right: the `publish:` block in `electron-builder.yml`, `src/main/services/updaterPort.ts`, `.github/workflows/release.yml`, the `.gitignore` entry for `docs/reference/legacy_import/Bills_JSON.zip`.

---

## 3. Push steps (Claude pastes these to the owner, with the version filled in)

1. Extract the **changed-files zip** over the repo folder `C:\Users\Ankush\Desktop\vvvv\release\quot3` and choose "Replace the files". (Do not push from a fresh unzip of the full zip: it has no `.git` folder and would not be linked to GitHub. If the full zip is used, copy its contents over the repo folder instead.)
2. Open the repo folder in VS Code, then **Terminal > New Terminal**, and run (replace `X.Y.Z`):

```powershell
git add .
git commit -m "Short description, version X.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

3. Open `github.com/phantomdx010alpha/Quot3/actions`. A run called **Release** appears; it takes about 3 to 5 minutes. Green tick = done.
4. Open **Releases** and check that `vX.Y.Z` has all three files: `Quot3-Setup-X.Y.Z.exe`, `Quot3-Setup-X.Y.Z.exe.blockmap`, `latest.yml`.
5. Open the installed Quot3 > **Settings > Updates > Check for updates**. It shows "Downloading version X.Y.Z", then "Version X.Y.Z is ready". Click **Restart**. Settings should then say the new version.

Rules: the tag must match the `package.json` version (the workflow stops with an error if not). A published version number is never reused: a broken release is fixed by shipping a higher number. Docs-only changes need only `git add/commit/push origin main`, with no tag and no release.

---

## 4. Setting up a new PC

Download `Quot3-Setup-X.Y.Z.exe` from the latest GitHub Release and run it. The first time Windows shows a blue SmartScreen warning because the installer is not code-signed: click **More info > Run anyway**. From 0.1.4 on the update address is built in, so nothing needs typing. (Installs of 0.1.2 / 0.1.3 still have the address typed in Settings; that keeps working and they update to 0.1.4 normally.) Bills and settings live in `%LOCALAPPDATA%\Quot3`, separate from the program, so updating or reinstalling keeps them.

Any install older than 0.1.2 can never update itself (an updater bug fixed in 0.1.2); it needs the newest installer run by hand once.

---

## 5. Troubleshooting

| What you see | Cause and fix |
|---|---|
| Actions tab shows **no run** after the push | The tag was not pushed. Run `git ls-remote --tags origin`; if the tag is missing, `git tag vX.Y.Z` then `git push origin vX.Y.Z` |
| Run is red: "Tag ... does not match package.json version" | Version in `package.json` differs from the tag. Fix the version or tag. Delete a wrong remote tag with `git push origin --delete vX.Y.Z` |
| Run is red with `422 already_exists` / the release has only the `.blockmap` | Upload race (installer and blockmap both created the release). The workflow now creates the release first, so this should not recur. If it does: Actions > the run > **Re-run all jobs** |
| Run is red somewhere else | Open the run > the failed step > send the last ~40 lines to Claude |
| Release exists but the app says "No update information was found" | The release has no `latest.yml`, or it is a draft, or the repo is private. Check the three files; re-run the job |
| App says "Could not check for updates" | Open `%LOCALAPPDATA%\Quot3\logs\quot3.log` (Win+R), find the last `Update check failed` line and send it to Claude. Also check the address is exactly `github:phantomdx010alpha/Quot3` (not an https link, no `.git`) |
| App says "Quot3 is up to date" but a newer release exists | The release version is not higher than the installed one, or the release is a draft |
| "Updates are not available here" | The app is running from source (`npm run dev`). Updates only work from an installed copy |
| SmartScreen warning on install | Expected while unsigned. Do **not** set `publisherName` in `electron-builder.yml` until a real certificate exists, or updates will fail verification (`docs/RELEASE_SIGNING.md`) |

Finding the app log without VS Code: **Win + R**, paste `%LOCALAPPDATA%\Quot3\logs`, Enter, open `quot3.log` in Notepad, Ctrl+F `Update check failed`.

---

## 6. For the owner: how to ask for a change

Start a Claude session with the zip and a message like:

> Read `CLAUDE_MUST_READ.md` and `GITHUB_UPDATE_PUSH.md` first. Change: (say what you want, in plain words, and where in the app). Give me the changed-files zip, the full zip, and the push steps with the new version number.

Good requests say **where** (which page, which format, GST or non-GST) and **what should happen**. After Claude replies, follow section 3. If anything goes red or the app does not update, send Claude a screenshot of the Actions run or the log line from section 5.

---

## 7. Known history (so nobody repeats it)

- 0.1.0 and 0.1.1: the updater never worked inside the packaged exe (`Cannot set properties of undefined (setting 'autoDownload')`). Cause: `electron-updater` is CommonJS and `autoUpdater` is not visible as a named export after bundling; fixed in 0.1.2 by also reading `default.autoUpdater` in `updaterPort.ts`.
- 0.1.2 and 0.1.3 first runs: release came out with missing files (`422 already_exists`) because two uploads raced to create the release; fixed by creating the release first in the workflow.
- The release repo is public, so the source is public. `docs/reference/legacy_import/Bills_JSON.zip` (real customer data) is in `.gitignore` and must never be pushed.
- 0.1.5: Settings > Updates > Choose app version (rollback). The workflow's "Create the GitHub release first" step writes `schema: N` (N = number of `src/main/db/migrations/*.sql`) at the top of the release notes; the app reads it to refuse versions that would make the bills read-only. Do not delete that line from release notes. Releases 0.1.2-0.1.4 have no line and count as schema 8. Choosing a version sets `updates.pinnedVersion` and switches `updates.auto` off (older builds only know `updates.auto`); "Back to latest" undoes it.
- Not done yet: code signing (unsigned installer), a beta channel, and the Phase 69 release gate.
- 0.1.7: Milestone 14 (Phases 145-153): party list full names, History by invoice number, toolbar names, print fit-to-page, Stock transfer (Alt+4), Hybrid format (Alt+3). First release with migration `0008_hybrid_second_table.sql`, so the release notes line is `schema: 9`; a rollback to 0.1.2-0.1.6 is blocked once the database is on schema 9.
- 0.1.7 also includes: several windows in one process (launching Quot3 again opens a new window); a save made second gets the next free PO and says so (Phase 154). No further schema change.
- 0.1.8: Create bar format is a dropdown, wider party name / phone / transport. (Phases 154 multi-window and 155 HD image were prepared during 0.1.7 work; if they were not in the pushed 0.1.7 they ship here.)
- 0.1.9: History shows only the last N days by default (Settings > Behaviour > History shows bills of the last (days), default 30, 0 = all); a search or a From / To range still finds older bills.
- 0.1.12: Milestone 15 (Phases 158-164), legacy watch: background mode (start at Windows sign-in, tray, close-to-tray, wake rescan; all OFF by default), automatic import of the legacy software's JSON folder with a content fingerprint (duplicates under another PO skipped, edited copies update the bill as a new revision, uncertain ones go to Needs review), Activity log with Undo, new Settings section "Background and legacy watch". Migration `0009_legacy_watch.sql`, so the release notes line is `schema: 10`; a rollback to 0.1.2-0.1.11 is blocked once the database is on schema 10 (0.1.7-0.1.11 stay at schema 9). (0.1.10 / 0.1.11 notes: see PHASE_STATUS.md.) First thing to verify on a real PC: bills imported on one PC arrive on the others through real sync.
- 0.1.13: print and image copy headers are now "S.No" and "Qty" by default (so they stay on one line), and every printed column header can be changed in Settings > Print (stored as `print.headerLabels`, blank = default). The Create screen keeps "Sl.No" / "Quantity". No schema change (`schema: 10`).
- 0.1.14 (Milestone 16, Themes 2.0): richer theme files (schema 2: gradients, fonts, shapes, animation presets, 3D backgrounds with Three.js), Settings controls for visual effects, and theme sharing between PCs through the shared notebook (switch OFF by default). New Supabase file `supabase/sql/17_themes.sql` must be run by the owner once (checklist F in `docs/SUPABASE_MIGRATIONS.md`) before sharing can work; the app's own database is unchanged (`schema: 10`). New dependency: `three` (pinned).

## 8. The phone version (Milestone 17; shell BUILT in Phase 174 / 0.1.15, not yet deployed)

Written 2026-10-21 (docs only). Desktop release steps in sections 2-3 are unchanged.
- The phone app is a second build of the same repo (`build:pwa`). **Vercel builds it on push**; no tag is needed for the phone. Tag a desktop release only when the desktop installer actually changes.
- Each code phase of Milestone 17 still bumps the version in `package.json` and both spots at the top of `package-lock.json` (section 2). One version number serves both platforms; the phone About page and the service-worker cache name use it. Placeholders: 0.1.15 ... 0.1.28, then 0.2.0 for the first public phone release.
- **Which branch is production on Vercel is Q8** (default [A]: a separate `pwa` branch until 0.2.0, so unfinished phone work cannot reach the live link by accident; other branches get preview URLs). Phase 174 built to that default and `vercel.json` sets `git.deploymentEnabled.main = false` (pushes to `main` build nothing on Vercel). If you choose `main` instead, change that line to `true`.
- **Vercel set-up (owner, once; [A] unconfirmed, nothing here was run on Vercel):** (1) Vercel -> Add New Project -> import the GitHub repo. (2) Framework Preset: Other. Leave build / output / install fields empty: `vercel.json` sets `npm ci --ignore-scripts`, `npm run build:pwa` and output `dist-pwa`. (3) Settings -> Git -> Production Branch: `pwa`; create that branch from the current code (`git checkout -b pwa && git push -u origin pwa`). (4) Open the deployment link on the phone in Chrome, menu -> Install app, open About and read the version (0.1.15) and the capability list, then report what you see. Roll back = redeploy an older deployment.
- The desktop release workflow is not changed by the phone: pushing the `v0.1.15` tag is not needed for this phase (the desktop did not change).
- **Roll back:** in Vercel, redeploy a previous deployment (no code change needed).
- **No secrets in Vercel.** The Supabase URL and anon key are typed by the owner in the phone app, as on desktop. Never commit keys, passwords or the anon key.
- The desktop `schema: N` release-notes line counts `src/main/db/migrations/*.sql` only; the phone's IndexedDB version is not counted.
- **Install on Android (owner):** open the Vercel link in Chrome, menu -> Install app. **Update:** open the app and accept the "New version, reload" prompt (it waits until no bill is unsaved).
- 0.1.29 (Phase 187b): the phone now has the real Supabase transport. It uses the SAME Supabase project and license key as the desktop (own seat login, own branch). No SQL and no desktop change, so no desktop tag. Push to `main`, then merge / push the same commit to the `pwa` branch (`git checkout pwa; git merge main; git push; git checkout main`) so Vercel builds it.
- 0.1.30 (Phase 187c): phone Settings sub pages, About page and the Windows app's built-in themes. Phone only: no desktop change, no tag, no SQL. Same push steps as 0.1.29 (push `main`, then merge into `pwa`).
- 0.1.31: DESKTOP release. Settings > Sync > Show license key (decrypts the stored key on a signed-in PC, shows it 30 s, Copy). First desktop release since 0.1.14: the phone phases 173-187 changed no desktop file, so it carries only this feature. No schema change (`schema: 10`). Tag `v0.1.31` after pushing `main`; then merge `main` into `pwa` so the phone shares the version number.
- 0.1.51 [A]: Milestone 21 (Phases 218-221): the app remembers the previous page and your position (Esc goes one page back), PageUp / PageDown step through bills opened from a list and through parties on Customers / History / Items sales, Ctrl+PageUp / Ctrl+PageDown page the grid in a stepped bill. UI only: no schema change (the release-notes `schema:` line stays as for 0.1.49). Run `docs/M21_OWNER_CHECKLIST.md` on a real PC. Skip the tag if M21 and M22 ship together.
- Docs-only changes: commit and push, no tag, no version bump.

## 9. The local AI model (Milestone 22, from 0.1.52)

- The release Action now runs a step "Fetch the AI model" (`node --experimental-strip-types tools/fetch-ai-model.mjs --skip-if-unpinned`) before the build and caches `resources/ai-models` by the hash of `src/shared/ai/modelConfig.ts`. The model files are NOT in the repo or the zip (`resources/ai-models/` is git-ignored).
- While `revision` and the SHA-256 values in `modelConfig.ts` are empty, the step is skipped and the installer has no model (Settings > AI says "Not installed"). Once the owner has pinned them (see `docs/M22_OWNER_CHECKLIST.md` section 1), the Action downloads the pinned revision, checks every file's SHA-256 (it refuses on a mismatch) and packages it through `extraResources`. The installer and the update download are then about 100+ MB bigger.
- Local build (only if you ever build on your PC; releasing never needs it): run `node --experimental-strip-types tools/fetch-ai-model.mjs` once in the repo folder before `npm run dist`. First time only: add `--allow-unpinned`; it prints the commit and the hashes to paste into `modelConfig.ts`.
- The app never downloads the model and never uses the network for AI.

## 10. The Price List (Milestone 23; built in Phases 233-248, release 0.1.55 [A] prepared in Phase 249, not yet pushed or tagged)

- Migration `0011_price_list.sql` is the 12th desktop migration (0000-0010 are the 11 that exist today), so the workflow's release-notes line becomes `schema: 12` automatically (it counts `src/main/db/migrations/*.sql`).
- The owner must run `supabase/sql/18_price_list.sql` ONCE on Supabase before the Price List syncs (checklist G in `docs/SUPABASE_MIGRATIONS.md`); without it the app still works on one PC and shared sync keeps working for everything else. The sandbox never runs it.
- Versions [A]: Phases 233-248 kept 0.1.52 in the files; the gate (Phase 249) bumped `package.json` and both spots of `package-lock.json` to 0.1.55 (skipping 0.1.53 / 0.1.54, which were never released). Phone phase 247 (bill features) was skipped by the owner.
- Phase 249 release: tag `v0.1.55` after the push steps in section 3. Order for the owner: run Supabase files 18, 19 and the log file ONCE, push + tag, install, then fill `docs/M23_OWNER_CHECKLIST.md`. The phone deploys from the `pwa` branch (section 8): merge `main` into `pwa` after the push. The phone is deployed from the `pwa` branch as in section 8.
- The legacy `bills_data.db` is private business data: never commit it (it is in `.gitignore`).

## 11. Milestone 24 (Phases 251-274; planned 2026-11-13; Release B steps in 11b)

- Release A = **0.1.56 [A]**, prepared by Phase 256 (quick fixes 251-254 and the price-rights fix 255-256 if done). Owner order: run `supabase/sql/21_price_perms_bell.sql` once on each company project (after 18, 19, 20), then push + tag `v0.1.56`, install, test two seats.
- Release B = **0.1.57 [A]**, prepared by the gate Phase 273 (master, one-code onboarding, seats, profile). Owner order: create the master Supabase project and follow `docs/MASTER_OWNER_SETUP.md` (master SQL `supabase/master/M01..`, deploy the Edge Functions, set the secrets, mint an enrol token), THEN push + tag `v0.1.57`, install, link the first company, fill `docs/M24_OWNER_CHECKLIST.md`.
- A phase other than 256 and 273 does NOT bump the version. The same push steps as section 3 apply; always hand back the changed-files zip, the full zip and the steps with the real version number.
- Do not build the exe locally; GitHub does it.

## 11b. Release B = 0.1.57 [A] (Phase 273, 2026-11-14): exact steps for the owner

What it contains: Phases 257-272 (master project, one-code phone onboarding, Seat-1 "Company seats", silent adopt / re-credential on PC and phone, company profile on PC print / image and on the phone). With NO master configured the app behaves exactly like 0.1.56.

**Master deploy order (once, details in `docs/MASTER_OWNER_SETUP.md`):**
1. Make the master Supabase project (2FA on, sign-ups OFF).
2. Run `supabase/master/M01_tables.sql`, `M02_rls.sql`, `M03_helpers.sql` in that order in the MASTER project only.
3. `node tools/master-cli.mjs init`; set `MASTER_KEK`, `MASTER_PEPPER`, `ALLOWED_ORIGIN` as function secrets.
4. `node tools/master-cli.mjs bundle`, then deploy the 13 functions with `--no-verify-jwt`.
5. **Put the master Project URL and anon key into `src/shared/master/config.ts` (`MASTER_URL`, `MASTER_ANON`; both are public values, NEVER the service_role key) before you commit.** Left empty, 0.1.57 ships with the master switched off (the safe default). Claude does not know these values; paste them yourself or give them to a Claude session to edit that one file.
6. Company projects need `supabase/sql/21_price_perms_bell.sql` if not already run (release 0.1.56 step 1).

**Then push and tag:**
1. Extract the **changed-files zip** over the repo folder, "Replace the files".
2. In the repo folder:

```powershell
git add .
git commit -m "Release B: master, one-code onboarding, company seats, company profile, version 0.1.57"
git push origin main
git tag v0.1.57
git push origin v0.1.57
```

3. Wait for the **Release** run (green tick); check `Quot3-Setup-0.1.57.exe`, its `.blockmap` and `latest.yml` are on the release; Settings > Updates > Check for updates > Restart.
4. Phone: merge `main` into `pwa` after the push (section 8).
5. Fill `docs/M24_OWNER_CHECKLIST.md` on real devices and send Claude the failed lines (Phase 274).

## 11a. Release A = 0.1.56 [A] (Phase 256, 2026-11-13): exact steps for the owner

What it contains: Phases 251-256 (Dashboard five tiles, one Price List search, phone stacked prices, AI off by default, price rights: automatic refresh + visible "Rights of this seat" block, a rights change rings the doorbell, refusals say "needs Overwrite" / "needs Add" / "needs Edit" / "needs Delete" / "needs Structure"). Phase 249 (0.1.55) was never pushed or tagged, so 0.1.56 also carries the whole Price List (Milestone 23): run Supabase files 18, 19, 20 and 21 in that order. [A]

1. **Supabase FIRST** (SQL editor, once per company project, in this order, skipping any that were already run): `supabase/sql/18_price_list.sql`, `19_price_perms.sql`, `20_price_log.sql`, then `21_price_perms_bell.sql`. Never edit a file after it was run. Each one is safe to run twice. The sandbox never runs them: checklist G in `docs/SUPABASE_MIGRATIONS.md` is yours to tick.
2. Extract the **changed-files zip** over the repo folder and choose "Replace the files" (see section 3, step 1).
3. In the repo folder run:

```powershell
git add .
git commit -m "Release A: price rights, Dashboard, Price List fixes, version 0.1.56"
git push origin main
git tag v0.1.56
git push origin v0.1.56
```

4. Wait for the **Release** run on GitHub Actions (green tick), check `Quot3-Setup-0.1.56.exe`, its `.blockmap` and `latest.yml` are on the release, then Settings > Updates > Check for updates > Restart.
5. Phone: merge `main` into `pwa` after the push (section 8).
6. Check with two seats: seat 1 changes a flag in Settings > Price List > Who can edit; seat 2 (PC and phone) shows the new rights within seconds without opening the Price List (Settings > Price List > "Rights of this seat" shows when it last checked); seat 2 trying a change it may not make says "needs Overwrite" (or the flag it lacks).
