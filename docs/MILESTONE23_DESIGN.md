# MILESTONE 23 — Price List, billing auto-rate, seat permissions, activity log, auto red-bold, case button (Phases 233–250)

Planned 2026-11-12 from the owner's request, by a planning session that read the 0.1.52 zip (Phase 231 done), the legacy `bills_data.db`, two legacy Python files and one legacy screenshot. Docs only; nothing built or run. Desktop and phone. This is the binding design for Phases 233-250; its hard rules are copied to `CLAUDE_MUST_READ.md` section 10r. Items marked **[A]** are assumptions the owner has not confirmed (list in section 11, also in `PHASE_STATUS.md` → "Awaiting from owner"). If anything here disagrees with the code in the zip, the zip wins: flag it in `PHASE_STATUS.md`, do not silently pick one.

## 1. What the owner asked for (verbatim, 2026-11-12; also in `docs/reference/REQUIREMENTS_ORIGINAL.md`)

- "THE DB IS FROM THE LEGACY APP ... NOW WE HAVE TO INTEGRATE THE ENTIRE FEATURE TO THE NEW QUOTE APPLICATION MORE CONVENIENT AND BETTER ... BOTH IN DESKTOP EXE AND PWA APP ... WE NEED TO IGNORE ALL THE OTHER TABLES LIKE BILLS TABLE ENTIRELY"
- "THOSE ITEMS AND CATEGORIES ARE NOT CONSISTENT ... WE SHOULD BE ABLE TO MAKE NEW CATEGORIES, NEW TABS ... AND ADD OR REMOVE ITEMS, MODIFY THEM EVERYTHING REALLY CONVENIENTLY AS THE TAB CELL MIGRATIONS AS CURRENTLY IN THE BILLS CREATION OR EDIT IN THE QUOTE APP"
- "IT SHOULD BE EXTREMELY FLEXIBLE AND CONFIGURABLE AND CONVENIENT AS THE QUOTE APP ITSELF IS"
- "INTEGRATE THIS TO THE BILLING/EDITING WINDOW OF THE BILLS ... FUZZY MATCH THE THINGS IN THE INVENTORY DB AND SUGGEST THE DEFAULT RATE DEPENDING ON THE GST OR NON GST FORMATS ... THE GST OR NON GST COLS AND THIS FEATURE ITSELF IS CONFIGURABLE AND TOGGLEABLE IN THE SETTINGS"
- "IT SHOULDN'T NEED ANY ADDITIONAL PROMPT TO ACCEPT THE RATE, IT SHOULD JUST AUTO ENTER THE RATE IN RATE COL IF THE CELL WAS LEFT EMPTY AND THE CELL MIGRATED TO OTHER CELL OR IT WAS NOT EDITED ... AND ALSO A TOGGLE THAT TURNS IT OFF, BUT ON'S THE SUGGESTION ONLY, LIKE A SMALL COMPACT LINE LIKE CALCULATOR FEATURE WHERE IT ONLY SHOWS THE STUFF AND NOT ENTERS ANYTHING"
- "ANY BRANCH AND MOBILE SHOULD BE ABLE TO ADD, OVERWRITE AND EDIT ... THE INVENTORY ITEMS WHEN THE PERMISSION IS ALLOTTED BY THE MAIN BRANCH (SEAT 1 IS ALWAYS THE MAIN BRANCH)"
- "A FEATURE (HIDDEN, ONLY THE MAIN BRANCH / SEAT 1 CAN SEE IT WHEN TOGGLED) THAT WE SHOULD BE ABLE TO SEE IF THE INVENTORY IS ADDED OR EDITED, THEN WHO DID IT"
- Unrelated feature 1: "A FEATURE TOGGLEABLE FROM SETTINGS, ON BY DEFAULT: 'BY HAND' IN THE ITEM NAME COLUMN BE RED BOLD AUTOMATICALLY WHEN A USER TYPES IT IN THE END, MIDDLE OR ANYWHERE IN THE ITEM"
- Unrelated feature 2: "INSIDE THE CREATE/EDIT WINDOW A BUTTON, WHEN PUSHED CAN MAKE THE ENTIRE BILL ROWS LIKE ITEM NAMES IN CAPITAL OR SMALL LETTER"


## 2. Scope of Milestone 23

1. **Price List** (new feature, desktop + phone): user-defined categories → tabs → rows, user-defined columns per tab, Excel-like editing with the SAME keyboard/cell behaviour as the bill grid. Import once from the legacy DB.
2. **Billing integration**: while typing an item in Create / Edit, fuzzy-match the Price List and put the right rate in the Rate cell. Three modes: Off / Suggest only (compact strip, writes nothing) / Auto-fill (default [A]).
3. **Seat permissions** for editing the Price List (seat 1 = main grants others). Phone included (a phone is a seat).
4. **Activity log** of Price List changes, who did it, visible ONLY to seat 1 when toggled on.
5. **Auto red-bold phrases** ("by hand") in item names (independent of the Price List).
6. **Case button** in Create / Edit: item names to UPPER / lower (independent).
7. **Parked, NOT in M23**: Tally ODBC (`tally_inventory_frame.py`, Windows-only stock reader; MASTERPLAN keeps Tally out of scope), customer tier on parties (needs a party field + sync; see 4.6), live formulas in cells (rule: typed formulas out of scope).

Naming: the feature is called **"Price List"** in the UI [A]. The existing **Items** page (sales sorter built from bills, `src/shared/items/*`) is a different thing; do not reuse its names.


## 3. The legacy source (facts, verified by reading the files)

### 3.1 `bills_data.db` (SQLite, private business data)
- Tables: `bills` (290 rows, **IGNORE ENTIRELY**), `inv_categories` (14), `inv_tabs` (22), `inv_items` (346), `inv_last_state` (1 row, UI memory, ignore), `sqlite_sequence`.
- `inv_categories(id, name UNIQUE, icon, position)`: `position` is 0 for ALL rows; id 13 is missing (deleted). Icons are emoji and meaningless (random per category) → drop (Quot3 forbids emoji).
- `inv_tabs(id, category_id, name, position)`: 1-3 tabs per category; `UNIQUE(category_id, name)`; `position` starts at 1 per category. Order by `(category_id, position)`.
- `inv_items(id, tab_id, row_index, sl_no, item_name, rate, rate_without_gst, unit_qty, qty, qty_with_gst)`; all price fields are TEXT.
  - `sl_no` is derived (ignore). `row_index` has one gap in one tab (compact on import).
  - Of 346 items: 182 have a value in `rate`, 164 are **name only** (no price at all, 47%).
  - Every non-empty price value is a plain number (0 non-numeric found). `qty_with_gst` is empty in all 346 rows.
  - 57 names contain a line break, 106 have leading/trailing whitespace → clean on import (trim, line breaks → one space, collapse spaces).
  - No exact duplicate names; no row has data but no name.
