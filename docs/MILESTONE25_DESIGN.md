# MILESTONE 25 — Backup cap, phone Payments (QR), per-phone rights, data protection and restore, profile page, Country Wars (Phases 275-297)

**Planned 2026-11-24 (docs only; nothing built, run or tested).** Binding for Phases 275-297. Rules: `CLAUDE_MUST_READ.md` section 10t and the "ONE PHASE PER SESSION" block at its top. Everything in 10s and earlier still holds. The code base this plan was read from is **0.1.61**.
Items marked **[A]** are unconfirmed assumptions; say so in every phase log. The owner's answers (section 3) are binding; nothing else is.

---

## 1. What the owner asked for (2026-11-24, in his words, cleaned)

1. **EXE: automatic backups must not eat disk.** Keep only the newest **3** automatic backups. When a new day's automatic backup is made, the oldest one is deleted by itself.
2. **PWA: a detailed Profile page** (the owner left the content to me, section 4.7).
3. **PWA: data is not protected.** The browser keeps deleting it. Protect it as far as a browser allows.
4. **PWA: a diff logic.** Even if the data is cleared (by the browser or by hand), the phone compares with the Supabase server and pulls everything again.
5. **PWA: the owner's QR page** (public repo `phantomdx010alpha/ank-meen-qr`, source copied into `docs/reference/qr_payments_source/`) becomes a PWA feature. The default bank and UPI details stay exactly as they are; more banks can be added and the existing ones edited. In the PWA, pick a bill and share a QR for that bill's amount as its OWN image (not inside the bill image).
6. **EXE: add the owner's HTML game "Country Wars"** (copied into `docs/reference/country_wars_source/`).
7. **EXE, seat 1 as admin: per-phone control** (which PWA phone may see or do what). Customer address and contacts must not leak to staff, the Price List can be locked, and more of the same. Applies to **phones only**.
8. **PWA image share (only):** remove the duplicate "Adjustments total" row (desktop keeps its toggle).

## 2. Facts found in the code (read 2026-11-24 in the 0.1.61 zip, not run; re-check before relying)

- **Backup (desktop):** `src/shared/backup/backupRules.ts` has `BACKUP_KEEP_AUTO = 14` and `filesToPrune(all, keep)`; it lists ONLY `kind === 'auto'`. `backupService.ts`: `autoIfDue()` (first launch of the day) makes one automatic backup and THEN prunes; `create('auto')` also prunes; `keepAuto` can be injected by `opts` but `main/index.ts` (line ~276) does not pass it, so 14 applies. Kinds never pruned: `manual`, `pre-migration`, `pre-restore`, `pre-import`, `pre-wipe`, `pre-rollback` (they also pile up). Prune does `rmSync` of the file plus `repo.remove(file)`. `BackupSection.tsx` prints "(the newest {keepAuto ?? 14} are kept)". Prune only runs when a backup is created: a PC that already holds 14 keeps them until the next daily backup.
- **PWA persistence (phone):** `pwa/ui/bootstrap.ts:28` calls `requestPersistence` once when the database can write; `Settings > Storage` has "Ask the browser to keep my data" and shows `persisted`. Nothing else protects the data. **The "storage was cleared" detector** (`pwa/platform/clearedData.ts`, used in `App.tsx` ~line 201) keeps its marker in **localStorage**, and the sync login (vault) sits in IndexedDB: **"Clear site data" / eviction removes both at once**, so after a real wipe the detector says "ok". It can only notice partial loss. No browser lets a page survive a full clear (localStorage, IndexedDB, Cache Storage and cookies go together). The ONLY thing that survives is the server.
- **PWA first sync exists:** `pwa/sync/firstSync.ts` `prepareFirstSync` (light manifest compare, writes nothing) + `applyFirstSync` with scope `all` / `recent`, built on `shared/sync/diff.ts` `planSync`. The one-code first-launch screen exists (Phase 269, `ConnectCode.tsx`, `connectCodeModel.ts`; the seat code is reusable until reset [M24 A]). So the "restore after a wipe" is mostly: blank phone + one code + automatic scope `all`. What is missing: nothing makes that automatic, nothing warns that unsynced bills will die with the wipe, and nothing re-checks a phone that lost only part of its data.
- **Phone share image:** `pwa/share/shareBill.ts` line ~48 calls `buildPrintModel(bill, style, { ...DEFAULT_PRINT_SETTINGS, company: block }, decision)`. `hideAdjustmentsTotal` exists in the shared print model (desktop key `print.hideAdjustmentsTotal`, default false) but the phone never sets it, so `layout.ts` draws the "Adjustments total" footer row (bold, `totalRow`) under the adjustment rows. PDF share uses the same layout.
- **Games (desktop):** `resources/games/manifest.json` + one folder per game, played in a locked frame `q3game://<id>/` (CSP: self only, no network, `font-src 'self'`). `src/shared/games/manifest.ts` accepts ONLY: `source` = a GitHub URL, a `commit` SHA, a licence from `ALLOWED_LICENCES` (MIT, BSD, ISC, Apache-2.0, Unlicense, CC0), tags from `GAME_TAGS`, `lang` en/zh. The owner's game has none of those, so an "own game" rule is needed. The game also uses Google Fonts and a `flagcdn.com` fallback, both blocked in the frame.
- **Rights today (seat permissions):** `shared/pricelist/perms.ts` (five Price List flags), company SQL `19_price_perms.sql` (`sn_price_perms`, `qt_price_perms_get/list/set`; seat 1 sets, any seat reads its own), `21_price_perms_bell.sql` (doorbell), `22_seat_reuse.sql`; desktop `priceRightsService.ts`, phone `pwa/data/priceRights.ts` + `runtime.refreshPriceRights`, cached per device, refreshed on start / sync / refusal / doorbell (Phases 255-256). The desktop "Company seats" panel (Phases 265-266, `CompanySeatsPanel.tsx`) already has inline Price List rights. **Seat 1 always has every right and cannot lose them.** Next free numbers: company SQL **23**, master SQL **M05**.
- **Master (company registry) keeps** companies, seats, devices, enrol tokens, attempts, log, and the company **profile** (`companies.profile` jsonb + `profile_version`; functions `profile-get` / `profile-set`; phone `pwa/sync/companyProfile.ts` caches it). 10s says the master holds nothing else; section 5 below extends that by exactly one more item (payments).
- **Phone settings pages:** `pwa/ui/settingsPages.ts` (Themes, Company, Branch and sync, Share defaults, Storage and backup, App lock, About). There is no Profile page. Seat number and label come from the master bundle / heartbeat (`pwa/sync/master.ts`).
- **No QR / UPI / bank code exists anywhere in the project today.**

