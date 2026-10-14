# Milestone 14 — Owner feedback for release 0.1.7 (Phases 145–153)

Planned 2026-10-14 from the owner's feedback on the running app (0.1.6). Owner's words are paraphrased; anything the owner did not state is marked **[A]** (unconfirmed assumption - say so in the phase log). Phase 69 (RELEASE GATE) runs AFTER Phase 153. This milestone is independent of Phases 128-143 (sync) and may run before or after them; Phase 153 ships it as version **0.1.7** (see `GITHUB_UPDATE_PUSH.md` section 2).

**Testing rule (owner, explicit):** no full test-suite runs in this milestone (see `CLAUDE_MUST_READ.md` 10i). Typecheck + only the files you touched and the ones likely to conflict.

## 1. The requests, one by one

### 1.1 Party name combobox too small (Phase 145)
The party autocomplete list truncates long party names with an ellipsis, so the owner cannot read the whole name. Fix: the DROPDOWN is wide enough for full names and long names wrap onto a second line instead of being cut. The party input itself keeps its size (Create-page density rules in `CLAUDE_MUST_READ.md` 5.2 still apply). [A] width = at least the input width, grows to the longest name up to about 60 characters or the window edge, never off-screen.

### 1.2 History sorted by invoice number (Phase 146)
Today bills from several branches are mixed and the list is confusing. Wanted: ONE plain list, NOT split by branch, sorted by the invoice (PO) number. Branch prefixes differ (for example `AV-0748`), so the number carries the branch and a simple sort is enough. [A] order = newest (highest) number first; compare the numeric part of the number; ties (same number, different prefix) broken by prefix A-Z, then by date. [A] the existing sort choices (if any) stay available; this becomes the default. Pure comparator in `shared/` with tests; no schema change.

### 1.3 Print "spatial awareness" for A5 and A4 (Phase 148)
Printed bills, A5 especially, come out too small to read. The hardcoded paper thresholds (40 / 30 / 80 / 70, `paperConstants.ts`, Phase 36-37) STAY EXACTLY as they are: they still decide A5 vs A4. New: after the paper is chosen, a "fit" step scales the print (font size and row height, as one factor) UP so the bill uses the space on the page well, but:
- it must NOT make every bill fill the whole page: a bill with 5-6 rows stays compact, so the factor is capped (the cap is a setting, [A] default about 1.35x for A5, 1.25x for A4);
- it never scales below 1.0 (the current look is the floor) and never makes anything overflow, overlap or push the layout sideways (`CLAUDE_MUST_READ.md` 5.7);
- it is measured, not guessed: the engine uses the model's real content height (rows, wrapped names, header, totals) against the printable height;
- **default ON; the current behaviour is the fallback and is configurable**: Settings > Print gets "Fit bill to page" (On / Off) and the maximum enlargement. Off = byte-identical to today;
- Save PDF, Print and image copy agree; the Phase 144 rule stays (top-aligned, page margin only, no vertical centring).
Pure engine in `shared/print/` (input: model measurements + paper + cap; output: one scale factor) with a table of tests (few rows, many rows, long names, adjustments, extra columns, A5 and A4, the thresholds unchanged). Real-printer result is a standing gap until the owner's paper test.

### 1.4 Create-page toolbars show names, not only icons (Phase 147)
Every icon-only button in the Create page's top toolbar and bottom action bar gets a visible text name next to the icon. On SMALL screens (owner: "hide on small screens") the names hide and only the icon stays (tooltip stays). [A] breakpoint = the window width where the 20-visible-rows density rule (`CLAUDE_MUST_READ.md` 5.2, 1366x768) would break; names must not wrap or push the bar taller than its current height budget (~44px bottom bar). Tokens only, no hardcoded colours; Phosphor icons stay.

### 1.5 Format 4: Stock transfer, Alt+4 (Phase 149)
The simplest format. Columns: **Item name** and **Qty** only. Qty accepts WORDS as well as numbers (free text, for this format ONLY; every other format keeps strict numeric qty, money stays decimal strings elsewhere). No rate, no amount, no GST, no totals, no money maths. Instead of the party name the header asks **"Select branch for transfer"**: the owner picks a branch from the branch list. [A] the picked branch is the branch the stock comes FROM (the owner wrote "the branch which we need the stocks to be transferred from"); the document is titled "Stock transfer". [A] it still gets a PO number, date, save, history entry, print and image copy like other bills; no party record is created or required. Added through the format registry (Golden Rule 4.4: one registry entry, no `if (format === ...)` branches); Alt+4 registered in `shortcuts.ts` and the palette.