- `inv_items` has `unit_qty`, and categories have `position`, which `inventory_manager_2.py` does NOT have: that script is OLDER than the DB. Use the DB + screenshot as truth, not the script.

### 3.2 Column mapping (confirmed by comparing row 1 of the DB with the screenshot: 110 / 109 / 108 / 110 / empty)
| DB column | Legacy header (screenshot) | Proposed tier key |
|---|---|---|
| `rate` | cash w/o | `cash_wo` |
| `rate_without_gst` | wholesale w/o | `wholesale_wo` |
| `unit_qty` | cash+GST | `cash_gst` |
| `qty` | credit gst | `credit_gst` |
| `qty_with_gst` | Unit/Qty | (plain column, role `unit`, empty everywhere) |

The DB column names are misleading; the screenshot headers are the truth. The legacy "Columns" button renames headers, but the labels are NOT stored in the DB (no settings table): ask the owner if a JSON/config file sits next to `bills_data.db`; otherwise use the screenshot names.

**OPEN, MUST BE CONFIRMED by the owner [A]:** in the data, `cash+GST` (e.g. 108) is LOWER than `cash w/o` (110). Quot3's GST format ADDS GST on top of the typed rate (`gstAmt = total x gstRate / 100`, `amount = total + gstAmt`; see `shared/calc/rowCalc.ts`). So the "cash+GST" price is assumed to be **the rate to type on a GST bill, before Quot3 adds GST**. If it is actually GST-inclusive, auto-fill would charge GST twice. Default mapping (settings, editable): Non-GST bill → `cash_wo`; GST bill → `cash_gst`.

### 3.3 Legacy screenshot (not in the zip; the owner is to save it as `docs/reference/legacy_app/legacy_pricelist_screen.png`)
- Dark UI. Left icon rail (categories, summary, alerts, search, notes, share/DB, collapse). Left panel = Share/Database (copy DB path, export, import).
- Tab strip with a red × on each tab and a "+ Tab" button. Buttons: **Columns**, **CSV**, hint "Ctrl+S to save". Filter box above the table.
- Table columns: `NO` (row number), `Item Name` (wide, bold, monospace), `cash w/o`, `wholesale w/o`, `cash+GST`, `credit gst`, `Unit/Qty`. Right-aligned bold numbers. Item names are upper-case, format "BRAND CODE SIZE-NAME (width CMS)".
- Quot3 does NOT copy this look (neumorphic navy/red theme, tokens, Phosphor icons, no emoji) but keeps its structure and features.

### 3.4 `inventory_manager_2.py` features worth porting
Categories with icon, tabs per category (add / double-click rename / delete with ×), editable table with autosave, Up/Down/Enter/Tab/Left/Right cell navigation, context menu (insert above / below, clear, delete row), filter current tab, CSV export, quick search across all items with fuzzy score and jump-to-row, duplicate warning across tabs, summary panel, last category/tab restore, export / import / swap the DB file. **Do not port:** DB-file swap and "copy path" (replaced by Quot3 backup + sync), the plain `SequenceMatcher` fuzzy (it would match "505" with "D7"; use the Quot3 matcher with protected tokens).

### 3.5 `tally_inventory_frame.py`
Tally ODBC stock reader (StockItem opening/closing balance and value, pyodbc, Windows-only). **Out of scope** (parking lot). If revived later: separate milestone, desktop only, not in Electron via pyodbc, read-only snapshot.


## 4. Feature specifications

### 4.1 Price List data model (flexible, nothing fixed)
- Hierarchy: **category → tab → rows**. Categories, tabs, columns and rows are all user-made, renamed, reordered, moved, duplicated, deleted (soft delete → Trash, restore, undo). Two levels kept [A] (owner has not asked for deeper).
- **Columns belong to a tab** (like extra columns belong to a bill, `shared/extraCols.ts`): `{ key, label, type: 'text'|'number'|'choice', role: 'name'|'price'|'unit'|'note'|'other', tier?: string, widthPx, align, hidden, frozen, choices? }`. Max 12 columns per tab [A]. First column is always the item name (rich text runs: bold / red / highlight, same engine as bills).
- **Tiers** (the key idea that makes inconsistent tabs work): an organisation-wide list of named price tiers (seed: `cash_wo "cash w/o"`, `wholesale_wo "wholesale w/o"`, `cash_gst "cash+GST"`, `credit_gst "credit gst"`, user can add more). A column with `role: 'price'` points at a tier by key. Billing asks for a TIER, never for a column name, so tabs may have different columns and still work; a tab without that tier is simply not used for that fill.
- **Rows:** `kind: 'item' | 'section'` (a section row is a divider like "BIG PANNA", no prices), `nameRuns`, `cells: { [columnKey]: string }`. All money-like values are canonical decimal strings (`shared/money.ts`); never JS numbers.
- Column "templates": save a column set, apply to new tabs / a whole category, copy columns from another tab, default column set for new tabs (setting).
- Rows with no price are allowed and shown with a quiet "no price" cue and a filter.

