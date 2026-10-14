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
