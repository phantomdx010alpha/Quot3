# KEYBOARD_CELL_RULES — Quot3 grid navigation & editing

**Binding spec for Phases 10, 11, 12, 15, 16, 17, 28, 30, 67.** It translates the owner's "tricky part" (Requirements Part A, "now we talk in details about the control and ui") into an explicit state machine. The navigation logic is a **pure reducer** in `src/shared/nav/cellNav.ts` (no DOM) so every rule below is a Vitest case. The DOM layer (Phase 11) only forwards key events to the reducer and applies the resulting caret/selection effects.

If an edge case below is not covered, choose the behaviour that (a) never traps the user in a cell, (b) never destroys existing content without an explicit action, (c) matches Excel when it does not conflict with (a)/(b) — then record the choice in `PHASE_STATUS.md` and add a test.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Active cell** | The one cell that has focus. Exactly one at all times while the grid is focused. |
| **Append mode** (owner calls it "locked") | Default state of an active cell. The caret is parked at the **end** of the cell's content. Typing **appends**. Existing content is never replaced by typing. |
| **Free mode** (owner calls it "unlocked") | Caret can be anywhere; normal text editing (insert in middle, select, delete forward, etc.). |
| **Range selection** | Excel-style multi-cell selection (Shift+arrows across cells, or mouse drag). Used for copy, paste, clear, format. |
| **Edge** | Caret at position 0 (start edge) or at the end of the content (end edge). |

Empty cells: start/end are the same position; an empty cell is simply in append mode with nothing in it. **An empty cell never traps focus** — every movement key leaves it immediately.

---

## 2. The core rule (do not break this)

> Moving onto a cell that has content puts the caret at the **end** of that content, in **append mode**. Typing adds to the end. It does **not** overwrite what is there (unlike Excel).

This applies on arrival by any route: arrows, Tab, Shift+Tab, Enter, Shift+Enter, Ctrl+arrows, mouse click on a cell *border/padding*, programmatic focus after Save/New row, and after undo/redo. The only way content is replaced is an **explicit** action: Delete in append mode (§4), selecting text then typing (free mode), range-clear, paste over a range, or Undo.

---

## 3. Mode transitions

| From | Trigger | To | Caret / notes |
|---|---|---|---|
| (any cell, arrival) | any navigation | Append | caret at end |
| Append | **Left arrow pressed twice in a row** (`LEFT_UNLOCK_PRESSES = 2`) | Free | 1st press: arms (no caret move, subtle visual hint). 2nd consecutive press: unlocks and moves caret one char left of the end. Any other key between them disarms. |
| Append | **mouse click inside the text** | Free | caret at click point |
| Append | **F2** | Free | caret stays at end (Excel behaviour) |
| Append | **Home**, **Ctrl+Left**, **Shift+Left**, **Shift+Home**, **Ctrl+Shift+Left** | Free | immediate unlock; the key then performs its normal action (caret to start / previous word / extend selection) |
| Append | double-click | Free | selects the word under the pointer |
| Free | caret at end edge + **Right arrow** | Move to the cell on the right | arrives in Append mode |
| Free | **Tab / Shift+Tab / Enter / Shift+Enter / Up / Down** | Move to next cell | arrives in Append mode; edits are kept |
| Free | **Esc** | Append (same cell) | content **kept** (see decision D-K2); caret to end |
| Append | **Esc** | (not handled by the cell) | bubbles up to page → unsaved-changes guard (§6) |

Rationale for 2 presses: the owner's wording is "press left arrow twice so the cell becomes unlocked". `LEFT_UNLOCK_PRESSES` is a single constant in `src/shared/nav/cellNav.ts` so the owner can tune it (e.g. to 1) without touching logic.

---

## 4. Key map per mode (default; single-cell, no range selection active)

