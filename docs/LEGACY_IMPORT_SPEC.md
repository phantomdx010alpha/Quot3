# LEGACY_IMPORT_SPEC — importing the old app's JSON bills into Quot3

**Binding spec for Phases 84, 85, 86, 87, 88, 89.** Written 2026-10-10 from a real analysis of the owner's folder `Bills_JSON` (768 files, kept in this repo as `docs/reference/legacy_import/Bills_JSON.zip` — private business data: phone numbers, party names; do not publish the repo or the zip). Owner's wording (verbatim, in `REQUIREMENTS_ORIGINAL.md` Part A addendum 2): *"build a system, where we should be able to import and transform the quotations from the already previously existing sloppy application which stored quotes as a json file, and their po number should be automatically updated to the new prefix and the next po should continue the next number from there … we need this feature in settings where we can import the required json folder as we want anywhere."*

Owner decisions recorded 2026-10-10: keep **only the number** of the old bill number (drop the old prefix); **recompute** totals; add the imported parties to Customers **but first check whether those exact parties already exist**; **send** imported bills to the other branches and **show a progress bar** on both the sending and the receiving side; imported bills must be **clearly visible and fully editable in History**.

---

## 1. What the legacy files look like (measured, not assumed)

One JSON file per bill, named like `Bill_356_ROOPESH_TAILORDoddaballapur_manual.json`. UTF-8. All 768 parse.

Top level (always present): `bill_no`, `date`, `party`, `phone`, `transport`, `gst`, `format_mode`, `extra_headers`, `items`, `total`.

| Fact | Measured |
|---|---|
| `format_mode` | `manual` 592 · `gst` 172 · `default` 4 |
| `bill_no` type | integer 701 (range 1–743) · text 67 (`BR1_106` style, **3 are triple-prefixed** like `BR1_BR1_BR1_228`) |
| Bill numbers shared by more than one file | **19 numbers** (e.g. 413 twice, `BR1_106` three files with three different parties, 42 as both a `_gst` and a `_manual` file for the same party) |
| `date` | `DD-MM-YYYY` in 764 files, `DD-MM-YYYY HH:MM:SS` in 4 |
| `extra_headers` | 0 columns 703 · 1 column 47 · 2 columns 18 (6 bills have two columns with the **same header text**) |
| `gst` (top level) | empty in 767 files, non-empty in 1 (a party GST number) |
| Items per bill | up to 64 |
| Item entries | 8 533 normal items + 481 adjustments (`"kind": "adjustment"`) |
| Numbers stored as text | `rate` `""` 35 · `amt` `""` 32 · `qty` `""` 13 (blank, not garbage) |
| Items with no name | 59 |
| Items where `amt` ≠ `qty × rate` | 23 (a manually typed total) |
| Negative adjustments | 27 |
| Rich text | `formats.name` = list of `{start, end, tag}`; only tag `redbold` exists (275 uses) |
| Highlights | `highlights.<col>` booleans; true only for `name` (2 items) |
| Marked cells | `marked.manual_0` true 8, `marked.manual_1` true 4 (all others false) |
| **Stored `total` is unreliable** | in **400 of 768** files it does not equal items + adjustments — frequently it equals the items only and leaves out an adjustment such as `GST 226` |

Item shape (non-GST): `name, qty, rate, amt, [formats], [marked], [marked_display], [highlights], [highlights_display], [manual_0, manual_1], [extras]`.
Item shape (GST): the same plus `gst` (percent), `gst_amt`, `total` (= amt + gst_amt).
Adjustment: `{ "kind": "adjustment", "label": "GST", "value": 320.0, "extras": [] }` — `extras` is a list of numbers/strings, one per legacy extra column, usually empty; non-zero values were found in 2 files and in 1 of them there are **more values than headers**.
Extra-column cell values live in `manual_0`, `manual_1` … and, in some files, **also** as an `extras` array (`["7", "831"]`); both carry the same data. Prefer `manual_N`, fall back to `extras[N]`.