### 4.2 Price List page (desktop)
- New route `/pricelist` (add to `ROUTES`, `PREVIOUS_PAGES` and the Phase 218-220 page-memory rules; `routes.test.ts` updated with the change quoted), nav item, command-palette entries, a Dashboard tile like `games` (stored `dash.tiles` without the key reads as default), a Settings section "Price List" (the Settings page test currently expects 17 sections; update it to 18 and say so).
- Layout: category side panel (collapsible) + tab strip (with × and "+ Tab") + toolbar (filter, Columns, CSV, share) + the grid + status bar. Compact: at least 20 rows visible at 1366x768 (rule 5.2). Tokens only, Phosphor only, no emoji.
- **Editing = the bill grid's behaviour, reusing the same engine** (`shared/nav/cellNav.ts`, `gridEdit.ts`, `gridModel.ts`, `tsv/gridClip.ts` for Excel paste/copy, `rows/moveRows.ts` / `deleteRows.ts`, `history/undoStack.ts`, `columnWidths.ts`; read `docs/reference/KEYBOARD_CELL_RULES.md` first). Tab/Shift+Tab (wrap, Tab past the last cell of the last row makes a fresh row), Enter/Shift+Enter, arrows, F2, Esc, Ctrl+Home/End, Ctrl+Up/Down, Shift+arrows range, Ctrl+C/X/V, Ctrl+Z/Y, Ctrl+B / Ctrl+Shift+R (item-name cells), fill down / fill right.
- Autosave (debounced, off the keystroke path); no Save button.
- Operations: insert row above/below, delete, move up/down, move/copy to another tab, sort by column, filters ("no price", "contains"), search across all tabs with jump-to-cell, duplicate warning while typing (safe matcher), find & replace, name clean-up (trim / line breaks), bulk adjust (+%, +amount on a column / selection / tab / category, with preview and undo), "fill column from another column by %" (a ONE-TIME bulk action, not a live formula), CSV export, share as image/PDF through the existing pipeline.
- Every action is registered in `shared/shortcuts.ts` and the palette; actions without a key go on the palette-only list (the `keyboardAcceptance` test already complains about keyless actions with no handler, e.g. `ai.billingPanel.toggle`, `hybrid.recopy`: do not add more of those).
- The frozen section-8 shortcut map is not changed. Candidate keys (e.g. Alt+P page) must pass the shortcuts conflict test [A].

### 4.3 Billing integration (Create / Edit, desktop and phone)
Setting `pricelist.billing.mode`: `'off' | 'suggest' | 'auto'` (default `'auto'` [A]).

**Auto-fill (default):**
- Trigger: the cursor LEAVES an item-name cell (Tab, Enter, arrows, click elsewhere). Never on keystrokes (performance rule 5.6). Never while the Create page is loading a saved bill: opening a saved bill never fills anything.
- Fills the **Rate** cell of that row, with no prompt, ONLY if: the rate cell is empty AND the rate was never edited by hand in this session for that row; a confident single match exists; the matched row has a value for the tier mapped to this bill's format; the format has a rate column.
- "Never edited by hand": track per row `{ rateTouched, autoFilledValue, autoFilledForNameKey }` in UI state (not stored in the bill). Any typing in the Rate cell sets `rateTouched` (even if the owner later clears it: not refilled).
- Re-fill: if the Rate cell still holds exactly `autoFilledValue` (untouched) and the owner changes the item name so the match changes, replace it with the new match's rate; if no confident match now, leave it.
- Confident = best score >= T1 and margin over the second >= M and all protected tokens (numbers, sizes, units) equal (`shared/items/normalise`, `shared/units/parseUnits`); thresholds conservative [A] and tuned with invented names. Ambiguous or no match → nothing filled; the strip shows the candidates.
- One fill = ONE undo step of its own (Ctrl+Z removes only the rate). Written through the normal grid edit command and `cleanDec`.
- Optional subtle marker on auto-filled rate cells (setting, on by default [A]).
- Fill uses the bill's FORMAT → TIER mapping (setting, section 4.3 below). Hybrid: each side uses its own format's mapping (read `shared/hybrid/*` before deciding). Stock transfer has no money columns: no fill. **Never branch on a format name in code** (rule 4.4): the mapping is data keyed by format id from the registry; a format without an entry or without a `rate` column does nothing.

**Suggest only:** a compact one-line strip (like the calculator drawer / the M22 AI strip) near the grid: matched item + ALL its tiers (e.g. "ACME 1001 SMALL PANNA (90 CMS) · cash w/o 110 · wholesale 109 · cash+GST 108 · credit 110"), the tier for the current format highlighted. It never takes focus, never moves the grid cursor, never writes anything. Toggle key / toolbar switch like the AI strip (`ai.billingPanel.toggle` was Alt+H; pick another free key [A]).

**In Auto mode** the same strip shows what was filled and from which tier/tab.

**Settings (all toggleable), section "Price List":**
- `pricelist.enabled` master (off hides the page, nav, shortcut, palette entry, tile and stops billing use) — default true [A].
- `pricelist.billing.mode` off / suggest / auto — default auto [A].
- `pricelist.billing.formatTier`: `Record<formatId, tierKey | null>` — defaults `non_gst: cash_wo`, `gst: cash_gst` [A]; new formats appear in the UI automatically from the registry.
- `pricelist.billing.strictness` strict / normal / loose — default normal.
- `pricelist.billing.maxSuggestions` — default 5.
- `pricelist.billing.markAutoFilled` — default true.
- `pricelist.billing.fillName` — default false (auto mode leaves the typed name alone).
- `pricelist.billing.excludedTabs`: ids of tabs/categories not searched.
- NOT in M23 [A]: "customer tier decides the column" (needs a field on parties + sync; ask the owner, see 11).

Matching = deterministic, pure, in `shared/pricelist/*`, reusing `shared/items/{normalise,search}`; works with AI off; **no AI model is involved**. It is not covered by 10q's "AI never fills a cell" (that is about the AI); 10r records that the owner explicitly wants this deterministic auto-fill.

### 4.4 Permissions (seat 1 = main branch)
- Reality check: today `SYNC_SHARED_STORE_SPEC.md` says "All branches are equal. No Main/Branch role" (decision 4, line 131) and `CLAUDE_MUST_READ` 10g repeats it. The owner now asks for ONE scoped exception: **seat 1 grants Price List edit rights to other seats.** Write it as an explicit exception in 10r and the sync spec; bills, customers and everything else stay equal.
- Seats already exist: `sn_members(user_id, org_id, seat_no 1..50, branch_id)`; a phone logs in with a seat like a PC. Seat 1 always has full rights and cannot lose them.
- Permission flags per seat [A names]: `add` (new rows), `edit` (item names, notes, fill empty cells), `overwrite` (change a non-empty price/value cell), `delete` (rows, tabs, categories), `structure` (create/rename/reorder categories, tabs, columns, tiers). Default for every seat except 1: view + search + billing suggestions only.
- **Enforced on the server**, not just hidden in the UI: the existing push RPC for price kinds checks `auth.uid() -> sn_members.seat_no` and the seat's flags (server can diff old vs new payload to tell add / edit / overwrite / delete / structure). A refused write returns a new error code (e.g. `Q3P01 not_allowed`, plain words in the app), the change goes to the existing "aside" handling (never silently lost).
- Revoked while a seat was offline: its pending price edits are set aside for seat 1 to review (reuse the aside mechanism).
- RPCs: `qt_price_perms_get()` (any seat: own flags), `qt_price_perms_list()` + `qt_price_perms_set(seat_no, flags)` (seat 1 only). UI: Settings > Price List > "Who can edit" (seat 1 only).
- **If shared sync is NOT active** (single PC) there are no seats: this PC has full rights.
- Conflicts: latest `edited_at` wins, loser kept in server history (same as bills).
- Check before writing the contract: does `license:status` / shared sync state already expose `seat_no`? If not, add it as a masked, non-secret field.