| Key | Append mode | Free mode |
|---|---|---|
| Printable character | append at end | insert at caret (replaces selected text if any) |
| Backspace | delete last character | normal |
| **Delete** | **clear the whole cell** (forward-delete is meaningless at the end edge, so it is repurposed) — undoable | normal forward delete |
| Left | arm / unlock per §3 | move caret left; at start edge does **nothing** (see D-K3) |
| Right | move to next cell on the right | move caret right; at end edge → move to next cell |
| Up / Down | move to cell above / below | move to cell above / below (cells are single-line) |
| Tab / Shift+Tab | next / previous cell (wraps to next/previous row; Tab past the last column of the last row focuses the first column of a fresh trailing row) | same |
| Enter / Shift+Enter | cell below / above (commit) | same |
| Home | unlock, caret to start | caret to start |
| End | no-op (already at end) | caret to end |
| Ctrl+Home / Ctrl+End | first cell of grid / last used cell | same |
| PageUp / PageDown | move up/down by one visible page | same |
| Ctrl+Up / Ctrl+Down | jump to first / last row of column (Excel-style data-edge jump) | same |
| F2 | → Free | no-op |
| Esc | bubbles to page guard | → Append |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | undo / redo (Phase 17/18) | undo / redo |
| Ctrl+B | toggle bold on whole cell (item-name cells) | toggle bold on selection (or whole cell if no selection) |
| Ctrl+Shift+R | **Red+Bold** in one press: whole cell | **Red+Bold** on the selected text (or whole cell if no selection) |
| Ctrl+H | highlight cell (legacy shortcut kept) | same |
| Ctrl+Shift+C | clear formatting | clear formatting |
| Ctrl+C / Ctrl+X / Ctrl+V | cell/range copy / cut / paste (§5) | text-level copy/cut/paste inside the cell |
| Shift+Up/Down | begin/extend **range selection** | same |
| Ctrl+A | select all cells in grid | select all text in cell; press again → all cells |

Numeric cells (qty, rate, total, GST %) follow the same modes; they accept only `0-9 . -` (and a leading `-` for adjustments/discounts); invalid characters are ignored silently. Numeric cells in Free mode with caret at the end edge also respond to Right → next cell.

---

## 5. Range selection and clipboard

- **Range selection** begins with Shift+Up/Down (or Shift+Left/Right when the active cell is at the matching edge), or a mouse drag across cells. A visible range outline is drawn; the active cell stays the anchor.
- **Copy** a range → clipboard gets `text/plain` TSV (so Excel pastes cleanly) and a Quot3 JSON flavour (so cell formatting survives a paste *inside* Quot3).
- **Paste** — if the clipboard is TSV from Excel or from Quot3: fill cells starting at the active cell, expanding downward/rightward; new rows are created as needed; non-numeric text pasted into a numeric cell is rejected for that cell and reported once in the status bar. Paste never silently drops rows.
- **Delete / Backspace on a range** clears all cells in the range (undoable as a single step).
- Pasting multi-line text into a single item-name cell splits into rows only when the clipboard is recognisably TSV with ≥ 2 rows; otherwise newlines become spaces.

---

## 6. Escape and the page-level guard (A5 in Requirements Part B)

1. Esc in **Free** mode → Append mode, same cell, content kept.
2. Esc in **Append** mode (or with nothing being edited) → the Create page asks: **Save / Discard / Cancel**.
   - **Save** with no party name → blocked with a prompt to enter the party name (focus jumps to it), then continues.
   - **Discard** → leaves; a pristine empty bill leaves with no prompt at all.
   - **Cancel** → back to the grid, same active cell.
3. The same prompt appears when leaving an *already saved* bill that has unsaved changes ("Save changes?").
4. Drafts autosave silently in the background regardless (Phase 29) — the prompt is about the bill, not about crash recovery.

---

## 7. Party/detail bar keyboard flow (Phases 25–26)

- Fields in order: Party name → Phone → Transport → (Address pull-down) → first grid cell. Right arrow at the end edge of a field, or Tab, moves to the next field; Shift+Tab goes back; from Transport, Tab/Enter drops into the grid at row 1 / Item Name.
- Party name field shows a fuzzy-match dropdown; Up/Down choose, Enter selects and **auto-fills** phone/transport/address, Esc closes the dropdown only.
- Typing a name that matches nothing is valid — it is a new party; Right arrow/Tab continues to the optional fields. On Save only the **new** party (with whatever details were entered) is added to the parties list.
- Address is collapsed by default; **Alt+Down** (or clicking the chevron) expands it, **Esc/Alt+Up** collapses.

---

## 8. Global shortcuts (**FROZEN in Phase 30**, registered in `src/shared/shortcuts.ts`; guarded by `shared/__tests__/shortcuts.test.ts` "Phase 30: frozen KB section 8 map" — change a row only with owner approval)

*Phase 30 change: Ctrl+Shift+P is Print — Professional (this table); the Phase 25 action "Focus party name" moved from Ctrl+Shift+P to **Ctrl+Shift+F**.*