### 1.6 Format 3: Hybrid, Alt+3 (Phases 150-152)
Owner's rules (confirmed in conversation 2026-10-14):
1. The owner makes a bill in GST or non-GST, then switches to Hybrid (Alt+3).
2. **From a GST bill:** the GST table stays exactly as it is. Beside it (side by side) a SECOND table is created in the NON-GST layout, copying the item names, quantities and amounts at the moment of the switch. The owner can then change the rates etc. in the second table.
3. **From a non-GST bill:** the same the other way round: the non-GST table stays, the second table is in the GST layout, copying names, quantities and amounts.
4. **Each table has its own separate amount calculations** (own totals, own rounding, own final total).
5. **Independent after copying:** editing an item name or qty on one side never changes the other side.
6. **Adjustments are separate per side** (each side has its own adjustment rows, editable and addable). Adjustment rows and their labels are NOT copied at the switch.
7. **Extra columns are SHARED** by both tables (one set of extra columns and cells; editing it shows on both sides). They are not duplicated and not lost.
8. Saved as ONE bill (owner: "yes").
9. **Print and image copy in Hybrid ask first: "GST side or non-GST side?"** and then print / copy ONLY the chosen side, laid out like that format's normal bill. Applies to Print, Save PDF and image copy (and any other output path, for example copy as text).
10. [A] Switching away from Hybrid never deletes the second table: it is kept and comes back when the owner returns to Hybrid. Switching GST <-> non-GST outside Hybrid behaves as today (Alt+1 / Alt+2 show the primary table). [A] "Primary" = the side the bill was started in.
11. [A] Hybrid-to-Hybrid re-copy: pressing Alt+3 when a second table already exists does NOT overwrite it (no silent data loss); a separate explicit "Re-copy from the other side" action, with a confirm, may do that.

Design consequences Claude MUST handle (decide and record in `API_CONTRACTS.md` BEFORE coding, Phase 150):
- `CLAUDE_MUST_READ.md` rule 4.5 ("one superset of row fields, formats are views") is deliberately EXTENDED for Hybrid: a bill may carry a second row set. State this as a supersession in the contract and keep the "switching formats never loses entered data" guarantee.
- Storage: prefer an optional field in the bill record / snapshot (no new table) so no migration is needed; if a migration is unavoidable it must be a NEW numbered file, and the release workflow's `schema: N` rule (see `GITHUB_UPDATE_PUSH.md`) makes the rollback feature aware of it. Sync (`min_reader_ver`): a reader older than the Hybrid-capable build sets such a bill aside, never strips the second table (see 10g).
- Undo/redo, drafts, autosave, revisions / diff, history list, Excel export, search and the Items page must keep working and must not double-count: [A] the Items page and dashboard totals use the PRIMARY table only (a hybrid bill is one sale, not two).
- Layout: two tables side by side must still fit the Create page density and keyboard rules (cell navigation across both tables is defined in the phase: [A] Tab moves within a table, a shortcut / Ctrl+Left-Right switches table).

## 2. Phase map

| Phase | Title | Depends on |
|---|---|---|
| 145 | Party combobox: full names | - |
| 146 | History sorted by invoice number | - |
| 147 | Create toolbars: visible names (hidden on small screens) | - |
| 148 | Print spatial awareness (fit-to-page) A5 + A4, Settings, fallback | 144 |
| 149 | Stock transfer format (Alt+4) with branch select | - |
| 150 | Hybrid format: model, contract, pure logic, storage | - |
| 151 | Hybrid format: Create UI, Alt+3, shared extra columns | 150 |
| 152 | Hybrid print / PDF / image: ask which side, output that side | 148, 150, 151 |
| 153 | Milestone 14 QA gate and release 0.1.7 | 145-152 |

Suggested order: 145, 146, 147 (small, independent), 148, 149, then 150-152, then 153. Each can be its own session; 150-152 are the heavy ones (150 alone is design + pure logic + tests, no UI).

## 3. Open items [A] the owner may flip before the phase runs
History order (newest first); Stock transfer "branch" = source branch; Stock transfer prints and is saved like a bill; Hybrid second table kept when leaving Hybrid; Alt+3 never overwrites an existing second table; Items page / dashboard count the primary table only; fit-to-page default caps (A5 1.35x, A4 1.25x); toolbar-name breakpoint.
