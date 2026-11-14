# M24_OWNER_CHECKLIST - Milestone 24 (release 0.1.57 [A]), UNFILLED

For the OWNER, on real devices. Nothing below was run by Claude: the sandbox has no real Supabase, Windows PC, Android phone or printer. Tick a line only when YOU saw it work; write what you saw next to it. A line that fails goes to Claude as a Phase 274 fix-pack report (screenshots help; never paste a password, code, key or token).

Setup steps live in `docs/MASTER_OWNER_SETUP.md`; release steps in `GITHUB_UPDATE_PUSH.md` section 11b.

Date: ____   Windows version: ____   Phone + browser: ____   App version shown in Settings > Updates: ____

## A. Master project (once)
- [ ] A1 Master Supabase project made, 2FA on, sign-ups OFF (`MASTER_OWNER_SETUP.md` 1).
- [ ] A2 `M01_tables.sql`, `M02_rls.sql`, `M03_helpers.sql` ran in that order, no error (2).
- [ ] A3 `node tools/master-cli.mjs init` made the KEK and PEPPER; both saved in the password manager (3).
- [ ] A4 Secrets set; 13 Edge Functions deployed and visible in the dashboard (4).
- [ ] A5 The master Project URL and anon key were put in `src/shared/master/config.ts` (public values) BEFORE the tag was pushed (see `GITHUB_UPDATE_PUSH.md` 11b). Until then the app behaves exactly like 0.1.55.
- [ ] A6 Keep-alive for the free master set up (9). Notes: ____

## B. Link the first company (seat 1 PC)
- [ ] B1 `enrol-token "<company label>"` printed a token.
- [ ] B2 Settings > Company seats > Link to master: token + label + company service_role key; result in plain words says linked; the key field is empty afterwards.
- [ ] B3 The status line says "Linked as seat 1". Another PC of the same company (updated, never touched) says linked within a few minutes on its own (silent adopt).
- [ ] B4 Master unused / not linked company: a PC that never linked behaves exactly as 0.1.55 (sync, print, Settings).

## C. Existing devices keep working
- [ ] C1 After the update, an existing PC still syncs with no login prompt.
- [ ] C2 An existing phone (set up the old way) still opens, syncs and shares with no login prompt; the first-launch code screen does NOT appear for it.
- [ ] C3 The old five-field form is still reachable (phone: "Advanced: enter details by hand").

## D. New phone, one code
- [ ] D1 Seat 1: Company seats > Add seat > a code is shown once; "Show code" works for that seat later.
- [ ] D2 New phone (clean browser data): the first screen has ONE field; typing a wrong character shows feedback; the right code connects and goes into the first sync.
- [ ] D3 A wrong / revoked code gives the same plain words, no detail leaked.
- [ ] D4 Offline: "can't reach the master" wording, nothing broken.

## E. Seat actions while a phone / PC is open
- [ ] E1 Rename a seat label; the list updates.
- [ ] E2 Regenerate a code: the old code stops working at once; devices already linked are unaffected.
- [ ] E3 Reset a seat while its PC and phone are open and syncing: both reconnect by themselves, nobody types anything (about a minute at most).
- [ ] E4 Reset while the device is offline: it recovers when it comes back online.
- [ ] E5 Delete a seat (type DELETE): its devices stop with "This seat was removed. Ask the admin for a new code."; local data is NOT wiped.
- [ ] E6 Seat 1 has no Reset / Delete buttons.
- [ ] E7 15-seat cap: the 16th "Add seat" gives the cap message.
- [ ] E8 Legacy seat (made before the master) shows "existing login" and the "Reset to enable a code" explanation.

## F. Price rights, live
- [ ] F1 "Price List rights" button per seat opens the existing rights editor for THAT seat.
- [ ] F2 Seat 1 changes a flag; seat 2 (PC and phone) shows the new rights within seconds, without opening the Price List.
- [ ] F3 A refused change says which right is missing ("needs Overwrite" etc.).

## G. Company profile
- [ ] G1 Seat 1: Settings > Company, Save once; name / phone / address / logo reach the master (notice words say so).
- [ ] G2 Another PC, within about 6 hours or after restart: Settings > Company shows the company default.
- [ ] G3 On that PC, edit one field: only that field shows "This PC differs"; "Use company default" brings it back.
- [ ] G4 Print, Save PDF and Copy image on that PC show the effective name / phone / address / logo (page feel on the real printer: ____).
- [ ] G5 Phone: after a sync / restart the share image and PDF show the company default (phone has no override editor).
- [ ] G6 Logo over 150 KB after resizing: seat 1 sees the notice, the other PCs keep the old logo.

## H. Master paused or down
- [ ] H1 Pause the master project (or turn the internet off for the master only): daily work, sync between devices, print and share all keep working.
- [ ] H2 Only the master-based actions say "Master unreachable"; they work again after resuming.

## I. Backup
- [ ] I1 `node tools/master-cli.mjs export --out master-backup.json` works; passwords and keys are sealed in the file.
- [ ] I2 App backup export on a linked PC and on a linked phone: the file opens / restores; no code, password, key or device token is in it.

## J. Quick fixes on real devices (Phases 251-254)
- [ ] J1 Dashboard: five tiles in ONE row at 1366 x 768 and about 1100 px wide, equal height, readable in two themes.
- [ ] J2 Price List: ONE search box searches every tab; typing keeps focus.
- [ ] J3 Phone: Price List stacked price columns look right.
- [ ] J4 AI off (default): the Create-page AI switch is hidden; the billing price strip behaviour is as you want (open question from the design: confirm).

## Result
Everything ticked: ____   Failed lines (letter + number + what you saw): ____