## 3. Owner decisions (binding)

| # | Decision |
|---|---|
| D1 | Keep the **newest 3 automatic** backups (not "3 calendar days"). The oldest is removed when a new automatic backup is made, and surplus old ones are removed at app start. |
| D2 | The `pre-*` safety copies are pruned too: the **newest 3 of each kind** are kept [A: per kind, so one pre-wipe copy never crowds out the pre-migration copy]. **Manual backups are never deleted.** |
| D3 | Profile page: whatever I suggest (section 4.7). |
| D4 | Rights apply **only to phones**. PCs on other seats are not touched by the new flags (the Price List flags keep working for PCs as today). |
| D5 | Per-phone rights work **like the Price List rights**: seat 1 toggles flags per seat; seat 1 always has all. |
| D6 | A phone without the right sees **no customer address / contact anywhere in the app**; they are deliberately visible **only on the shared image / PDF** (and the QR image shows none). |
| D7 | Unsynced data after a wipe: **just warn** (no blocking). |
| D8 | Payments (banks, UPI) **sync to every phone** through the master; seat 1 controls them; seat 1 can switch the Payments screen off for a restricted phone. |
| D9 | The QR amount defaults to the bill's **grand total** and may be edited. |
| D10 | Country Wars is entirely the owner's own work; it appears in the **same Games list** as the other games. |
| D11 | Order of work: the planner's call (section 7). |

## 4. Designs

### 4.1 Backup (Phase 275)
`BACKUP_KEEP_AUTO` becomes 3. `filesToPrune` gets one more rule: for each `pre-*` kind keep the newest 3, never list `manual`. Prune also runs ONCE at start-up even when no backup is due (so a PC that holds 14 drops to 3 on the first launch of the new version, not after the next daily backup). Safety: never delete the only copy of a kind below 1, never delete a file this very call just created, `rmSync` + `repo.remove` as today, a prune error is logged and never blocks start-up. Settings text updated ("the newest 3 are kept"). The Dashboard "last backup" reads the folder and needs no change.

### 4.2 Phone share image (Phase 276)
The phone passes `hideAdjustmentsTotal: true` to the print model, always (no phone setting). Items total, round-off and grand total rows are unchanged; the adjustment rows themselves stay. Desktop is untouched. Covered for image AND PDF because both use the same `ShareLayout`.

