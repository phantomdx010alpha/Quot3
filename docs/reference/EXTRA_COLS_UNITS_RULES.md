# EXTRA_COLS_UNITS_RULES — extra columns, unit parsing, Mark

**Binding spec for Phases 7, 21, 22.** Parsing and summarising are pure functions in `src/shared/units/` (contracts in `API_CONTRACTS.md`). Reference image: `legacy_app/legacy_create_screen.png` (columns "ruby" and "tomato" and the "Marked" popup).

---

## 1. Purpose
Extra columns exist to record **item codes with unit counts in one cell**. Example: header `ameto`, cell `(125-5)` = item "ameto", code `125`, **5 units**. The code can be anything (letters, digits, dots); only the number **after the separator** is a quantity. The column header is independent of the main item name (they need not match).

## 2. Parsing rule — `parseUnits(text)`

1. Trim. Strip a single pair of wrapping brackets/braces if present: `( … )`, `{ … }`, `[ … ]`. Strip stray trailing `)`, `}`, `]`.
2. Find the **last** separator in the text. Separators: hyphen-minus `-`, en dash `–`, em dash `—`, minus sign `−`, and equals `=`. (Surrounding spaces are ignored.)
3. Take the text after that last separator. If it is a valid non-negative decimal number (`^\d+(\.\d+)?$` after trim), that is `units`; the text before the separator is the `code`.
4. If there is no separator, or nothing numeric after it, `units = 0` and the cell is reported as `parsed: false` (it is simply not counted; it is not an error).
5. Only the **last** separator counts, so codes may contain separators: `25-B-3` → code `25-B`, units 3.
6. Multiple entries in one cell are **not** supported in v1: one cell = one code/units pair (the owner's images show one pair per cell).
7. Units are summed with `decimal.js` (never floats). Units may be fractional (e.g. `0.5`) but the legacy data is integer — display without trailing `.0`.

### Worked examples (all must be Vitest cases)
| Cell text | code | units | parsed |
|---|---|---|---|
| `(125-5)` | `125` | 5 | yes |
| `11.5-1` | `11.5` | 1 | yes |
| `25651-45` | `25651` | 45 | yes |
| `5—4` (em dash) | `5` | 4 | yes |
| `8800=2` | `8800` | 2 | yes |
| `25-B-3` | `25-B` | 3 | yes |
| `idk bruhh` | — | 0 | no |
| `` (empty) | — | 0 | no |
| `12-` | — | 0 | no |
| `7-x` | — | 0 | no |
| `{125-5}` | `125` | 5 | yes |

## 3. Headers and the Mark feature

- Each extra column has a **column header** (editable, independent text). Every cell in the column belongs to a **segment**.
- The first segment starts at row 1 and is owned by the **column header**.
- **Mark** (button / Ctrl+M) on a cell in an extra column turns that cell into a **new independent header**: the cell's text becomes the segment label, and the segment runs from that cell **down to the row before the next marked cell** in the same column (or to the last row). A marked cell is visually distinct (accent underline/tint) and can be **unmarked** (same key), which merges it back into the previous segment.
- The marked cell's own text is a **label, not a count**: its units are **not** added to any segment (decision D-X1 — open for owner confirmation; the legacy screenshot's marked cell `idk bruhh` has no number, so the example does not disambiguate).
- Blank cells and unparsed cells inside a segment simply contribute 0.

## 4. Summaries

- **Units summary** (button / Ctrl+U): for each extra column, show the **column header → total units** of its first segment. Segments created by Mark are **not** included here.
- **Marked calculations** (button / Ctrl+Shift+M): shows, per column, each **marked segment label → its total units**, listed separately (this is the legacy "SHOW MKD" popup).
- Both are compact popups, keyboard operable (Esc closes), copyable as text (Ctrl+C in the popup).
- Summaries recompute live from the current rows (derived, never stored).
- A segment total of 0 is still listed (so a header with nothing parsed is visible).

### Worked example from the legacy screenshot
Column `ruby` rows 1–13: `11.5-1, 12.5-1, 13-1, 13.5-1, 14-1, 14.5-1, 15-1, 15.5-1, 16-1, 16.5-1, 17-1, 17.5-1` plus a blank = **12 units** (12 cells × 1).
Row 14: `idk bruhh` is **marked** → new segment "idk bruhh"; rows 15–17: `25-5, 25651-45, 42-5` = 5 + 45 + 5 = **55**.
Column `tomato`: `5-4, 56-2, 454-1` = **7**.
Expected popup output:
```
Column: ruby
  ruby = 12
  idk bruhh = 55        (this is the marked-calculations view)
Column: tomato
  tomato = 7
```
Note: the legacy popup shows both in one list ("Marked…"); Quot3 splits them into the two views above per the owner's wording ("show marked calculations info then it shows the calculations separately"). This unit-test fixture is `src/shared/units/__tests__/fixtures/legacy_ruby_tomato.ts`.

## 5. Extra-column management rules (Phase 21)
- Add: appends a column with a default header ("Col 1", "Col 2", …), empty cells. Remove: asks confirmation if the column contains data; undoable (see `UNDO_REDO_RULES.md`).
- Rename: header editable in place (single-line, ellipsis on overflow, full text on focus).
- Extra columns belong to the **bill**, not the format: they persist and keep data across Alt+1/Alt+2 and any future format (assumption A4).
- Extra columns are free text — **not** part of the totals math. They appear in print/PDF/image/TSV copy.
- Number of extra columns drives the paper engine (`PAPER_ENGINE_RULES.md`).
- Print: header text wraps to multiple lines when long; cell text wraps; neither may overlap neighbouring columns.

## 6. Decisions / open items
- **D-X1** Marked cell text = label only; its own trailing number is not counted. *Owner to confirm.*
- **D-X2** One code/units pair per cell in v1.
- **D-X3** Brackets/braces wrapping the pair are tolerated (the legacy item names use `}` stray endings).
