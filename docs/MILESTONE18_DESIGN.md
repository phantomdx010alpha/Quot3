# Milestone 18 — Phone UI layouts (Phases 189–196)

Planned 2026-10-22 from the owner's request, on top of version 0.1.31. **Docs only: nothing was built, run or tested when this was written. No code, version, tag or SQL changed.** Phase 188 (Milestone 17 QA gate) and Phase 69 (release gate) are STILL PENDING (checked in `PHASE_STATUS.md`); this milestone does not replace them. Versions below are placeholders (`0.1.32` ...); if Phase 188 ships `0.2.0` first, renumber to `0.2.1` ... .

**Items marked [A] are assumptions the owner has not confirmed. Items marked [CHECK] are facts only the owner's real phone can show.** Say "[A] unconfirmed" in every phase log.

**Testing rule (owner, repeated on purpose):** do NOT run the full test suite in any Milestone 18 phase except the final gate (Phase 196), and only if the owner agrees. Run `npm run typecheck` once plus only the files you wrote or changed plus those that could plausibly conflict (named per phase in `PHASES.md`). No desktop build, no dev server. Name what you ran and what you did not.

---

## 1. What the owner wants (firm decisions)

1. Three NEW phone layouts, switched in phone Settings. The CURRENT phone UI stays the default (`classic`) and does not change.
2. A new phone setting `ui.layout` with values `classic` (default), `tidy` (A), `guided` (B), `inbox` (C). It lives in Settings > Themes (appearance) and is remembered like `theme.name`. Switching layouts must never lose or change any bill data.
3. Phone only. The desktop PWA window and the Windows app are out of scope.
4. The layouts are views over the SAME data, sync, share, `*Model.ts` and shared-calc code. Money, formats, paper thresholds and sync are untouched. No format-name branching. Tokens only, no raw colours. Phosphor icons only, no emoji. The Phase 92 selector rule applies (no fresh arrays/objects from store selectors).
5. Item names are NEVER truncated in the new layouts. They wrap fully (editor rows, bill view, lists, Home); in the editor the name box grows while typing; party names in lists wrap too. Phone rule: "names always wrap, never ellipsis". Whether classic also gets this is [A] (opt-in setting proposed, section 8).
6. All layouts keep the existing owner rules: Create always opens a clean bill (A31), unsaved-changes guard, name required, drafts and recovery, share image/PDF only (no print), "Edit on PC" for hybrid and stock transfer, version gate and read-only banners.

The owner's words are in `docs/reference/REQUIREMENTS_ORIGINAL.md` ("Part A addendum 7").

## 2. The three layouts (summary; the mockup canvas is the detail)

Reference art: `docs/design/m18_phone_ui_options.html` (9 phone mockups, 390x800; rows A, B, C; sample data is the owner's real bill with invented long item names). **It is reference art, not code to copy.** (The planning session could not read the canvas itself: it is a JavaScript-packed page with no static text. This document follows the owner's written description of it. A phase session that can open it should compare and report any difference as a question, not change this document silently.)

**A "Tidy tabs" (`tidy`).** Same five-tab idea, but New is a raised round button in the centre of the nav. Home = today / month tiles plus recent bills. The bill and item row is TWO lines (name wraps; amount right, bold; second line "382 x Rs34 · +18% GST"). The bill screen has a sticky bottom bar [Share (primary)] [Edit] and a header with the party name as the title and PO / date / format under it. The editor hides the bottom nav, has a sticky totals bar with a big Save, a visible GST / Non-GST segmented control under the party, and a bottom sheet for the rare fields (typed total, extra columns / Mark, B and R+B, GST %).

**B "Guided flow" (`guided`).** Home has one huge "New bill", "Continue draft", and today's bills with a visible Share button on each row. Three steps: Party, Items, Review. The Items step has a quick-add bar above the keyboard (Item, Qty, Rate, GST %, Add) with the running total; added lines form a list above it. The Review step shows the total, a Rough / Professional segmented control, "Share image" (primary), "Share PDF", the line "Saved as SMB-xxxx; pick WhatsApp in the share list", and Done. Nav is four tabs: Home, Bills, Customers, More.