### 4.5 Activity log (seat 1 only, toggle)
- Records every Price List change: add / edit / overwrite / delete / restore / import / bulk adjust / structure change / permission change, with **who** (seat number + branch name + device kind PC/phone), **when**, **where** (category › tab › item), and old → new values for edited cells. One entry per saved edit batch (never per keystroke). Legacy import = one entry.
- Authorship must be unforgeable: written **inside the push RPC** into `sn_price_log` (author from `auth.uid()` / `sn_members`, not from the client payload). RLS: no direct reads; read only via RPC `qt_price_log_list(...)` that checks `seat_no = 1`.
- Visibility: Settings > Price List > "Activity" appears ONLY on seat 1 and only when `pricelist.log.visible` is on. Other seats do not see the section, and the server returns nothing to them.
- Recording always runs (so history exists when seat 1 turns the view on later) [A]; retention `pricelist.log.retentionDays` default 365 [A]; CSV export [A].
- Local PC with no sync: a local `price_log` table (reuse the existing audit infra `auditRepo` / `audit_log` conventions) and that PC counts as main [A].
- Phone viewing of the log: desktop only in M23 [A].

### 4.6 Auto red-bold phrases ("by hand") — independent, no schema
- Setting `bill.autoRedBold.enabled` default **true**; `bill.autoRedBold.phrases` default `['by hand']` (editable list) [A]; `bill.autoRedBold.when`: `'word'` (apply as soon as the phrase is complete and followed by a space/punctuation, and always when leaving the cell) or `'leave'` — default `'word'` [A].
- Matches case-insensitively, whole words only ("BY HANDLE" does not match), runs of spaces count as one, anywhere in the name (start, middle, end), on typing AND pasting.
- Implementation: pure function over `shared/richtext/runs.ts` (`setRedBold`, `applyTextChange`): after a text change find matches and apply red+bold to exactly that character range; idempotent; does not re-apply on unrelated edits, so a manual "Clear formatting" on that range sticks; no removal logic. The run data is already saved, printed, copied as image and synced, and shows on the phone: **no schema, sync, print or backup change**.
- One undo step together with the typing that triggered it.
- Saved bills are never rewritten on open; only typing/pasting triggers it.
- Applies to the bill editors on desktop and phone (shared code). Phone: new layouts first; Classic needs the owner's OK (see 4.9).

