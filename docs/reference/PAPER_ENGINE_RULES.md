# PAPER_ENGINE_RULES — A5/A4 decision table

**Binding spec for Phases 36, 37, 40.** Implemented as one pure function `decidePaper()` in `src/shared/paper/paperRules.ts` (contract in `API_CONTRACTS.md`). All thresholds live in `src/shared/paper/paperConstants.ts` and nowhere else. The function takes plain numbers/strings and returns a decision — no DOM, no Electron — so every row of the matrix below is a Vitest case.

---

## 1. Inputs

| Input | Meaning |
|---|---|
| `mode` | `'rough'` or `'professional'` |
| `formatId` | resolved through the format registry — **never branch on the id**; use the format definition's `a5ExtraColLimit` |
| `rowCount` | number of **item rows + adjustment rows** that have content. Footer rows (items subtotal, adjustments total, final total) and blank rows are **not** counted. (Owner: "inclusive the adjustment rows".) |
| `extraColCount` | number of extra columns currently on the bill |
| `forced` | optional `'A4' | 'A5'` chosen by the user — always honoured, with a warning if it is a bad fit |
| `measuredOverflow` | optional boolean from the render-measure safety net (§4) |

## 2. Constants (owner-specified)

```
A5_MAX_ROWS   = { rough: 40, professional: 30 }
A4_MAX_ROWS   = { rough: 80, professional: 70 }   // beyond this → multi-page A4 (assumption A3)
A5_EXTRA_COL_LIMIT  per format definition:  non-GST = 2,  GST = 0
```
Future formats declare their own `a5ExtraColLimit` in the registry; default for a new format is 0 (conservative) unless the owner says otherwise.

## 3. Decision table (evaluate top to bottom, first match wins)

| # | Condition | Size | Pages | Warning |
|---|---|---|---|---|
| 1 | `forced` set | forced size | computed for that size | If forced A5 but rules say A4: "Content may be cramped on A5 (N rows / M extra columns)". If forced A4 but rules say A5: none. |
| 2 | `extraColCount > a5ExtraColLimit(format)` | **A4** | 1, or more if rows exceed A4 max | **Yes** — non-GST: "More than 2 extra columns — printing on A4 due to layout limits." GST: "GST bills with extra columns print on A4." |
| 3 | `rowCount > A5_MAX_ROWS[mode]` | **A4** | 1 if `rowCount ≤ A4_MAX_ROWS[mode]`, else `ceil(rowCount / A4_MAX_ROWS[mode])` | No warning for the row-count fallback alone — it is *suggested* A4 with reason text "N rows exceeds A5 limit of X". |
| 4 | otherwise | **A5** (default) | 1 | None |
| — | `measuredOverflow` true and result is A5 | **A4** | recomputed | "Content did not fit A5 after wrapping long text — switched to A4." |

Rule 2 is evaluated before rule 3 so the owner's "special issues" warning shows even when the row count would also force A4.

## 4. Safety net (measured fit)
Row counts do not know about wrapped long item names. After the print template renders, the print service measures the real content height. If A5 content overflows the printable area, the service re-runs `decidePaper` with `measuredOverflow: true`. This protects against ugly output without changing the owner's stated thresholds.

## 5. Output

```ts
interface PaperDecision {
  size: 'A5' | 'A4';
  pages: number;
  suggested: 'A5' | 'A4';        // what rules recommend, even when forced differs
  reasons: string[];             // human-readable, shown in the print dialog
  warnings: string[];            // shown as a prompt requiring acknowledgement when non-empty and size === 'A4' due to extra cols
  requiresAck: boolean;          // true for rule 2 (owner: "automatically prompt a warning")
}
```

## 6. Test matrix (minimum — `src/shared/paper/__tests__/paperRules.test.ts`)

| mode | format | rows | extra cols | expected |
|---|---|---|---|---|
| rough | non-GST | 40 | 0 | A5 |
| rough | non-GST | 41 | 0 | A4, 1 page, no warning |
| rough | non-GST | 80 | 0 | A4, 1 page |
| rough | non-GST | 81 | 0 | A4, 2 pages |
| professional | non-GST | 30 | 0 | A5 |
| professional | non-GST | 31 | 0 | A4 |
| professional | non-GST | 70 | 0 | A4, 1 page |
| professional | non-GST | 71 | 0 | A4, 2 pages |
| rough | non-GST | 10 | 2 | A5 |
| rough | non-GST | 10 | 3 | A4 + warning, requiresAck |
| rough | non-GST | 50 | 3 | A4 + warning (rule 2 first) |
| rough | GST | 10 | 0 | A5 |
| rough | GST | 10 | 1 | A4 + warning, requiresAck |
| professional | GST | 31 | 0 | A4 |
| any | any | 10 | 0, forced A4 | A4, no warning |
| rough | non-GST | 60 | 0, forced A5 | A5 + cramped warning |
| rough | non-GST | 10 | 0, measuredOverflow | A4 + overflow reason |

## 7. Print-time behaviour tied to the engine
- A5 is the default page configuration in the print dialog and in Settings → Print defaults.
- The print dialog shows the decision, the reasons, and any warning; **Enter prints with the suggested size, A / 4 / 5 keys force a size.** If `requiresAck`, the dialog requires one explicit confirmation key press.
- Multi-page A4 repeats the table header row on every page and keeps footer totals on the last page, never split across pages.
- Margins are small and fixed by the template (not the printer driver default) so A5 capacity is predictable.

**Milestone 8 (Phase 79/81, planned).** Non-empty extra-only tail rows below the Final total count toward `rowCount`: paperRows = items + adjustments + non-empty tail rows (`computeBill` option `tailRowCount`). Limits stay only in `paperConstants.ts`. Print is top-aligned (Phase 73).