### 4.3 Country Wars (Phase 277)
Copy the game into `resources/games/country-wars/index.html`, make it run inside the frame: **vendor** Lilita One and Nunito (OFL fonts, woff2, from the `@fontsource/*` npm packages fetched with `npm pack` in a scratch folder, NOT added to `package.json`; the OFL text goes in `docs/THIRD_PARTY_GAMES.md`); replace the Google Fonts `<link>` with local `@font-face`; list every country code without an inline flag SVG and make the `flagcdn.com` fallback unreachable (inline SVG or a plain code badge). Manifest rule for own games: a new allowed licence value (suggest `Owner`) for which `commit` may be empty and `source` may be the owner's repo URL or omitted [A: Phase 277 picks the smallest change that keeps every other validation intact]; tag `arcade`, `lang` en, `players` 1, `touch` false [A]. Same Games list, same tile.

### 4.4 Payments (Phases 278-284)
**Data model** (`src/shared/payments/`): `PayeeAccount { id, name (the tab label, e.g. "Kotak Mahindra (Merchant)"), kind: 'merchant' | 'upi' | 'account', merchant?: { pa, ver, mode, orgId, tr, mid, mtid, mc, qrMedium }, upiId?, account?: { number, ifsc }, hasAccountMode?: boolean }`, plus `recipient` (the payee name, today "Meenakshi Buttons"), `defaultId`, `version`. **Seed = the three tabs and two account/IFSC pairs of the original page, byte for byte** (Kotak Merchant: `0798048A0284669.bqr@kotak`, ver 01, mode 02, orgId 00079, tr 3373252A, mid 0798048A0284669, mtid 3373252A, mc 5949, qrMedium 04, A/C 112011011564 KKBK0008048; SBI: `meenakshibuttons@sbi`, A/C 54047475538 SBIN0040015; Kotak Basic: `9448366753@KAYPAY`). **URL builders** reproduce `buildUpiUrl` exactly for the three shapes, plus the amount formatting rule of `generateQR` (integer stays an integer, else two decimals with trailing zeros removed; empty amount = payer enters). Tests compare the produced text with the original's output.
**Sync (D8):** the master gets two more columns on `companies` (`payments jsonb`, `payments_version int`) via `supabase/master/M05_payments.sql` and two Edge Functions `payments-get` / `payments-set` that copy the pattern of `profile-get` / `profile-set` (a separate pair so the frozen profile contract is untouched [A]). Who may write: a device whose rights include `editPayments` (seat 1 always). Who may read: every device with `seePayments`. The phone caches the list in IndexedDB (works offline), seeds the defaults on first run when no master list exists yet, and publishes its list the first time an authorised phone saves. Last write wins by `payments_version` (older ignored), like the profile. **The master therefore holds ONE more item (the payments list); 10t records that.**
**QR:** a small MIT library (`qrcode-generator`, no dependencies [A], pinned by Phase 282 in `DEPENDENCY_VERSIONS.md`) bundled into the PWA build, never a CDN. `src/pwa/share/qrImage.ts` composes the branded image like the original `buildComposedImage` (logo, payee name, bank label, amount, QR) on a canvas, using the existing share image plumbing (`pwa/share/image.ts`, `shareSheet.ts`). The company logo comes from the effective company profile (the original's `Logo MB.jpg` is only a reference).
**Screens:** a Payments page (pick payee, bank-account switch, amount, Generate, Save image, Share, full screen) and an editor (add, edit, remove, reorder, set default; validation: UPI id shape, IFSC shape `^[A-Z]{4}0[A-Z0-9]{6}$`, account digits 9-18). **Bill to QR:** from a bill (and from the Payments page "Pick a bill") the amount is the bill's grand total (D9, editable) and the result is shared as its own image. The bank-account switch is remembered per phone.
**Not in M25 [A]:** a desktop Payments editor; the QR on desktop; recording that a payment was received.

### 4.5 Per-phone rights (Phases 285-291)
**Flags (phones only, D4) [A names and exact effects frozen in Phase 278]:**

| Flag | Without it the phone... |
|---|---|
| `seeAddress` | shows no customer address in the app |
| `seeContact` | shows no customer phone / contact in the app (and no call / WhatsApp buttons) |
| `seePriceList` | has no Price List screens, search or entry (the five existing Price List edit flags stay separate) |
| `seeSales` | shows no sales totals: Dashboard sales, History list totals, customer totals (the bill editor still shows its own amounts: a quotation cannot be made blind) |
| `seePayments` | has no Payments screen and gets no payments list |
| `shareBills` | cannot share image / PDF / QR |
| `exportData` | cannot export or import the phone's data file, cannot reset the phone (that file holds every customer) |
| `deleteBills` | cannot delete bills |
| `editOldBills` | cannot edit a bill dated before today (local date) |
| `editCustomers` | cannot add, edit or merge customers |
| `editPayments` | cannot change the payments list |

**D6 rule:** the customer address and contact are blanked in every in-app screen for a phone without the right, but the shared bill image and PDF still carry them. This is deliberate and tested.
**Storage:** company SQL `23_seat_rights.sql`: `sn_seat_rights(org_id, seat_no, flags jsonb, updated_at)` with `qt_seat_rights_get` (any seat: its own), `qt_seat_rights_list` / `qt_seat_rights_set` (seat 1 only), and a doorbell on set exactly like 21. Seat 1's rows are forced to all-true. **Existing seats are seeded all-true at migration** (nothing may break on update, 10s); **seats created later start from the "Staff" preset** [A: share bills, see Price List, edit customers on; everything else off]. Desktop: toggles and three presets (Full, Staff, Viewer) inside the Company seats panel; phone: fetch, cache (offline keeps the last answer), refresh on start / sync / doorbell, reuse the Phase 255-256 machinery. A phone with no answer yet and a linked seat other than 1 uses the Staff preset [A]; a phone with no sync has everything (as with Price List rights).
**HONEST LIMIT (written in Settings and in the checklist):** these flags hide and block **in the app**. The records still travel to and sit in the phone's storage (the shared image needs them, D6), so a technical person with the phone could read them. Real withholding on the server is NOT part of M25 and would conflict with D6; it is listed as a later option. Rights are enforced by the client, not by SQL (a modified client could bypass), except what the existing Price List flags already enforce.

### 4.6 Data protection, restore and the diff (Phases 292-294)
Honest limit first (section 2): a full clear removes everything on the phone, the sync login included. The design therefore is "make loss rare, make recovery one step, warn about what cannot be recovered":
- **292 Protection:** a visible protection state in the app (persisted yes / no / unknown, installed to home screen yes / no); when not persisted, a calm banner explains why and offers "Ask the browser to keep my data" and the install steps; persistence is re-requested after install and after the first save; the pending-outbox count is shown as a warning line when bills are not on the server yet (D7: warn only, nothing is blocked), with "Sync now". The old marker detector stays (it still catches partial loss) and gets a second marker kept in a different store [A].
- **293 Restore:** a phone that starts completely empty is the same screen as a first launch. It already takes one code; this phase makes it the **restore** path: wording ("Restoring a phone? Type the code"), after the code works the phone runs `prepareFirstSync` + `applyFirstSync` with scope `all` by itself (no questions; `recent` stays under Advanced), shows one progress screen (bills, customers, Price List, company profile, payments, rights) and ends on the Dashboard. Things that only existed on the phone and were never synced are gone; the screen says so in one line.
- **294 The diff (self-heal):** on app start and then at most once a day while online and idle, the phone compares the server's light manifest with its own (`planSync`, same code as first sync) and pulls what is missing or different; first a cheap count / cursor check so a healthy phone does almost nothing; the result is one status line ("Checked 14:05, all in step" or "Fetched 37 missing records"); it never uploads anything it did not already queue and never overwrites a newer local edit (the normal base_version rules stay). This covers a browser that drops part of IndexedDB without clearing the login.

### 4.7 Profile page (Phase 295)
A new phone Settings page "Profile" (first in the list, and the avatar / name line on the Dashboard opens it). Read-only except for the links it carries. Content: **who** (seat number and label, company name, branch name and PO prefix, device name, app version); **connection** (signed in or not, last sync, pending bills, master state); **rights** (the Price List flags and the new flags in plain words, "last checked"); **this phone's data** (bills, customers, Price List rows counts; storage used / quota; protected yes / no; last backup file export; last consistency check); **company** (the effective profile the phone prints with, with the link to Company settings); **payments** (count, default payee, last updated); **help** (support line and diagnostics copy). Nothing secret (no code, token, password, key) is ever shown (`shared/master/redact.ts` rules).

## 5. Architecture changes to the standing rules (recorded in 10t)
- The master holds **one more item: the company payments list** (jsonb, bank / UPI details). Still no bills, no Price List data, no company records. The service_role and secrets rules of 10s are unchanged.
- Phone rights are a **new company-SQL table (23)**, not a master table: they are per company, like the Price List rights.
- The QR library is the only new npm dependency of the milestone (Phase 282); the fonts of Phase 277 are copied files, not dependencies.

## 6. Compatibility (each execution phase re-proves its rows by test)
- Without the new SQL / master columns a phone behaves exactly as 0.1.61 (no rights answer = Staff preset only when a seat is linked AND the server says rights exist; a server that does not know `qt_seat_rights_get` answers "not available" and the phone then has everything [A, so an old company project never locks its phones]).
- Existing devices keep working: no vault format change except OPTIONAL fields; no numbered SQL edited; no forced re-login; no local data removed.
- Desktop other than backup, Games list and Company seats panel is untouched. The phone classic layout and its pinned files (`ui.css`, `tokens.css`, `themes.css`, `pwa.css`, the DOM snapshot) are not touched without the owner's approval (10r); new screens follow the Phase 245 pattern (`layoutHasRoute`), and the Payments and Profile pages are reachable from Settings so every layout, classic included, can open them [A: confirmed by `classicParity` staying green; if the snapshot must change the phase stops and asks].

## 7. How the work is split (one phase = one free Claude session) and release points

| Group | Phases | Release |
|---|---|---|
| Quick wins | 275 backup cap, 276 phone share row, 277 Country Wars | **A = 0.1.62 [A] at 277** |
| Payments | 278 [D] contract freeze (also freezes rights), 279 pure core, 280 master SQL + functions, 281 phone data + sync, 282 QR library + image, 283 screens, 284 bill to QR | **B = 0.1.63 [A] at 284** (deploy master M05 + functions first) |
| Phone rights | 285 SQL 23, 286 shared core + desktop service, 287 desktop panel, 288 phone runtime, 289 hide customer contact, 290 hide Price List / sales / payments / export, 291 action rights | in C |
| Protection | 292 protection + warning, 293 restore, 294 diff | in C |
| Profile | 295 profile page | in C |
| Gate | 296 QA gate + `docs/M25_OWNER_CHECKLIST.md` | **C = 0.1.64 [A] at 296** (deploy SQL 23 first) |
| Fix pack | 297 only if the owner's report needs it | no bump |

**Order:** 275, 276, 277 any order, any time. 278 before every other Payments or rights phase. 279 → 280 → 281 → 282 → 283 → 284 (280 needs 279 shapes; 281 needs 279 and 280's contract; 283 needs 281 and 282). 285 → 286 → 287; 286 → 288 → 289 → 290 → 291 (290 and 291 touch Payments screens only if 283 exists, otherwise they add the gate for later). 292, 293, 294 any time after 278 (294 after 293). 295 after 288 and 281 (shows what exists; missing parts show "not set up"). 296 last. A phase that finds its dependency missing STOPS and says so.

## 8. Security rules (never loosen)
Everything in 10s plus: bank account numbers and UPI ids are never logged, never put in diagnostics (add the keys to `shared/master/redact.ts` in Phase 279); the payments functions authenticate with the device token and check the right on the master; the rights flags are normalised (anything but a real `true` is false); the QR image never shows the account number unless the owner's original did not hide it [A: the original shows "A/C number · IFSC" under the bank name in the tab list but the composed image shows the bank label only; Phase 282 matches the original].

## 9. Open items for the owner (defaults in brackets are used if unanswered)
1. Flag names and effects of 4.5 [as listed; Phase 278 may rename for plain words].
2. New seats start from the Staff preset [yes] and existing seats keep everything [yes].
3. Payments editing only on a phone that has `editPayments`; no desktop editor in M25 [yes].
4. Payments page reachable from Settings so classic works [yes].
5. `qrcode-generator` as the QR library [yes].

## 10. Standing gaps and risks (never "verified" by a sandbox)
Real Android / iOS install and storage behaviour; whether the browser grants persistence; a real wipe and restore on a real phone; real Supabase (master M05, functions, SQL 23); real UPI apps scanning the three QR shapes (the owner's page already works with them; the new code must produce the same text); a real WhatsApp share of the QR image; Country Wars rendering inside the real game frame; printing nothing changes. All of it is `docs/M25_OWNER_CHECKLIST.md` (written in Phase 296).

---

## 11. Amendments made by Phase 278 (the contract freeze, 2026-11-24; details in `API_CONTRACTS.md` M25-12)

- Section 4.4: `hasAccountMode` is dropped (derived from `account`); payments writes are compare-and-set on `expectVersion`; error codes Q3M22-Q3M27 are added; the master reads the seat's rights from the company project to check `seePayments` / `editPayments`.
- Section 8: the original page's composed image DOES print "A/C number - IFSC" in bank-account mode (the sentence saying it shows the bank label only was wrong). M25 follows 10t and Phase 282: the QR image never carries an account number or IFSC; in account mode it prints "Bank account transfer".
- Section 6: with company SQL 23 absent every flag is "everything" EXCEPT `editPayments`, which stays seat 1 only.
- Section 4.5: the Viewer preset and the in-app share-preview rule are defined (Viewer sees address, contact, Price List, sales and Payments; the preview picture is not redacted because it is the file that goes out).
