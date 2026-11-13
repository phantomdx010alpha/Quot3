# PRICE LIST — LEGACY IMPORT SPEC (Milestone 23, Phase 237)

Planned 2026-11-12. Companion to `docs/MILESTONE23_DESIGN.md` (read that first). Docs only; nothing built. Items marked **[A]** are unconfirmed (design section 11).

**PRIVACY RULE:** `bills_data.db` and every Price List content are private business data: never commit (the file is in `.gitignore`), never print contents, never embed in docs, logs or tests. Tests and the preview fixture use INVENTED names only. The importer reads ONLY `inv_categories`, `inv_tabs`, `inv_items`; the `bills` table (290 rows) and `inv_last_state` are never read.

## 1. The legacy source (facts, verified by reading the files)

### 1.1 `bills_data.db` (SQLite, private business data)
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

### 1.2 Column mapping (confirmed by comparing row 1 of the DB with the screenshot: 110 / 109 / 108 / 110 / empty)
| DB column | Legacy header (screenshot) | Proposed tier key |
|---|---|---|
| `rate` | cash w/o | `cash_wo` |
| `rate_without_gst` | wholesale w/o | `wholesale_wo` |
| `unit_qty` | cash+GST | `cash_gst` |
| `qty` | credit gst | `credit_gst` |
| `qty_with_gst` | Unit/Qty | (plain column, role `unit`, empty everywhere) |

The DB column names are misleading; the screenshot headers are the truth. The legacy "Columns" button renames headers, but the labels are NOT stored in the DB (no settings table): ask the owner if a JSON/config file sits next to `bills_data.db`; otherwise use the screenshot names.

**OPEN, MUST BE CONFIRMED by the owner [A]:** in the data, `cash+GST` (e.g. 108) is LOWER than `cash w/o` (110). Quot3's GST format ADDS GST on top of the typed rate (`gstAmt = total x gstRate / 100`, `amount = total + gstAmt`; see `shared/calc/rowCalc.ts`). So the "cash+GST" price is assumed to be **the rate to type on a GST bill, before Quot3 adds GST**. If it is actually GST-inclusive, auto-fill would charge GST twice. Default mapping (settings, editable): Non-GST bill → `cash_wo`; GST bill → `cash_gst`.

### 1.3 Legacy screenshot (not in the zip; the owner is to save it as `docs/reference/legacy_app/legacy_pricelist_screen.png`)
- Dark UI. Left icon rail (categories, summary, alerts, search, notes, share/DB, collapse). Left panel = Share/Database (copy DB path, export, import).
- Tab strip with a red × on each tab and a "+ Tab" button. Buttons: **Columns**, **CSV**, hint "Ctrl+S to save". Filter box above the table.
- Table columns: `NO` (row number), `Item Name` (wide, bold, monospace), `cash w/o`, `wholesale w/o`, `cash+GST`, `credit gst`, `Unit/Qty`. Right-aligned bold numbers. Item names are upper-case, format "BRAND CODE SIZE-NAME (width CMS)".
- Quot3 does NOT copy this look (neumorphic navy/red theme, tokens, Phosphor icons, no emoji) but keeps its structure and features.

### 1.4 `inventory_manager_2.py` features worth porting
Categories with icon, tabs per category (add / double-click rename / delete with ×), editable table with autosave, Up/Down/Enter/Tab/Left/Right cell navigation, context menu (insert above / below, clear, delete row), filter current tab, CSV export, quick search across all items with fuzzy score and jump-to-row, duplicate warning across tabs, summary panel, last category/tab restore, export / import / swap the DB file. **Do not port:** DB-file swap and "copy path" (replaced by Quot3 backup + sync), the plain `SequenceMatcher` fuzzy (it would match "505" with "D7"; use the Quot3 matcher with protected tokens).

### 1.5 `tally_inventory_frame.py`
Tally ODBC stock reader (StockItem opening/closing balance and value, pyodbc, Windows-only). **Out of scope** (parking lot). If revived later: separate milestone, desktop only, not in Electron via pyodbc, read-only snapshot.

## 2. Import specification

- Entry: Settings > Price List > "Import from legacy database" (desktop). The owner picks `bills_data.db`; it is opened **read-only**; only `inv_categories`, `inv_tabs`, `inv_items` are read; `bills` and `inv_last_state` are never read. The phone gets the data through sync (no import on phone).
- Step 1 **Preview** (writes nothing): counts (categories, tabs, items), items with no price, names cleaned (line breaks / spaces), skipped rows, tabs with a row-index gap, the proposed columns per tab, a re-run summary (new / unchanged / changed).
- Step 2 **Import**: first a `pre-import` backup (same mechanism as the legacy bill import), then ONE transaction; one entry in the activity log; goes through the normal write path so the sync outbox is fed (no second sync path).
- Mapping: categories ordered by `id` (all `position` = 0), tabs by `(category_id, position)`, rows by `row_index` (compacted); icons dropped; each tab gets columns: Item Name + the four price columns with tiers `cash_wo`, `wholesale_wo`, `cash_gst`, `credit_gst` (labels from the screenshot, editable) + `Unit/Qty` (role `unit`, hidden when empty everywhere) [A: legacy parity; the owner can drop columns afterwards].
- Cleaning: trim, line breaks → single space, collapse repeated spaces, never change letters or numbers; empty-name rows skipped (none exist today).
- Re-run safe: key = normalised (category, tab, item name) → `price_import_map`; re-run updates only rows NOT edited in Quot3 since import (edited ones are reported, never overwritten); nothing is deleted automatically; every automatic change is undoable.
- Today's data (for the preview test fixture, use INVENTED names only): 14 categories, 22 tabs, 346 items, 182 with prices, 164 name-only, 57 names with line breaks, 106 with edge whitespace, 0 duplicates.
- Question for the owner: is the legacy app still being edited (then "re-import" must work) or is this one-time [A: one-time + re-run allowed].