## 2. Mapping to a Quot3 bill

| Legacy | Quot3 | Notes |
|---|---|---|
| file | one `Bill` | new bill id (see §6 fingerprint → deterministic id), `revision` 1, `branchId` = local branch |
| `format_mode` `manual` / `default` | `formatId` `non_gst` | `default` = the old Alt+1 "Default"; treated as non-GST (listed in the report) |
| `format_mode` `gst` | `formatId` `gst` | |
| `date` | `billDate` ISO date; `createdAt` / `updatedAt` = that date (+ the time if present, else 12:00 local) | `DD-MM-YYYY`; an unparsable date makes the file an **error row** in the report (never guessed) |
| `bill_no` | PO number (§3) and `legacy_ref` (the original text, e.g. `BR1_106`) | |
| `party`, `phone`, `transport` | `party` snapshot (trimmed) | `gst` (party GST number), when non-empty, is kept as a last line of the snapshot address `GSTIN: …` (owner may flip) |
| item `name` | `nameRuns` (+ plain) | `formats.name` `redbold` ranges `{start,end}` → runs with bold + red; offsets clamped to the text; unknown tags ignored and counted in the report |
| item `qty`, `rate` | `qty`, `rate` decimal strings | `""`/missing → `null`; `10.0` → `"10"` |
| item `amt` | **recomputed** (`qty × rate`); kept as `totalOverride` **only** when it differs from `qty × rate` by more than 0.01, or when qty/rate are blank but `amt` is present | a row with a name and an amount but no qty/rate is, by Quot3's own rule, an adjustment-style row |
| item `gst` | `gstRate` | GST format only; `gst_amt` and `total` are ignored (recomputed) |
| adjustment `label`, `value` | a row: name = label, `totalOverride` = value, qty/rate `null` | negative values kept; Quot3 moves it into the adjustment block by its own rule |
| `extra_headers[i]` | `ExtraColDef` (header = the text, key from the existing Phase 21 key generator) | duplicate header texts are allowed |
| `manual_i` / `extras[i]` | the row's extra cell `text` | numbers rendered without a trailing `.0`; `marked.manual_i` → `marked: true` |
| adjustment `extras` | the adjustment row's extra cell **only for non-zero / non-blank values and only when that column exists** | otherwise ignored and counted |
| `highlights.name` | name-cell highlight | other highlight keys have no Quot3 counterpart: ignored, counted |
| `marked.name/qty/rate/amount` | no counterpart | ignored, counted |
| `total` (stored) | **not used** | see §4 |
| `round_off` | `0` for imported bills (exact recomputed amounts); a later re-save adopts the Settings value | owner may flip |

Row order is the legacy order; blank trailing rows are not created. Quot3 recalculates Sl.No.

## 3. PO numbers (owner: "keep only the number")

1. `legacyNumber` = the **digits after the last `_`** of `bill_no` (`BR1_106` → 106, `BR1_BR1_BR1_228` → 228, `356` → 356). A `bill_no` with no digits is an error row.
2. The new PO number is `<current PO prefix><number zero-padded as `formatPo` does>` — e.g. prefix `Q3-` and 356 → `Q3-0356`. The prefix is the local branch's prefix **at import time**, shown in the preview (the owner may change it in Settings first; it is not editable inside the import dialog).
3. `po_seq` = that number. **The branch's PO counter becomes `max(current next_seq, highest assigned po_seq + 1)`** — never lower. With the owner's data the next new bill after import is `Q3-0744`.
4. **Clashes.** After stripping prefixes, numbers can repeat (the 19 groups, plus `106` vs `BR1_106`). Default rule (the owner can override each group in the preview):
   - Same number **and the same normalised party name** → treated as the **same bill saved twice** (e.g. the `_gst` and `_manual` files of bill 42). Keep **one**: the later `date` (with time), then the one with more items, then the larger recomputed total, then the file name. The others are **skipped and listed** with the reason.
   - Same number but a **different party** → a different bill. The earliest-dated one keeps the number; each other gets the **next free number after the highest legacy number**, in date order. Every renumbered bill is listed (`old file → new PO`), and its `legacy_ref` still shows the original text.
   - A number already used by a bill in this database (not from this batch) is treated like a different-party clash: the new one is renumbered, existing bills are never touched.