| Action | Keys | Note |
|---|---|---|
| GST format | Alt+1 | owner-specified |
| Non-GST format (default) | Alt+2 | owner-specified |
| Next/prev custom format | Alt+3.. | future formats |
| Command palette | Ctrl+K | |
| Save bill | Ctrl+S | |
| Print — Rough | Ctrl+P | |
| Print — Professional | Ctrl+Shift+P | |
| Copy image — Rough | Ctrl+I | legacy key kept |
| Copy image — Professional | Ctrl+Shift+I | |
| TSV copy (whole bill) | Ctrl+Shift+T | |
| Show units summary | Ctrl+U | |
| Mark cell (new independent header) | Ctrl+M | |
| Show marked calculations | Ctrl+Shift+M | |
| Add extra column / remove extra column | Ctrl+Alt+= / Ctrl+Alt+- | |
| New bill | Ctrl+N | |
| Go: Dashboard / Create / History / Customers / Settings | Ctrl+0 / Ctrl+1 / Ctrl+2 / Ctrl+3 / Ctrl+4 | |
| Shortcut cheat-sheet | F1 or Ctrl+/ | |

Alt+1 / Alt+2 are format switches (owner-specified). The legacy app used Alt+1 = Default, Alt+2 = GST, Alt+3 = Manual — **do not carry the legacy mapping over**.

---

## 9. Required test cases (Vitest, `src/shared/nav/__tests__/cellNav.test.ts`)

1. Arrive on a filled cell by Right/Left/Up/Down/Tab/Enter → mode Append, caret = end.
2. Type in Append on a filled cell → content is appended; original text intact.
3. Left, Left in Append → Free, caret = end-1. Left, X, Left → still Append (disarmed).
4. Free mode: Right until end edge, Right again → moves to next cell, arrives Append.
5. Empty cell: every arrow/Tab/Enter leaves it; no key press is ignored or trapped.
6. F2 → Free at end. Esc in Free → Append, content kept. Esc in Append → emits `PAGE_ESCAPE` effect.
7. Delete in Append clears cell; Delete in Free is forward-delete.
8. Tab at last column wraps to next row first column; Tab past last row creates/focuses a trailing blank row.
9. Home/Ctrl+Left/Shift+Left in Append → Free with the correct caret/selection effect.
10. Ctrl+Up/Down jump behaviour on filled and empty runs.
11. Numeric cell rejects invalid characters.
12. Range selection extend/shrink; Delete clears the range; arrival after range-clear is Append.

---

## 10. Decisions recorded (change only with owner approval)

- **D-K1** First Left press in Append mode **arms** without moving the caret; the second consecutive press unlocks. (Owner: "press left arrow twice".)
- **D-K2** Esc in Free mode **keeps** content (it does not revert like Excel). Rationale: typing in Append can never destroy content, there is no replace-on-type hazard to cancel, and Ctrl+Z exists.
- **D-K3** Left at the start edge in Free mode does nothing (it does **not** jump to the previous cell) — moving left across cells uses Shift+Tab or the Up/Down/Left keys from Append mode on an empty cell. *Open for owner confirmation*: if the owner wants "Left at start edge → previous cell" (mirror of Right at end edge), flip `LEFT_EDGE_LEAVES_CELL` in `cellNav.ts` to `true`.
- **D-K4** Delete in Append mode clears the entire cell (repurposed forward-delete).

---

## 10b. Calculator drawer keys (Phase 83, final)
Alt+C shows / hides the calculator drawer (conflict test passed, key unchanged from the proposal). Alt+Shift+C switches between the calculator and the % calculator (opens a closed drawer). In the drawer: Enter = `=`, Esc clears the text, Esc on an empty field closes and returns focus to the previous cell.

Phase 86: Ctrl+Shift+L opens "Import legacy bills" from any page (conflict test passed; also in the palette). In the dialog Tab / Shift+Tab move between the buttons and the clash dropdowns, Enter presses the focused button (the primary button is focused first), Esc goes back / closes (Esc while reading cancels the read; the write step cannot be interrupted).

## 11. Smooth arrow navigation setting (Milestone 8, Phases 74–75)

Setting `nav.smoothArrows`, default **ON**. Effective rule: `leftEdgeLeavesCell = smooth ? true : LEFT_EDGE_LEAVES_CELL`, and the two-press unlock (`LEFT_UNLOCK_PRESSES`) is skipped when ON.
- **ON, not editing:** Left/Right jump straight to the neighbouring cell with the caret at the end (Append mode). No arming press.
- **ON, F2 edit mode:** Left/Right move letter by letter. Leaving edit mode: Esc / Enter / Tab, AND Left at the very start / Right at the very end of the text jumps to the neighbouring cell (owner: "YES BOTH").
- **OFF:** exactly today's behaviour (D-K1, D-K3 unchanged).
- Up/Down are unchanged. Calculator panel keys are separate (`CALCULATOR_PANEL_RULES.md`).

