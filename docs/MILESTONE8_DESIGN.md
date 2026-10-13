# MILESTONE8_DESIGN — Quot3 (Phases 70–91)

Written after Phase 68 from the owner's feedback round. Phase 69 (RELEASE GATE) now runs AFTER Phase 91; no phase is renumbered. Companion docs: `docs/LEGACY_IMPORT_SPEC.md`, `docs/reference/CALCULATOR_PANEL_RULES.md`, `docs/reference/KEYBOARD_CELL_RULES.md` §11, `docs/SYNC_POSTBOX_SPEC.md` §10, `docs/DATA_MODEL.md` (Milestone 8 section).

Assumptions marked **[A]** were adopted by the planner when the owner said "we are ready" and are not explicitly confirmed; the owner may flip them.

## 1. Create after Save shows the old bill (Phase 70)
After a successful Save the Create session clears (`startFreshBill()`), so Create is blank. **[A]** An unsaved bill is resumable, and a visible **New** button starts a fresh one. View/edit of a saved bill is unaffected.

## 2. Header border misalignment (Phase 70)
Header dividers (Item Name, Quantity, …) must sit on the same x as body column borders. Likely cause: header and body use different box models/scrollbar gutters. Fix by sharing one column-geometry source; add a pixel-alignment e2e check.

## 3. Image copy: instant and HD (Phases 71–72)
- Warm pooled render window kept hidden; direct `clipboard.writeImage` from main; pre-render on idle after edits settle; cache keyed by bill content hash.
- Scale 4–5× (setting `image.scale`, Settings "Image quality"); **verify the device scale factor actually applies** (measure output pixel width) and respect `IMAGE_MAX_PX`. Today `IMAGE_SCALES=[3,2]` in `shared/print/imageFlow.ts`.

## 4. Print dialog instant, top-aligned (Phase 73)
The dialog opens from the pure paper engine immediately; overflow measurement runs in the background and updates the dialog. Print is **top-aligned**; diagnose whether the centring comes from template CSS or the printer driver/page setup before fixing, and record the finding.

## 5. Smooth arrow navigation (Phases 74–75)
See `KEYBOARD_CELL_RULES.md` §11. Setting `nav.smoothArrows`, default ON. Pure reducer first, DOM and Settings toggle second.

## 6. Round-off (Phases 76–77)
- R1 Default ON, Settings toggle `calc.roundOff`. R2 Rounds the grand total to the nearest rupee. R3 **No displayed round-off line**; the amount is kept internally.
- R4 Per-bill `round_off` flag (migration default 0): old bills keep their totals until re-saved with the setting on; imported bills get 0.
- R5 One shared "bill options" read used by every caller (`gridModel`, `billModel`, `billTsv` ×2, `printModel`) — no caller reads the setting on its own.
- R6 Money stays decimal strings. R7 Sync snapshot carries `round_off` (optional, default 0). R8 `sameContent`/`diffBills` include it.

## 7. Extra-column free cells (Phases 79–81)
- Extra columns are editable on the Items total, Adjustments total and Final total rows (or the single "Total" row). Stored in `bills.footer_extras_json`.
- Unlimited extra-only **tail rows** below the Final total, stored in `bills.tail_rows_json`, trimmed to the last non-empty row on save.
- Units count (continuing the last segment in display order); appear in print, TSV and image; undo/redo; sync snapshot and diff.
- Paper engine: `rowCount = items + adjustments + non-empty tail rows` (`computeBill` option `tailRowCount`; limits stay only in `paperConstants.ts`).

## 8. Active-row highlight (Phase 78)
Whole row highlighted on Create/View. Token `--grid-active-row-bg` (all themes, theme whitelist). Applied by setting a DOM attribute on the row, with **no React re-render**; perf budget re-checked.

## 9. About publisher (Phase 90)
Publisher "Ankit Shukla", email `phantomdx9@gmail.com` **as typed by the owner** (the account email is phantomdx010@gmail.com — confirm). Copy and mailto go through main only. Installer publisher, `APP_ID` and signing name stay unchanged unless the owner asks.

## 10. Start fresh / total wipe (Phase 90)
- Level 1: clear bills and customers; keep settings, company, license, backups. PO restart number selectable.
- Level 2: factory reset with options to also remove backups / themes / logs / assets; deactivates the license locally.
- Typed confirmation; safety backup kind `pre-wipe`; applied through the `pendingRestore` stage-and-apply-at-launch mechanism.
- Sync: a wipe never sends deletes; the UI warns that other branches keep their data and may re-send.

## 11. Calculator drawer (Phases 82–83)
See `docs/reference/CALCULATOR_PANEL_RULES.md`.

## 12. Legacy import and sync fixes (Phases 84–89)
See `docs/LEGACY_IMPORT_SPEC.md` and `SYNC_POSTBOX_SPEC.md` §10. Import on ONE branch only **[A]**; others receive via sync. Duplicate legacy numbers **[A]**: same number + same party = re-save (keep one); same number + different party = later gets next free number; owner can override per group in the preview. Dedupe by fingerprint, deterministic id derived from it **[A]**.

## 13. Order of work and gates
70→91 in order; Phase 91 = Milestone 8 QA gate + perf re-run + docs sweep; then Phase 69.

**Update (2026-10-11):** Milestone 8 is built. Phase 69 now follows Milestone 9 (Phases 92–106, `docs/MILESTONE9_DESIGN.md`).