5. Zero-padding follows `formatPo`; numbers above the pad width simply get longer.

## 4. Totals

Totals are **recomputed** by the normal calculation engine (`computeBill`), exactly as if the bill had been typed in Quot3 (items + adjustments; GST per item in the GST format). The stored legacy `total` is read only for the **report**: every file whose recomputed grand total differs from the stored one by more than 0.5 is listed with both numbers (`legacy 25674.00 → Quot3 25900.00 (the legacy total left out the 226.00 adjustment)`). This is expected for about 400 files and is not an error.

## 5. Parties (Customers)

For every distinct party in the batch (normalised exactly as `normalizePartyName`: trimmed, lower-cased, whitespace collapsed):
1. **If a party with that exact normalised name already exists** (live, not deleted) → link the bill to it; **never modify** it.
2. Otherwise create it once, `source = 'import'`, with phone / transport / address taken from the **most recent** bill (by date) of that party that has a non-empty value for the field.
3. Near-matches ("NANDAN TAILOR" vs "NANDAN TAILOR - ANEKAL") are **different parties** — no fuzzy merging on import. (The preview shows the count of "new parties" and "already existing" so the owner can see the effect before committing.)
4. A blank party name is an error row for that file.
The same exact-name check is what Phase 87 adds for bills arriving by sync, so the two paths agree.

## 6. Idempotence, fingerprint and ids

- Each legacy file gets a **fingerprint** = SHA-256 of `normalisedParty | ISO date | original bill_no text | recomputed grand total | item count`, stored in `bills.import_fingerprint` (unique when not null).
- The **bill id is derived deterministically from the fingerprint** (a name-based UUID), so importing the same file on two branches produces the *same* bill id; the normal last-write-wins sync then merges them instead of duplicating them.
- **Import the folder on ONE branch only.** Other branches get the bills by sync. If a second branch tries anyway, its preview skips every file whose fingerprint (or derived id) already exists locally — including bills received by sync and bills sitting in Recently deleted (reported as "already here").
- Re-importing the same folder on the same branch skips everything ("already imported") and changes nothing.

## 7. Where, how, what the owner sees (Phase 86)