Decisions: **D-K5** smooth arrows setting default ON. **D-K6** with it ON, D-K1 (arm then unlock) and D-K3 (Left at start does nothing) do not apply. **D-K7** edit-mode edge jumps apply only with the setting ON.

---

## 12. Milestone 9 additions (Phases 94, 95, 104) — Esc/navigation implemented in Phase 94 (stack `[dashboard, page(, bill)]`, `navPush` `returnToCurrent`); rest PLANNED

**Esc and page navigation [A].** Dashboard is the root and the back-stack never goes behind it. Esc on Dashboard: nothing. Esc on History / Customers / Settings: Dashboard. Esc on a bill opened from History: History. Esc on Create: the Phase 27/28 guard (Save / Discard / Cancel) only when there is real unsaved work, then Dashboard. Esc inside cell edit, dropdowns and dialogs keeps closing only that layer first (section 6 unchanged).

**Down in extra columns (D-K10) [A] - IMPLEMENTED Phase 104** (`GridShape.isExtraCol`; the added row is display-only, the typed content is the undo step). In an EXTRA column only, Down on the bottom-most editable row adds an empty extra-only tail row and moves into it (one undo step; trimmed on save if still empty). In every other column Down at the last row still does nothing. Works with `nav.smoothArrows` ON and OFF.

Decisions: **D-K8** Dashboard is the navigation root. **D-K9** the unsaved-work guard asks only when work is genuinely unsaved. **D-K10** extra-column Down extends the rows.

---

## 13. Items page keys (Milestone 10, Phases 112–114) — PLANNED [A]

Esc on the Items page goes to Dashboard (section 12 model). Tab / Shift+Tab (and Alt+1 / Alt+2 / Alt+3, to be checked in the shortcut-conflict test) move between the Groups, Spellings and Sales windows; Up/Down move in a list; Enter on a suggestion confirms the merge; Enter on a sales row opens that bill in View and Esc from the bill returns to the same Items selection. Exact keys are fixed in Phase 112 and recorded here. Decision **D-K11**: opening a bill from Items returns to Items, not to the page before it.

---

## 14. Milestone 11 additions (Phases 119, 122, 124) — PLANNED [A]

**Modifier-only keys (D-K12):** pressing Ctrl, Shift, Alt or Meta alone never changes focus, selection, mode or range; Ctrl+C / Ctrl+X / Ctrl+V work with a range, a cell, Append and Free modes. **[Phase 119 as built]** `navReduce` returns the state untouched for any key in `MODIFIER_ONLY_KEYS`; the controller ignores them before anything else. Ctrl+C/X/V use the native clipboard events and, if none arrives within `CLIPBOARD_FALLBACK_MS` (60 ms), the bridge (`clipboard:writeTsv` / `clipboard:readGrid`); Free mode with no range stays native text copy/paste.
**Delete row (D-K13):** with a row selected (click its row number or Shift+Space), Delete removes the item cells of that row, the rows below move up, extra-column cells stay on their row positions; one undo step. Delete on a single cell keeps D-K4 (clears the cell). Adjustment and total rows are not row-deleted. **[Phase 122 as built]** Row selection: click the Sl.No cell, Ctrl+Space (any cell) or Shift+Space (number cells only; in text cells it stays a typed space). It is a full-width range flagged as a row selection; only then does Delete remove rows (Ctrl+A / plain ranges still clear cells). Rule in `shared/rows/deleteRows.ts`.
**Reorder (D-K14):** Alt+Up / Alt+Down move the active item row; extras stay on their positions; one undo step; final keys decided by the shortcut-conflict test. **[Phase 123 as built, model only]** `shared/rows/moveRows.ts` + `billStore.moveRow(rowId, 'up'|'down'|'top'|'bottom')`; items never move below the last filled row; **[Phase 124 as built]** keys are **Alt+Shift+Up / Alt+Shift+Down** (plain Alt+Up/Down are the party-address keys); top / bottom are palette-only; the cursor follows the moved item; no drag handle yet.
**Create entry (D-K15):** every way into Create opens a clean bill; Esc on Create keeps the Save/Discard/Cancel guard.