### 4.7 Case button — independent, no schema
- A button in the Create / Edit window (toolbar), plus shortcut + palette entry: item names UPPER ↔ lower (cycle) [A; Title Case optional].
- Scope: the item-name column of ALL rows by default; selected rows when a range is selected [A]; other columns (quantities, rates, extra columns) are never touched.
- Preserves per-character bold / red / highlight runs (transform each run's text; handle length-changing Unicode cases like "ß" safely).
- One undo step; in History edit it is a normal edit and creates a revision. Hybrid second table rows included [A].

### 4.8 Settings key summary
`pricelist.enabled`, `pricelist.billing.{mode,formatTier,strictness,maxSuggestions,markAutoFilled,fillName,excludedTabs}`, `pricelist.log.{visible,retentionDays}`, `pricelist.defaultColumns`, `bill.autoRedBold.{enabled,phrases,when}`. Defaults + zod schema + existing settings tests updated (small, additive). Phone settings mirror the relevant ones in `src/pwa/data/settingsRepo.ts`.

### 4.9 Phone / PWA
- Phone has its own IndexedDB `quot3-phone` (`DB_VERSION` 1): add new stores by a NEW upgrade step (never edit a shipped step): `price_categories`, `price_tabs`, `price_rows`, `price_tiers`; add them to backup `STORE_NAMES` and the sync stores.
- Phone UI: search + view, edit a cell, add an item, add/rename tabs and categories, all subject to the seat's flags. Column design, bulk tools and Excel paste stay desktop-only [A]. Reached from the Dashboard (the bottom nav has exactly 5 fixed tabs: do not add a sixth).
- **Classic phone layout is FROZEN** (M18): `classicParity.test.ts` pins `ui.css`, `tokens.css`, `themes.css`, `pwa.css` and a DOM snapshot. New phone screens and the three bill features go in the NEW layouts (`tidy`, `guided`, `inbox`) via new files (`src/pwa/ui/layouts/*`, `src/pwa/ui/kit/*`). Touching Classic needs the owner's explicit approval (open item).
- Phone has "no AI / no print / no clipboard image"; the Price List matching is deterministic, not AI: say so in 10r.
- The phone is a seat: its permissions come from the same seat flags. Phone sync follows `docs/SYNC_SHARED_STORE_SPEC.md` (latest wins, loser kept, aside rule, no `service_role`).


## 5. Hard rules (binding for Phases 233-250; copied to `CLAUDE_MUST_READ.md` 10r)

Read `docs/MILESTONE23_DESIGN.md` (then `docs/PRICELIST_IMPORT_SPEC.md`) before any Phase 233-250. Everything in 10q still holds. Phase 188 and Phase 69 are separate and still run.
- The Price List supersedes the "no item catalogue / price list" line in MASTERPLAN. Bills stay free text: the Price List is optional and billing works exactly as before when it is off or empty.
- Rows are data: columns, tiers, categories and tabs are user data; billing asks for a TIER by key and the format → tier mapping is a setting keyed by registry format id. Never branch on a format name (rule 4.4).
- Money is decimal strings only (rule 4.3). A fill goes through the normal grid edit command, one undo step, only on leaving an item cell, never on keystrokes, never when opening a saved bill, never over a rate the owner typed.
- Matching is deterministic and uses protected tokens (10e/10q); **no AI model** is used for the Price List.
- **Scoped exception to "all branches are equal" (10g): seat 1 is the main branch for the Price List ONLY** (grants edit rights to other seats; sole reader of the Price List activity log). Enforced on the server by RPC; bills, customers and all other data stay equal. Seat 1 cannot lose its rights. No Price List permission applies when shared sync is off.
- Activity log authorship is written server-side inside the push RPC, never taken from the client; only seat 1 can read it.
- Auto red-bold and the case button change run data / text only (no schema, no sync or print change) and are one undo step each.
- Legacy import reads ONLY the `inv_*` tables, never `bills`; the legacy DB is private business data (never commit, log or embed; tests use invented names); Phase 237 needs the owner to attach `bills_data.db`.
- One additive desktop migration `0011_price_list.sql` (release notes line becomes `schema: 12`); one new numbered Supabase file `18_price_list.sql` (never edit one that was run); the phone gets a new IndexedDB upgrade step.
- Classic phone layout and its pinned files are not touched without the owner's approval.
- Never run anything against a real Supabase; "works on Supabase", the real phone, real Windows behaviour, grid smoothness with the strip on, are never "verified" from the sandbox: Standing gaps (`docs/M23_OWNER_CHECKLIST.md`, written in Phase 249).
- **TESTING RULE (owner's standing rule): DO NOT RUN THE FULL TEST SUITE.** `npm run typecheck` once plus ONLY the named test files; no build, no dev server. Known pre-existing failures (compare against the previous zip before calling anything a regression): `keyboardAcceptance.test.ts` (2), `settingsPage.test.ts` (6), one `historyPage.test.ts` case, `indexer.test.ts` fixtures (see the Phase 230/231 logs).
- Items marked [A] are unconfirmed (`MILESTONE23_DESIGN.md` section 11); say so in every phase log.


## 6. Architecture facts the plan rests on (verified in the zip, 0.1.52)

- Desktop: Electron, renderer never touches DB/Node; `src/main/db/*` (better-sqlite3 + Drizzle), `src/main/services/*`, `src/main/ipc/*` (zod-validated), `src/shared/*` pure. Migrations `0000`…`0010` (11 files) → next is `0011`; release notes `schema: N` = number of migrations → 12.
- Sync v2 = shared Supabase notebook: `sn_records(org_id, kind, rec_id, version, payload jsonb, schema_ver, min_reader_ver, edited_at, from_branch…)`; **`kind` is a CHECK-constrained list `('bill','party','party_merge','item_rule')`** in `12_records.sql` (two places: `sn_records`, `sn_history`) and a hard-coded list inside `15_rpcs.sql` (lines ~260 and ~358). New kinds therefore need a NEW numbered file (`18_price_list.sql`) that drops/re-adds those constraints and replaces the RPC functions (functions with changed argument lists need `drop function` first). Existing patterns to copy: `item_rule` end-to-end (`shared/sync/itemRule.ts`, `main/sync/itemRuleApplier.ts`, `recordApplierV2.ts`, `pushWorkerV2.ts`, `pullWorkerV2.ts`, `pwa/sync/{encode,outbox,applier,firstSync,supabaseTransport}.ts`, `src/__tests__/supabaseSql.test.ts`) and `17_themes.sql` (a separate table + RPCs).
- Readers older than a record's `min_reader_ver` set it aside ("Update the app to see N records"), never strip/overwrite.
- Bill rows: `bill_rows(id, bill_id, idx, name_runs_json, name_plain, qty, rate, total_override, gst_rate, extras_json, cell_style_json)`; `rate` is a decimal string. Item names are rich-text runs `{b, r, hl}` (`shared/richtext/{runs,format}.ts`, `setRedBold`, `applyTextChange`).
- Formats: `shared/format/{gst,nonGst,stockTransfer,registry}.ts`. GST format columns: slNo, name, qty, rate, total, gstRate, gstAmt, amount (GST added on top). Non-GST: slNo, name, qty, rate, total. Stock transfer: free-text qty, no money. Hybrid: second row set (`shared/hybrid/*`).
- Items sorter (`shared/items/*`): `normalise`, `search`, `grouping`, `sales`; protected tokens in `shared/units/parseUnits.ts`.
- Extra columns: `shared/extraCols.ts` (cap 12, header ≤ 40 chars, `cN` keys). Keyboard rules: `docs/reference/KEYBOARD_CELL_RULES.md` (sections 1-16).
- Dashboard tiles: `DASH_TILE_KEYS` in `shared/dashboard/live.ts` (includes `games`); Settings keys in `shared/settings.ts`; Settings page currently has 17 sections.
- Phone: `src/pwa/*`, IndexedDB `quot3-phone` v1 (`data/db.ts`), bottom nav = 5 fixed tabs (`router.ts`), layouts classic/tidy/guided/inbox, `classicParity.test.ts` pins Classic.
- Backup (desktop): SQLite online backup of the whole DB (price tables included automatically; decide whether the AI-vector style "emptied copy" is needed: no). "Start fresh" (`shared/wipe/wipeRules.ts`): Level 1 clears bills + customers + drafts + revisions + import history + sync queue and keeps settings: decide whether the Price List is cleared by Level 1 [A: NOT cleared by Level 1; cleared by Level 2 factory reset only; add a separate "Clear Price List" in its own Settings section with a typed confirmation].


## 7. Proposed contracts (go into `API_CONTRACTS.md` first, then build to match)

### 7.1 Desktop tables (migration `0011_price_list.sql`, all additive)
- `price_tiers(id text pk, key text unique, label text, position int, created_at, updated_at, deleted_at, branch_id)`
- `price_categories(id text pk, name text, color text null, position int, created_at, updated_at, deleted_at, branch_id, updated_by_seat int null)`
- `price_tabs(id text pk, category_id text, name text, position int, columns_json text, created_at, updated_at, deleted_at, branch_id, updated_by_seat int null)` (unique active `(category_id, name)` case/space-insensitive)
- `price_rows(id text pk, tab_id text, idx int, kind text 'item'|'section', name_runs_json text, name_plain text, name_norm text, cells_json text, created_at, updated_at, deleted_at, branch_id, updated_by_seat int null)` + index `(tab_id, idx)`, `(name_norm)`
- `price_log(id integer pk autoincrement, at text, seat_no int null, branch_id text, entity text, entity_id text, op text, path text, before_json text, after_json text)`
- `price_import_map(legacy_key text pk, row_id text, source_fingerprint text, imported_at text, edited_since_import int)` (re-run support)
- IDs are UUIDs (like `item_rules`); legacy integer ids are never kept.

### 7.2 Sync kinds (needs `18_price_list.sql` + app code)
`price_tier`, `price_category`, `price_tab`, `price_row` (one record per row [A], plus the tab record carries the column list). Soft deletes are tombstones. `schema_ver`/`min_reader_ver` set so old apps set them aside. Payloads ≤ 1 MB (cap already in the table).

### 7.3 Supabase `18_price_list.sql` (PLANNED, NEVER RUN from the sandbox)
- Extend kind CHECKs on `sn_records` and `sn_history`; replace the push/pull RPC kind lists.
- `sn_price_perms(org_id, seat_no, flags jsonb, updated_at, updated_by)`; seat 1 implicit full rights.
- `sn_price_log(id bigserial, org_id, at, seat_no, branch_id, branch_name, kind, rec_id, op, path, before jsonb, after jsonb)`; no direct grants (RLS on, revoke all).
- RPCs: `qt_price_perms_get`, `qt_price_perms_list` (seat 1), `qt_price_perms_set` (seat 1), `qt_price_log_list` (seat 1), and the permission check + log insert inside the existing push RPC for the four price kinds. New error codes `Q3P01 not_allowed`, `Q3P02 seat1_only`.
- Static SQL tests in `src/__tests__/supabaseSql.test.ts`; add checklist G to `docs/SUPABASE_MIGRATIONS.md`.

### 7.4 IPC channels (zod, main process; names are proposals)
`pricelist:tree` (categories, tabs, tiers), `pricelist:rows(tabId)`, `pricelist:saveRows`, `pricelist:structure` (create/rename/move/reorder/delete/restore), `pricelist:columns`, `pricelist:bulk`, `pricelist:search`, `pricelist:importPreview`, `pricelist:importRun`, `pricelist:exportCsv`, `pricelist:perms`, `pricelist:log`, `pricelist:trash`. Preload typing under `window.quot3.pricelist.*`. The renderer imports nothing from main.

### 7.5 Shared pure modules (`src/shared/pricelist/*`, no DOM, no Node)
`types.ts`, `columns.ts` (sanitise, add/rename/remove, max 12), `tiers.ts`, `structure.ts` (move/reorder/duplicate), `rows.ts`, `bulk.ts` (adjust %, fill-from-column, clean names, find/replace; decimal.js only), `match.ts` (normalise + protected tokens + score + confidence + margin), `autofill.ts` (the row-state machine of 4.3), `perms.ts` (flags, diff → required flag), `logEntry.ts`, `csv.ts`, plus `shared/richtext/autoRedBold.ts` and `shared/richtext/caseTransform.ts`. All unit tested.

### 7.6 Planned files (for `PROJECT_STRUCTURE.md`)
`src/shared/pricelist/*`, `src/main/db/priceListRepo.ts` (+ `priceLogRepo.ts`), `src/main/services/priceListService.ts`, `src/main/services/priceListImportService.ts`, `src/main/ipc/pricelist.ts`, `src/main/sync/priceListApplier.ts`, `src/renderer/pages/PriceList.tsx`, `src/renderer/components/pricelist/*`, `src/renderer/stores/priceListStore.ts`, `src/renderer/components/create/PriceStrip.tsx`, `src/renderer/stores/priceStripStore.ts`, `src/renderer/components/settings/PriceListSection.tsx`, `src/pwa/data/priceListRepo.ts`, `src/pwa/ui/layouts/*` additions, `supabase/sql/18_price_list.sql`, `docs/MILESTONE23_DESIGN.md`, `docs/PRICELIST_IMPORT_SPEC.md`, `docs/M23_OWNER_CHECKLIST.md`.


## 8. Legacy import spec (full text in `docs/PRICELIST_IMPORT_SPEC.md`)

- Entry: Settings > Price List > "Import from legacy database" (desktop). The owner picks `bills_data.db`; it is opened **read-only**; only `inv_categories`, `inv_tabs`, `inv_items` are read; `bills` and `inv_last_state` are never read. The phone gets the data through sync (no import on phone).
- Step 1 **Preview** (writes nothing): counts (categories, tabs, items), items with no price, names cleaned (line breaks / spaces), skipped rows, tabs with a row-index gap, the proposed columns per tab, a re-run summary (new / unchanged / changed).
- Step 2 **Import**: first a `pre-import` backup (same mechanism as the legacy bill import), then ONE transaction; one entry in the activity log; goes through the normal write path so the sync outbox is fed (no second sync path).
- Mapping: categories ordered by `id` (all `position` = 0), tabs by `(category_id, position)`, rows by `row_index` (compacted); icons dropped; each tab gets columns: Item Name + the four price columns with tiers `cash_wo`, `wholesale_wo`, `cash_gst`, `credit_gst` (labels from the screenshot, editable) + `Unit/Qty` (role `unit`, hidden when empty everywhere) [A: legacy parity; the owner can drop columns afterwards].
- Cleaning: trim, line breaks → single space, collapse repeated spaces, never change letters or numbers; empty-name rows skipped (none exist today).
- Re-run safe: key = normalised (category, tab, item name) → `price_import_map`; re-run updates only rows NOT edited in Quot3 since import (edited ones are reported, never overwritten); nothing is deleted automatically; every automatic change is undoable.
- Today's data (for the preview test fixture, use INVENTED names only): 14 categories, 22 tabs, 346 items, 182 with prices, 164 name-only, 57 names with line breaks, 106 with edge whitespace, 0 duplicates.
- Question for the owner: is the legacy app still being edited (then "re-import" must work) or is this one-time [A: one-time + re-run allowed].


## 9. Phases (full entries in `PHASES.md`)

**MILESTONE 23 — Price List, billing auto-rate, seat permissions, activity log, auto red-bold, case button (Phases 233–250).**
*Exit criteria:* the owner can build a Price List of any shape (categories, tabs, per-tab columns, rows) and edit it with the bill grid's own keyboard feel, on desktop and phone; legacy data imports from `bills_data.db` (inventory tables only); in Create/Edit the rate fills itself on leaving an item cell (or shows only a compact strip, or is off), per format tier, never over a typed rate; seat 1 grants other seats Price List rights, enforced on the server; seat 1 alone can view who changed what; "by hand" turns red + bold by itself (toggle); a button turns item names UPPER/lower; with everything off the app behaves exactly as 0.1.52. Desktop and phone. Phase 188 and Phase 69 remain separate.

**Standing rules for every Phase 233-250:** section 10r; edits to shared files small, additive, tests updated not deleted; contract first in `API_CONTRACTS.md`; no full test suite; list what you ran and did NOT run; [A] items stated; Phase 92 selector rule; tokens only; Phosphor only; no emoji; money decimal strings; real Windows / Android / Supabase never "verified".

| # | Title | Version |
|---|---|---|
| 233 | Auto red-bold phrases ("by hand") | release 0.1.53 [A] |
| 234 | Case button (UPPER / lower) | release 0.1.54 [A] |
| 235 | Price List foundations: contract, settings keys, shared pure core | no bump |
| 236 | Desktop storage: migration 0011, repo, service, IPC, trash, backup/wipe rules, local log | no bump |
| 237 | Legacy importer + preview (Settings) | no bump |
| 238 | Desktop Price List page: grid, tabs, categories, columns dialog, shortcuts, palette, nav, tile, Settings section | no bump |
| 239 | Bulk tools, search, export/share | no bump |
| 240 | Billing integration: strip, auto-fill, modes, settings | no bump |
| 241 | Supabase `18_price_list.sql` + desktop sync of the four kinds | no bump |
| 242 | Seat permissions (server check, seat-1 UI, enforcement, aside) | no bump |
| 243 | Activity log (seat 1 only) | no bump |
| 244 | Phone data layer: IndexedDB step, sync, backup | no bump |
| 245 | Phone Price List: browse + search (read-only) in the three new layouts, Dashboard entry, phone settings mirrors | no bump |
| 246 | Phone Price List: editing (cell edit, add item, add / rename tab and category) subject to the seat's flags | no bump |
| 247 | Phone bill features: "by hand" (233), case button (234), price strip + auto-fill (240) in the new layouts' bill editor | no bump |
| 248 | Phone sync UX and hardening: Price List in first sync / status, offline revoke, storage and backup notes, three-layout parity sweep | no bump |
| 249 | Milestone 23 QA gate (release gate) | 0.1.55 [A] |
| 250 | Fix pack from the owner's report (only if needed) | no bump |


Content per phase:


- **233** In scope: `shared/richtext/autoRedBold.ts` (pure, tests: start/middle/end, case, whole word, multiple spaces, paste, idempotent, manual clear sticks, `when` modes), settings `bill.autoRedBold.*`, wiring into the item-name cell edit path as ONE undo step, Settings > Behaviour controls (editable phrase list), bill editor wiring for the phone shared function is Phase 247. Out: Price List. Verify: typecheck once; the new test, `richtext` tests, settings default/schema tests, `gridEdit`/`undo` tests that could conflict, `shortcuts`/`importBoundaries`.
- **234** In scope: `shared/richtext/caseTransform.ts` (run-preserving, Unicode-safe, tests), button in the Create/Edit toolbar, action + shortcut + palette entry (conflict test), scope all/selected rows, hybrid second table [A], one undo step, History edit creates a revision. Verify: typecheck; new test, `shortcuts`, `hybrid` and bill-edit tests touched.
- **235** In scope: 4.1 types, tiers, columns, rows, structure, bulk, match, autofill state machine, perms diff, csv (all pure), settings keys + schema + defaults, API contracts M23-1..6 finalised, `docs` tweaks found necessary. Verify: only the new pure tests + settings tests + `importBoundaries`.
- **236** In scope: 7.1 migration + journal + Drizzle tables, repos, service, IPC, preload, trash/restore, `wipeRules` decision, local `price_log`, update migration lists in `db.test.ts`, `itemRules.test.ts`, `syncRecords.test.ts` (they hard-code the migration count). Verify: typecheck; new repo/service tests, `db`, `itemRules`, `syncRecords`, `backupService`, `wipeRules` tests.
- **237** In scope: importer per section 8 with a SYNTHETIC fixture DB (invented names), preview UI, backup-first, one transaction, re-run safety. Needs the owner to attach `bills_data.db` for the real-run check (a local optional script, never in tests). Verify: new importer tests + typecheck.
- **238** In scope: 4.2 (page, grid reuse, categories panel, tab strip, columns dialog, tiers editor, section rows, filters, shortcuts, palette, `ROUTES` + `routes.test.ts` update quoted, tile, Settings section + section-count test, density rule ≥ 20 rows, theme tokens). Verify: typecheck; the new page/store tests, `shortcuts`, `routes`, `keyboardAcceptance` (compare to baseline), settings page test (compare to baseline).
- **239** In scope: bulk adjust with preview + undo, fill-from-column, find/replace, clean-up, global search with jump, CSV, share as image/PDF via the existing pipeline. Verify: new tests + typecheck.
- **240** In scope: 4.3 whole (strip component, store with debounce and stale-answer guard like `aiPanelStore`, autofill wiring on cell-leave via passive listeners like the M22 panel, never on keystroke, per-row state, one-undo fill, 3 modes, settings UI, format→tier mapping from the registry, hybrid sides, stock transfer off). Measure grid latency before/after on an 80-row bill (rule 5.6) and record it; never claim the budget without a measurement. Verify: typecheck; new tests (invented names only), `gridEdit`, `shortcuts`, `importBoundaries`, the Create component tests touched.
- **241** In scope: `18_price_list.sql` (never run), static SQL tests, desktop applier/push/pull for the four kinds (copy the `item_rule` path), aside/min-reader behaviour, simulation harness cases, checklist G in `SUPABASE_MIGRATIONS.md`. Out: permissions and log. Verify: `supabaseSql`, `applyV2`, `itemRuleSync`-style new test, `syncRecords`, `simHarness` users.
- **242** In scope: 4.4 (flags, server check in the push RPC, `qt_price_perms_*`, seat-1-only UI "Who can edit", error codes + plain-words messages, aside on refusal / revoke, local read-only states in the Price List UI, no-sync = full rights), verify `seat_no` exposure. Verify: new tests + `supabaseSql` + typecheck.
- **243** In scope: 4.5 (server-side log in the push RPC, `qt_price_log_list`, Settings > Activity visible only to seat 1 and only when toggled, retention, CSV export, local log for no-sync PCs). Verify: new tests + `supabaseSql`.
- **244** In scope: new IndexedDB upgrade step (never edit step 1), repo, sync encode/decode/apply/outbox/first-sync for the four kinds, backup STORE_NAMES + `newer-backup` handling, tests under `src/pwa/__tests__`. Phone code never imports Electron/better-sqlite3/main. Verify: named pwa tests + `importBoundaries` + `classicParity` (must stay green, snapshot untouched).
- **245** (split on 2026-11-13: the old single Phase 245 was too big) In scope: phone Price List browse + search, read only, in the three new layouts via NEW files only, reachable from the Dashboard (not the bottom nav), the seat's rights shown, phone settings mirrors (read). Verify: named pwa tests + `classicParity`, `importBoundaries`.
- **246** In scope: phone Price List editing subject to the seat's flags (cell edit, add item, add / rename tab and category, delete), outbox, refused kept-list note. Verify: named pwa tests + `classicParity`, `importBoundaries`, `priceListData244`.
- **247** In scope: "by hand" + case button + price strip / auto-fill in the new layouts' bill editor, phone settings rows, names / amounts never truncated (M18 rule). Verify: named pwa tests + `classicParity`, `importBoundaries`.
- **248** In scope: Price List in phone sync status / first-sync words, revoke while offline, storage / backup notes, three-layout parity sweep, Classic decision recorded. Verify: named pwa tests + `classicParity`, `importBoundaries`, `syncPushPull`.
- **249** Gate: typecheck once + the named test files of 233-248; reconcile `PHASE_STATUS`, `PROJECT_STRUCTURE`, `API_CONTRACTS`, `DATA_MODEL`, `GITHUB_UPDATE_PUSH` (schema 12, Supabase file 18), write `docs/M23_OWNER_CHECKLIST.md` UNFILLED (same list as before: desktop import, page feel, auto-fill in GST and non-GST, strip mode, off mode, permissions with two seats incl. a phone, log visible only on seat 1, offline revoke, "by hand", case button, grid smoothness measured on a real PC, Supabase checklist G, real Android), bump to 0.1.55 [A] in `package.json` + both spots in `package-lock.json`, hand back changed-files zip + full zip + push steps with the tag.
- **250** Fix pack, only after the owner returns the checklist.


## 10. Risks and edge cases

- Rate double GST (see 3.2): the single biggest correctness risk; get the owner's answer before Phase 240.
- 47% of imported items have no price: never fill from an empty cell; show "no price" in the strip.
- Auto-fill on cell-leave must not fight undo, paste of many rows (a paste of N rows must not trigger N fills [A: no auto-fill for pasted rows; only for typed names]), Hybrid sides, row insert/delete/move (state follows the row id), format switch (re-evaluate tier; never lose entered data, rule 4.5), draft recovery, History edit of a saved bill (fill only when the owner types, never on open).
- Performance: fuzzy index built once from the store and updated incrementally; matching debounced and off the keystroke path; strip never takes focus.
- Perms are authoritative on the server; client checks are only UX. Offline edits by a revoked seat are set aside, never dropped.
- Column design conflicts between two seats editing the same tab's columns: tab record latest-wins with loser kept; column keys are never reused (like `nextExtraColKey`).
- Unicode in the case transform; the phrase matcher with other scripts must not throw.
- Names must never be truncated in the new phone layouts; ellipsis on desktop grid cells with expand-on-focus (rule 5.7).
- The legacy DB and any Price List contents are private data: never in tests, logs, docs or commits.
- Known pre-existing red tests are listed in 10r; compare against the previous zip.


## 11. Open decisions / [A] defaults (say so in every phase log)

| # | Question | Default used if no answer [A] |
|---|---|---|
| 1 | Is the "cash+GST" price the rate typed BEFORE Quot3 adds GST? | Yes: GST bill → `cash_gst`, Non-GST → `cash_wo` (editable) |
| 2 | "By hand" apply timing: when the phrase is complete (+ space/punct.) or only on leaving the cell? | `word` (complete) + always on leaving the cell |
| 3 | Phrase list for auto red-bold | `['by hand']`, editable |
| 4 | Case button scope | item names only; all rows; selected rows if a range is selected; cycle UPPER ↔ lower |
| 5 | Suggest vs auto default | `auto` |
| 6 | Classic phone layout: may the new features be added to it? | No; new layouts only until the owner approves |
| 7 | Hierarchy depth | category → tab (2 levels), max 12 columns |
| 8 | Phone editing depth | search + view + cell edit + add item + add/rename tab/category; column design/bulk/paste desktop-only |
| 9 | Sync Price List PC ↔ phone | Yes |
| 10 | Legacy app still in use? | One-time import, re-run allowed |
| 11 | Customer tier decides the column | Not in M23 |
| 12 | Permission flags | add / edit / overwrite / delete / structure |
| 13 | Log recording always on, view toggled | Yes; retention 365 days |
| 14 | UI name | "Price List" |
| 15 | Versions | 0.1.53 (233), 0.1.54 (234), gate 0.1.55; numbers never reused |
| 16 | Seed tier labels from the screenshot | cash w/o, wholesale w/o, cash+GST, credit gst |
| 17 | Start fresh Level 1 clears the Price List? | No (Level 2 + its own "Clear Price List") |
| 18 | Tally | Parked, separate milestone |
| 19 | Owner must supply | the legacy screenshot as `docs/reference/legacy_app/legacy_pricelist_screen.png`; `bills_data.db` for Phase 237; any column-label config file next to the DB |


## 12. To verify before writing contracts (NOT checked at planning time)

- Read `docs/MILESTONE22_DESIGN.md`, `docs/ITEM_SORTER_SPEC.md`, `docs/SYNC_SHARED_STORE_SPEC.md` sections on records/RPCs, `docs/reference/KEYBOARD_CELL_RULES.md` (all), `docs/MILESTONE18_DESIGN.md`, `docs/DATA_MODEL.md`, `API_CONTRACTS.md` tails, `shared/hybrid/*`, `shared/shortcuts.ts` (free keys), `shared/shortcutList.ts` (palette-only list), `shared/wipe/wipeRules.ts`, `main/db/auditRepo.ts` + `shared/audit.ts` (reuse for the local log).
- Check whether shared-sync status already exposes the seat number; check how `15_rpcs.sql` identifies the caller; check how the phone logs in (which seat).
- Check how the existing M22 strip (`AiHistoryPanel`, `aiPanelStore`) hooks the grid (passive `focusin/input/focusout` on the grid host) and reuse the same pattern for cell-leave detection.
- Check the Create grid's edit command path and undo grouping so "typing + red-bold" and "fill" are single undo steps.
- If something here disagrees with the zip, the zip wins: flag the disagreement in `PHASE_STATUS.md`, do not silently pick one.