- **Settings → "Import legacy bills"** (also a palette action and a Customers/History shortcut button). Works **any time**, from **any folder** (native folder picker; also "pick .json files"). `.zip` files are **not** read in v1 (no new dependency) — the owner unzips first.
- Paths are chosen in **main** through the native dialog; the renderer only ever holds an opaque `sourceId`.
- Steps: **Pick** → **Reading** (progress) → **Preview** → **Import** (progress) → **Report**.
- **Preview** shows: files found / readable / errors; bills that would be created, skipped (same bill twice, already imported), renumbered; the PO range and **next PO after import**; new vs already-existing parties; the totals-differences count; warnings (blank names, unknown tags, dates); a **clashes table** with a per-group choice (default per §3.4: *import / skip / import as new number*); a switch **"Send imported bills to the other branches"** (shown only when sync is activated and other branches exist; default **on**, the owner's choice).
- **Commit** takes a safety backup first (`pre-import` backup kind), then writes **all bills in one transaction** (all-or-nothing; a failure rolls everything back and says why). Cancel is possible until the transaction starts.
- **Report** (shown, and saved to `logs/import-<timestamp>.json`; "Save report as text/CSV"): counts; every skipped / renumbered / errored file with its reason; totals differences; ignored fields counts; new parties; next PO number.
- **Undo this import** (Settings list of past imports): moves the batch's bills to **Recently deleted** (only bills **not edited since** — `revision` still 1; edited ones are kept and listed), removes parties the batch created that have no other bills, never lowers the PO counter. If sync is on, the deletes propagate like any other delete.

## 8. History (Phase 86)

- Imported bills show a small **"Imported"** tag in the bills list and in the bill header on the Create page ("Imported from the old app · old number BR1_106 · 08-10-26").
- History gets a source filter: **All / Created here / Imported** (and, inside Imported, a **batch** picker).
- History search also matches the **legacy reference** text (`BR1_106` and `106`).
- Imported bills are **ordinary bills**: open (Enter), edit, print rough/professional, copy image, PDF, delete to Recently deleted, revisions. After an edit the bill is revision 2, syncs normally, and **keeps** its Imported tag and legacy reference.
- Customers counts include imported bills (they are linked to parties by §5).

## 9. Sync (Phases 87–89) — see `SYNC_POSTBOX_SPEC.md` §10

Imported bills are enqueued in the outbox **in the same transaction** as the import (bulk), so nothing is half-sent. The push worker sends them in its normal batches; the **Sync page and a status chip show send progress** (`Sending 120 of 768`), and the **receiving** branch shows `Receiving 300 of 768` (needs the new server count RPC). The receiving branch creates or links each party by the exact-name rule of §5. Fields that travel with each bill: `legacy_ref`, `import_batch_id`, `import_fingerprint`, `round_off`.

## 10. Safety and limits

- Reading is tolerant: unknown keys ignored, numbers/strings coerced, text numbers `""` → blank; a file that is not valid JSON or lacks the required keys is an **error row**, never a crash, and never stops the other files.
- Size limits: a file over 2 MB, more than 500 items, or a folder with more than 20 000 `.json` files is refused with a clear message.
- File names are not trusted for data (the content is); names only help the report.
- No network, no `eval`, no HTML insertion: names are plain text runs.
- The import writes through the same service/repo layer as `bills:save` (validation, revision snapshot, totals cache, audit rows `entity=bill action=import`).

## 11. Acceptance numbers for the real folder (Phase 84 / 85 tests, run against `docs/reference/legacy_import/Bills_JSON.zip`)

768 files read, 0 unreadable · 592 non-GST + 4 `default` → non-GST, 172 GST · 481 adjustments imported (27 negative) · 275 red-bold ranges converted · 12 marked extra cells · exactly the 19 duplicate-number groups detected · after the default clash rules, **no two imported bills share a PO number** · next PO after import = highest assigned + 1 · about 400 totals-differences listed · idempotent second run = 0 new bills · all tests use `fake` DB temp files, never the owner's data folder.

## 12. Out of scope
Exporting to the legacy format · merging near-duplicate parties · importing the legacy app's settings/company info · `.zip` input · bills from other apps · editing files in place.

## 13. Legacy watch (Milestone 15, release 0.1.12)

The automatic watcher (Settings > Background and legacy watch) reuses this importer for new bills and adds three things:
- **Content fingerprint (second, separate):** SHA-256 of normalised party + ISO date + sorted item lines (normalised name, qty, rate) + adjustments. The PO / bill number is NOT part of it, so the legacy software's "same bill saved again under another PO" is an exact duplicate (skipped + logged). The import fingerprint of section 6 (which includes `bill_no`) is unchanged.
- **Edit rules:** same normalised party AND same date AND at least 50% of item lines shared (by normalised name) = same bill edited. The newest file mtime wins: a newer copy updates the Quot3 bill in place as a NEW revision (old version stays in History); an older copy is ignored + logged. A bill edited inside Quot3 after import is never overwritten (goes to Needs review). Files are applied oldest mtime first, one transaction per file, one `pre-import` backup per batch.
- **Needs review list:** uncertain matches (same party + date but under 50% shared lines, two candidate bills, or a locally edited bill) wait in Settings with Import as new bill / Replace existing bill with this / Ignore. An Activity log (last 200 events) has Undo for automatic imports and updates. Nothing is auto-deleted. The 50% threshold is an [A] constant (`SHARED_LINES_THRESHOLD`).