**C "Bills inbox" (`inbox`).** Home is the bills list grouped by day with a search bar always on top, a one-line today / sync strip, a floating "New bill" button, and Settings as a gear in the top bar (no bottom nav). The editor and the bill view look like the paper bill (light paper card, columns # / Item / Qty / Rate / Amount; GST lines as Before GST / GST / Total); tap a cell to edit; a docked toolbar above the keyboard [previous][next][B][R+B][done]. The bill view has floating Share and Edit buttons.

## 3. Owner's claims checked against the code (0.1.31)

Everything below was read in the code; nothing was run. **Confirmed** unless marked.

| # | Claim | Result |
|---|---|---|
| 1 | Phone editor has no bill date picker; `setBillDate` exists | **Confirmed.** `editorModel.ts` line 80 defines it; nothing in `BillEditor.tsx` calls it. New bills get today's date (`billDate: o.today`). |
| 2 | No undo after removing an item row | **Confirmed** (no undo in `ui/editor`). |
| 3 | After Save the app opens the read-only bill | **Confirmed.** `App.tsx` `onSaved` -> `navigate(goBack(r), 'billview', id)`. |
| 4 | First party autocomplete builds a Fuse index | **Confirmed.** `partySearch.ts` rebuilds the index lazily after any change; the directory loads when the editor opens (`BillEditor.tsx` line 81). Phase 187 measured about 270 ms in the sandbox (Node + jsdom), not a phone. |
| 5 | Stacked top banners | **Confirmed, and worse than listed:** `App.tsx` can stack six (read-only, offline, version gate, storage cleared, update, install). |
| 6 | Bottom nav stays visible while editing | **Confirmed.** `<BottomNav>` is always rendered. |
| 7 | Nav highlight stays on Home for a bill opened from Home | **Confirmed but it is correct behaviour, not a bug.** `activeTab` lights the nearest tab in the stack, so a bill opened from History lights History. Downgraded to "leave as is"; each new layout has its own nav anyway. |
| 8 | WhatsApp cannot be targeted from a PWA | **Consistent with the code:** `share/shareSheet.ts` uses Web Share with a file, or a download. [CHECK] on the phone (Phase 173 spike results are in `MILESTONE17_DESIGN.md` section 8). |
| 9 | Names are truncated | **Confirmed, and it also hits numbers.** `ui.css`: `.q3-li-title` (lists, party names) and `.q3-ename` (editor rows) use `text-overflow: ellipsis; white-space: nowrap`; `.q3-eqty`, `.q3-erate`, `.q3-eamt` also ellipsise numbers in 52 / 60 / 76 px columns, so a large amount can be clipped. New layouts must never ellipsise names OR amounts. The expanded editor name is a single-line `<input>` (`BillEditor.tsx` line 215): a growing name box needs a `<textarea>` ([CHECK] text selection for B / R+B on a textarea). |
| 10 | Raw "12988.00" shows | **Confirmed, with a correction to the fix.** Bill cell strings come from shared `computeBill` (`shared/calc/billTotals.ts` uses `fmtMoney(x)` WITHOUT `indian`) and `BillView.tsx` / `BillEditor.tsx` print them as they are. History, Dashboard and Customers already use `fmtMoney(.., { indian: true, symbol: true })`. **Do NOT change `billTotals.ts`**: desktop grid, print and their snapshots depend on it. The new layouts format at DISPLAY time with a phone-only helper over `fmtMoney(v, { indian: true })`. |
| 11 | Classic tokens are 15 px text, 40 px touch | **Confirmed** (`--font-size-base: 15px`, `--touch-min: 40px`, `--nav-height: 52px`). |
| 12 | "rev 3" in the bill view | **Confirmed** (`BillView.tsx` line 53). |
| 13 | Labels to rename | **Confirmed:** "Total (typed)" (`BillEditor.tsx` 229), "Last export" (`SettingsStorage.tsx` 93, `Dashboard.tsx` 65), "Branch and sync" (`settingsPages.ts`, `SettingsSync.tsx`), "PO prefix" (`SettingsSync.tsx` 120), "Supabase URL / Public (anon) key / License key" (`SettingsSync.tsx` 68). **"GST Amt", "Amount", "Total" come from the shared format registry** (`shared/format/gst.ts`), which desktop headers and print also use: rename on the phone by a display map keyed by column key, never by editing the registry. |
| 14 | No swipe gestures exist | **Confirmed** (no swipe / touch handler found in `src/pwa/ui` or `App.tsx`). |
| 15 | Settings > Themes holds appearance | **Confirmed.** Settings is a list of sub pages (`settingsPages.ts`); the page id is `appearance`, label "Themes" (`ThemePicker.tsx`). The chooser is a new section on that page; the label stays "Themes" in classic. |
| 16 | `theme.name` is remembered | **Confirmed.** Stored in the `settings` store (`settingsRepo.ts`), read in `bootstrap.ts` (`isThemeName` check) and passed through `services.ts` / `App.tsx`; it travels in the backup file (not a `secret.` key). `ui.layout` copies this exact path. |

Also found: `PHASE_STATUS.md` phase table still shows Phases 186 and 187 as "planned", but the Current state block and phase log say both are DONE (0.1.27 and 0.1.28). Treat the log as truth; the table rows are stale (reconciled in Phase 196 / the Phase 188 docs sweep).

## 4. Layout switch architecture

**Principle: one app, one router, one set of guards. Layouts are interchangeable VIEW sets.** App.tsx keeps ALL state and behaviour it has today (router stack, unsaved guard, Back rule, update / install / offline / version-gate state, lock screen, theme, dashboard loading). It only chooses which screen components draw the pages.

```
settings store  ui.layout  --(bootstrap.ts, like theme.name)-->  services.layout  --> App.tsx state `layout`
App.tsx:  const L = LAYOUTS[layout]            // registry lookup, falls back to classic
          classic  -> exactly today's JSX (moved nowhere, edited nowhere)
          others   -> <L.Shell ...>{ L.screens[route] }</L.Shell>
document.documentElement.dataset.layout = layout   // CSS scope for the larger tokens
```

**Files (all new, under `src/pwa/ui/layouts/` and `src/pwa/ui/kit/`):**
- `layouts/layoutRegistry.ts` (pure): `LAYOUT_IDS = ['classic','tidy','guided','inbox']`, `LayoutId`, `DEFAULT_LAYOUT = 'classic'`, `isLayoutId(v)`, `LAYOUT_LABELS`, `LAYOUT_BLURBS`, `LAYOUTS` map of what is BUILT (starts with `classic` only; each layout phase adds its entry, so the chooser never offers an unbuilt layout).
- `layouts/types.ts`: the `LayoutDefinition` contract (below).
- `layouts/classic.ts`: marks classic. It does NOT wrap the old screens; App.tsx's existing branch stays literally as is.
- `layouts/tidy/*`, `layouts/guided/*`, `layouts/inbox/*`: per-layout Shell (top bar, nav, status pill) and screens (Home, Bills, BillView, Editor, Customers, Settings entry).
- `kit/*`: shared components and pure display helpers (section 5).
- `layouts/layouts.css` and `kit/kit.css`: new CSS only, every selector under the `.q3x-` prefix or `[data-layout='...']`. **No edit to `ui.css`, `tokens.css`, `themes.css`, `styles/pwa.css`.**

**What a layout owns:** the Shell (chrome and nav), how each route looks, the editor view, and its own nav items. **What stays shared and untouched:** `router.ts` (new layouts map their nav onto the existing route names: guided "Bills" = `history`, "More" = `settings`; inbox has no nav and opens `settings` from the gear; no new route names are needed), `editorModel.ts` (all edits, totals, save check), `editorIo.ts` (open / draft / save), `billViewModel.ts`, `historyModel.ts`, `dashboardModel.ts`, `customersModel.ts`, `data/*`, `sync/*`, `share/*`, everything in `src/shared/*`.

**Contract a layout must meet (frozen in Phase 189, `API_CONTRACTS.md`):**
- The layout's editor takes the SAME props as `BillEditor` (`db, id, now, apiRef, onDirtyChange, onChanged, onSaved`) and implements `EditorApi` (`save()`, `discard()`), so the unsaved-bill guard, system Back, tab taps and the update banner work unchanged.
- `onSaved(id)` is called after a save exactly as today. App decides what happens next per layout: classic -> bill view (today); tidy and inbox -> the bill view PLUS a "Saved" sheet with Share; guided -> its own Review step (it passes `silent` handling the same way `promptSave` does).
- Guided has internal steps. Back first steps back inside the editor, then (at step 1) falls into the normal guard. The layout supplies an optional `interceptBack(): boolean` that App's `handleBack` and the top Back button call BEFORE the guard. Classic never defines it.
- Create always opens a clean bill (A31): the editor `key` stays `cur.param ?? 'new'` and drafts follow the existing recovery offer.
- Every layout renders the version-gate / read-only / offline / update / install / storage-cleared information (as stacked banners in classic, as the status pill in the new layouts, section 5.6) and never hides the read-only state silently.
- Stock transfer, hybrid and unknown-layout bills open read-only with "Edit on PC" in every layout.

**Setting contract:** `ui.layout: 'classic' | 'tidy' | 'guided' | 'inbox'`, default `'classic'`, stored in the phone `settings` store, NOT synced (a per-phone preference, like `theme.name`), included in the backup file. An unknown stored value (for example after a downgrade) is treated as `classic` at start (`isLayoutId`, like `isThemeName`). Changing it applies at once, saves, and keeps the current route when it exists in the new layout (otherwise goes Home); if a bill is unsaved the change is held until the guard is answered. Changing layout never writes to bills, parties, drafts or the outbox.

**Hooks safety:** App.tsx's hooks stay unconditional and in the same order. The layout choice only changes which JSX is returned.

## 5. Shared elements (built once in `kit/`, reused by all three new layouts)

All use tokens and Phosphor icons only. Pure logic lives in `kit/*Model.ts` and is unit tested without a DOM; components stay thin.

1. **Item line** (`ItemLine`): two lines. Line 1: name (wraps fully, `overflow-wrap: anywhere`, never ellipsis) on the left, line total right, bold, tabular. Line 2 (muted): "382 x Rs34" plus " · +18% GST" when the row has GST. Built from the same row data the editor and the bill view already have (`computeBill` display cells); rich-text name runs (bold / red) are drawn with the existing `RichName`. Overridden totals show the plain-word marker "Set price yourself" (see 6).
2. **Totals block** (`TotalsBlock`): from the same footer lines (`itemsTotal`, adjustments, round-off, `grandTotal`), money in Indian grouping with the rupee sign on the final total. GST bills show "Before GST / GST / Total" in this order. The grand total is the largest figure.
3. **Share bar** (`ShareBar`): [Share (primary)] [Edit] for the bill view; the Review step uses the same component with Rough / Professional and Image / PDF. It calls the existing `SharePanel` logic / `share/shareBill.ts`; it never changes the bill (Phase 184 rule). There is no print.
4. **Bottom sheet** (`BottomSheet`): modal, drag handle, close button, focus trapped, Esc / system Back closes it (not the screen), 48 px targets.
5. **Snackbar with Undo** (`SnackbarHost`, `useSnackbar`): one message at a time (identical messages never stack, like the desktop toasts), 6 s, Undo button. First use: removing an item row restores the same row at the same place via an editor-model snapshot (one new pure function in the layout's editor model, not in `editorModel.ts`; or an additive export there if the phase proves it is needed, contract first).
6. **Status pill** (`StatusPill`, `statusModel.ts` pure): replaces stacked banners. Input = the same flags App.tsx already holds (read-only, offline, version-gate note, cleared note, update available, install offered, sync state). Output = at most ONE pill by priority (read-only > storage cleared > version gate > update > offline > install > sync), tap opens a sheet that lists every active notice with its action (Reload, Install, Try again). Nothing is hidden: the sheet always lists all of them. Read-only is also shown as a thin persistent line so nobody types into a bill that cannot save.
7. **Button hierarchy** (`Button`): `primary` (accent fill; one per screen), `secondary` (outline), `text` (no border). `SegmentedControl` for GST / Non-GST and Rough / Professional.
8. **Larger tokens, new layouts only** (`layouts.css`, scoped `:root[data-layout='tidy'|'guided'|'inbox']`): text 16 px (17 px for list titles), amounts 17–18 px semibold tabular, touch target 48 px, nav height 60 px. Classic keeps 15 px / 40 px. See `docs/design/DESIGN_TOKENS.md` (Milestone 18 note). Colours still come from the existing theme tokens, so every theme works in every layout.
9. **Money display** (`kit/display.ts`, pure): `moneyText(cell: string, opts?)` = `fmtMoney(cell, { indian: true })` for amounts and `{ indian: true, symbol: true }` for final totals; empty and non-numeric strings are returned unchanged. Never `toFixed`, never number arithmetic (rule 4.3).
10. **Plain-word labels** (`kit/plainWords.ts`, pure map, used only by the new layouts): see section 7.

**Wrap rule in CSS:** the `.q3x-*` classes for names, party names, list titles, bill rows and Home rows use `white-space: normal; overflow-wrap: anywhere; min-width: 0`. A test (section 9) scans the new CSS files and fails on `text-overflow: ellipsis` or `white-space: nowrap` on a name class, and on `nowrap` + `ellipsis` on any amount class.

## 6. Extra findings: where each one is handled

Each stays [A] until the owner confirms.

| # | Finding | Handling |
|---|---|---|
| 1 | No bill date picker | A date field (native `input type=date`, value `YYYY-MM-DD`) wired to the existing `setBillDate`, new layouts only. Phase 191 builds the field, layouts place it (a row under the party). Backdating is a behaviour change, [A]. |
| 2 | No undo after removing a row | Snackbar Undo (Phase 191). New layouts only. |
| 3 | After Save, lead to Share | Tidy and inbox: bill view plus a "Saved" sheet with Share. Guided: Review step. Classic unchanged. |
| 4 | Autocomplete first-query cost | Build the party index at start for the new layouts (idle callback after the directory loads; no change to what suggestions say). Applying it to classic too is invisible but touches classic start-up: [A], default new layouts only. |
| 5 | Stacked top banners | Status pill (section 5.6), new layouts only. |
| 6 | Bottom nav visible while editing | New layouts hide nav in the editor (tidy and guided editor; inbox has no nav). |
| 7 | Nav highlight on Home | Not a bug (section 3 row 7). No change. |
| 8 | WhatsApp cannot be targeted | Share opens the Android share sheet. The Review step says so in plain words. [CHECK] on the phone. |
| 9 | GST % quick-pick chips (5, 12, 18, 28) remembering the last choice | Optional, [A]: chips in the GST % field of the sheet / quick-add bar; the last choice is kept in a new setting `ui.lastGstPct` (string, default empty). Off unless the owner agrees; if not agreed, plain number field only. |
| 10 | No swipe gestures | Share and Delete stay visible buttons so anyone understands at a glance. [A]. |

## 7. Plain-word renames (new layouts only; classic unchanged unless the owner agrees)

| Today | New layouts | Where it comes from |
|---|---|---|
| "rev 3" | hidden in the overflow menu (tap "..." > "Version history info") | `BillView.tsx` |
| GST bill "Total" | "Before GST" | shared registry column `total`; phone display map by column key |
| "GST Amt" | "GST" | registry column `gstAmt` |
| "Amount" | "Line total" | registry column `amount` |
| "Total (typed)" | "Set price yourself" | `BillEditor.tsx` |
| "Last export" | "Last backup" | `SettingsStorage.tsx`, `Dashboard.tsx` |
| "Branch and sync" | "Connect to your PC" | `settingsPages.ts` |
| Supabase URL / anon key / license key | under an "Advanced" fold, closed by default | `SettingsSync.tsx` |
| "PO prefix" | "Bill number letters" | `SettingsSync.tsx` |

The map is keyed by column key (`total`, `gstAmt`, `amount`) and by screen string; it is NOT keyed by format name (rule 4.4). Non-GST bills keep "Total" (their `total` column is the only money column, so "Before GST" would be wrong): the map therefore applies "Before GST" only when the open format also has a `gstAmt` column (a column check, not a format-name check). Desktop headers, print, the registry and the Windows app never change.

## 8. [A] list (unconfirmed assumptions; the owner may flip any)

1. Classic is untouched by this milestone, including its truncation. **Opt-in for classic:** a separate setting `ui.wrapNames` (boolean, default false) that turns the wrap rule on inside classic only when the owner switches it on. Not built unless the owner says yes (Phase 195, last item).
2. Plain-word renames apply to the new layouts only; classic keeps its words.
3. The chooser lists only layouts that are built; the three new ones appear as their phases land.
4. `ui.layout` is a per-phone preference, not synced, included in the backup file.
5. Bill date picker (backdating) in new layouts. Extra finding 1.
6. Undo snackbar after removing a row. Extra finding 2.
7. "Saved" sheet after Save in tidy and inbox. Extra finding 3.
8. Party index pre-build at start, new layouts only. Extra finding 4.
9. GST % quick-pick chips and `ui.lastGstPct`. Extra finding 9.
10. No swipe gestures. Extra finding 10.
11. One status pill replaces stacked banners in the new layouts; the sheet lists everything.
12. Larger tokens (16 / 17–18 / 48 / 60 px) are proposals; the owner may flip them after seeing them on the phone.
13. Layout B's "Continue draft" uses the existing draft recovery (one draft per new bill); no multi-draft list.
14. Layout C: the floating "New bill" button and the Share / Edit floating buttons sit above the safe area and never cover the last row (the list gets bottom padding).
15. Version numbers: 0.1.32 ... 0.1.39 are placeholders (renumber if Phase 188 ships 0.2.0 first). The gate (196) bumps so the owner's phone can receive the build.

## 9. Test and regression plan

**Classic must be byte-for-byte the same behaviour.** Three locks, created in Phase 189 BEFORE any other change and run in EVERY later phase:
1. **Classic DOM parity test** `src/pwa/__tests__/classicParity.test.ts` (new): renders `App` with `layout = classic` on the fake IndexedDB fixture at Home, History, Bill view, Editor (new and edit), Customers, Settings (list and each sub page), the unsaved-bill prompt, and each banner state, and pins the HTML in a snapshot. The snapshot is never edited without the owner's approval. The ONE approved change is the new "Layout" section on the Themes page (Phase 189 updates that single snapshot and says so).
2. **Classic CSS lock** (same file): SHA-256 of `ui/ui.css`, `ui/tokens.css`, `ui/themes.css`, `styles/pwa.css`, pinned. A phase that needs to change one of them must stop and ask the owner. (Phase 187's `.q3-chip` fix was the last approved change; its hash is the starting value.)
3. **Existing tests keep passing**, unchanged: phone `shell.test.ts`, `ui.test.ts`, `history.test.ts`, `editor.test.ts`, `editor2.test.ts`, `shareUi.test.ts`, `customersSettings.test.ts`, `themes.test.ts`, `offlineUpdate.test.ts`, `hardening.test.ts`, and `src/__tests__/importBoundaries.test.ts`.

**New test files (one per area, small):** `layoutRegistry.test.ts` (ids, default, unknown value -> classic, chooser lists only built layouts), `layoutSwitch.test.ts` (switching never writes bills / parties / drafts / outbox: compare the stores before and after; unsaved guard holds the switch; route kept or Home), `kitDisplay.test.ts` (Indian money, never raw "12988.00", empty / odd input), `kitWrap.test.ts` (CSS scan: no ellipsis / nowrap on name classes; amounts never clipped; touch classes >= 48 px; every `.q3x-` button has a name), `statusModel.test.ts`, `snackbar.test.ts` (no identical stacking; Undo restores the row), `plainWords.test.ts` (map by column key, Non-GST keeps "Total", desktop registry labels untouched), then per layout: `tidyLayout.test.ts`, `guidedLayout.test.ts`, `inboxLayout.test.ts` (jsdom: key screens, long-name wrap, guard, Save -> Share path, read-only / "Edit on PC").

**Per-phase run list** is in `PHASES.md` (each entry names its files). Always `npm run typecheck` once and `src/__tests__/importBoundaries.test.ts` (no electron / main imports from phone code). Shared code (`src/shared/*`) is not edited in this milestone; if a phase finds it must be, it stops, writes the contract first, and runs the desktop files that could conflict (`billTotals` / calc, print model, format registry).

**Not provable here:** every look and feel on the real phone (see section 11), the Android keyboard, text selection in a growing textarea, the share sheet to WhatsApp, speed. Written as "needs the owner's phone", never "verified".

## 10. Risks

1. **Classic regression by accident** (a shared CSS rule, an edited shared component). Mitigated by the DOM parity test, the CSS hash lock, and "new files only".
2. **Two code paths in App.tsx** drift apart (a new guard added to one only). Mitigation: all guards live in App.tsx above the layout choice; layouts only draw.
3. **A growing name box and B / R+B selection** may behave differently from an `<input>` on Android ([CHECK]). The editor model's run logic stays the same; only the element changes. Fallback: keep the single-line `<input>` for the selection tools and show a wrapped read view when not focused.
4. **Layout C paper-table editing** is the riskiest view (tap a cell, docked keyboard toolbar, previous / next across a table). Built last; it reuses the existing Next / Done order (name -> qty -> rate -> next row) from `editorModel.ts`.
5. **Test run cost** with three new layouts: mitigated by small phases and named test files only.
6. **Bundle size / speed** with three layouts: layout code is loaded lazily with a dynamic import per layout (only the chosen one is fetched) [A]; classic stays in the main bundle, unchanged. The service worker caches the layout chunks like any other asset (cache name still comes from the version).
7. **Money display drift:** a screen formatting amounts itself. Mitigated: only `kit/display.ts` formats, and `kitDisplay.test.ts` scans the new layout folders for `toFixed` and for amounts rendered without `moneyText`.
8. **Owner confusion about "classic keeps words"**: the chooser blurbs say plainly that Classic is today's screen and the others are new.

## 11. [CHECK] list for the real phone (nobody has verified these)

Filled from the owner's report; see `docs/M18_DEVICE_CHECKLIST.md`.
- Each layout at 390 px and at a narrow 360 px phone: nothing clipped, nothing pushed sideways, names wrap, amounts never cut.
- Larger text and 48 px targets: comfortable with a thumb, no mis-taps; nav raised "New" button reachable.
- Growing name box while typing; B and R+B on a selection inside it; the keyboard stays open.
- Layout B quick-add bar sits ABOVE the Android keyboard (visual viewport) with the running total visible.
- Layout C docked toolbar above the keyboard; previous / next move across cells; Done closes the keyboard.
- Safe-area padding under the sticky bars and floating buttons on a phone with gesture navigation.
- Share image and PDF from each layout's Share button; "pick WhatsApp in the share list" is true on this phone.
- Switching layouts in Settings with real data: every bill, customer, draft and the sync line identical before and after.
- Status pill sheet shows read-only, offline, update, install and storage-cleared states correctly.
- Both a dark and the light theme in every layout.

## 12. Phases (summary; full entries in `PHASES.md`)

| # | Phase | Version |
|---|---|---|
| 189 | Contract, `ui.layout` setting, layout switch, Settings chooser, classic locks | 0.1.32 |
| 190 | Shared kit 1: larger tokens, money and plain-word helpers, item line, totals block, buttons, segmented control, wrap rule | 0.1.33 |
| 191 | Shared kit 2: bottom sheet, snackbar with Undo, status pill, share bar, "Saved" sheet, date field, party index pre-build | 0.1.34 |
| 192 | Layout A: Tidy tabs | 0.1.35 |
| 193 | Layout B: Guided flow | 0.1.36 |
| 194 | Layout C: Bills inbox | 0.1.37 |
| 195 | Plain words in Settings, Advanced fold, overflow menu, optional opt-ins ([A]) | 0.1.38 |
| 196 | Milestone 18 QA gate | 0.1.39 |

Order change from the brief: the cross-layout behaviours (status pill, snackbar, date field, Saved sheet, party pre-build) are built in the kit BEFORE the layouts, so each layout uses them once instead of each phase redoing them. Phase 188 (M17 gate) and Phase 69 may run before, between or after these; this milestone only needs Phase 187d (0.1.31) as its base.

## 13. Hard rules

See `CLAUDE_MUST_READ.md` section 10m. In short: classic untouched and locked by tests; new files only (no edits to `ui.css`, `tokens.css`, `themes.css`, `pwa.css`, `router.ts` exports, `editorModel.ts` behaviour, `src/shared/*`); same data, sync, share and calc code; no format-name branching; tokens only; Phosphor only, no emoji; names and amounts never ellipsised in the new layouts; Indian money through `kit/display.ts` only; the Phase 92 selector rule; real phone behaviour is never "verified" from the sandbox.
