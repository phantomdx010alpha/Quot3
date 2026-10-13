# UNDO_REDO_RULES — Quot3 undo, redo and related safety features

**Binding spec for Phases 17, 18, 43, 44, 29.** Added after the owner's late request ("we also need a undo, redo and related features"). Scope was inferred and is flagged in `REQUIREMENTS_ORIGINAL.md` (A6) for owner confirmation — if the owner narrows or widens it, edit this file in place and log it.

---

## 1. Layers of "undo"

| Layer | What it protects against | Phase |
|---|---|---|
| **L1 In-bill undo/redo** | Any edit made while a bill is open (typing, delete, paste, format, extra columns, format switch, party fields) | 17, 18 |
| **L2 Draft autosave / crash recovery** | App crash, power cut, accidental close | 29 |
| **L3 Recently deleted (trash) + restore** | Deleting a saved bill by mistake; "undo delete" | 43 |
| **L4 Revision history + compare + restore** | "What did this quote say before I edited it?" | 44 |
| **L5 Backups** | Disk loss, corruption, wrong bulk action | 50 |

Each layer is independent. L1 is in-memory per open bill; L3/L4/L5 are persisted.

---

## 2. L1 — In-bill undo/redo

### 2.1 What is undoable (everything that changes the bill)
- Cell text edits (all columns, including extra columns and headers)
- Rich-text formatting (bold, red, red+bold, highlight, clear)
- Total overrides and "reset to auto"
- Cell/range clear (Delete), cut, paste (including multi-row paste that created rows)
- Row insert/delete/move
- Extra column add / remove / **rename header** / mark / unmark
- **Format switch** (Alt+1/Alt+2) — switching format is undoable and restores the previous format
- Party bar fields (name, phone, transport, address, party picked from dropdown incl. its auto-fill)
- Paper-size override choice

**Not undoable (UI state only):** which cell is active, scroll position, popup open/closed, expand/collapse of address, theme change. (Selection is *restored* alongside an undo, see 2.4.)

### 2.2 Engine
- State changes go through one store (`useBillStore`, Zustand) using **Immer `produceWithPatches`**; each committed change yields `{patches, inversePatches, label, at, selectionBefore, selectionAfter}`.
- History is two stacks (undo, redo) of those entries. A new change clears the redo stack.
- **Depth limit:** 500 entries per open bill (constant `UNDO_MAX_DEPTH`); oldest entries drop silently.
- History is **per open bill and lives in memory**. It is cleared when the bill is closed. Saving does **not** clear it (you can undo past a save; the bill becomes "dirty" again).
- Calculated values (totals, GST amounts, grand totals, Sl.No) are **derived, never stored in history** — they recompute after any undo/redo.

### 2.3 Coalescing (so one Ctrl+Z is a human-sized step)
- Consecutive typing in the same cell coalesces into one entry until: the cell changes, a non-character key is pressed, or **1000 ms** of idle passes (`UNDO_COALESCE_MS`).
- Backspace runs coalesce the same way; a switch between typing and deleting starts a new entry.
- Range operations (paste, clear, multi-cell format) are always **one** entry regardless of cell count.
- Format switch and extra-column operations are always their own entry.
- Inside a cell in **Free mode** the browser's native text undo is **disabled** (`beforeinput` `historyUndo`/`historyRedo` intercepted) so there is exactly one undo system, the bill-wide one.

### 2.4 Selection restore
Each entry stores the active cell and range before/after. Undo restores the selection **before** the change and puts the cell in Append mode (caret at end); redo restores the selection **after**. The grid scrolls the restored cell into view.

### 2.5 Shortcuts (registered in `shortcuts.ts`)
| Action | Keys |
|---|---|
| Undo | Ctrl+Z |
| Redo | Ctrl+Y and Ctrl+Shift+Z |
| Undo history panel | Ctrl+Shift+H |
| Revert bill to last saved state | Ctrl+Alt+Z (asks confirmation; itself undoable) |

Ctrl+Z/Y work from any field on the Create page (grid and party bar). They never fire while a modal/prompt has focus.

### 2.6 UI
- Bottom bar: Undo and Redo buttons with disabled state, tooltip showing the next action's label ("Undo: Paste 12 cells").
- Status bar shows a brief transient message after each undo/redo ("Undone: Delete cell").
- **Undo history panel** (Ctrl+Shift+H): list of labelled entries, newest first; clicking an entry jumps the bill to that state (applies the inverse patches in order; redo stack keeps the rest). Compact side flyout, keyboard operable (Up/Down/Enter/Esc).
- Entry labels are short and human: "Typed in Item Name (row 4)", "Red+Bold (3 cells)", "Removed column 'ruby'", "Switched to GST", "Picked party 'Zakers Clothing'".

### 2.7 Interaction with other features
- **Extra-column removal** is undoable and restores header, marks and every cell's data (removal must keep the column's data in the history entry; the column is only truly gone when the bill is saved *and* the history entry has dropped, or never — data lives in the entry).
- **Format switch** never loses data (superset rows), so its undo only toggles the format id.
- **Sync (Phase 54+)**: pulled remote changes to a bill that is currently open in the editor never mutate the open bill silently; the editor shows a banner "This bill changed on another branch" with *Keep mine / Load theirs*. Loading theirs clears L1 history for that bill.
- **Dirty tracking**: the bill is dirty iff the current state differs from the last saved snapshot (deep-equal on the persisted fields), so undoing back to the saved state clears the dirty flag and the Esc prompt will not appear.

---

## 3. L2 — Draft autosave (Phase 29)
Covered in `PHASES.md` Phase 29. Rules relevant here: autosave runs debounced (≈2 s after the last change) **off** the keystroke path; one draft row per open bill session; on next launch, if drafts exist, the Dashboard shows "Recover unsaved bill" with the party name and time; recovering opens the bill with a **fresh** L1 history. A draft is deleted when its bill is saved or discarded.

---

## 4. L3 — Recently deleted (Phase 43)
- Deleting a saved bill is a **soft delete** (`deleted_at` set; a tombstone for sync) — never a hard delete from the UI.
- **Recently deleted** view (History page tab/filter, shortcut Ctrl+Shift+D): list with deleted-at time, **Restore** (Enter) and **Delete forever** (needs confirmation; also gated by a typed confirmation for "Empty trash").
- Immediately after a delete, a transient toast offers **Undo delete (Ctrl+Z on the History page)** for ~10 s.
- Auto-purge: soft-deleted bills older than **30 days** are purged (constant `TRASH_RETENTION_DAYS`); purge writes an audit row. Retention is configurable in Settings.
- Restoring a bill keeps its original PO number; if a sync tombstone already propagated, restore creates a new revision that supersedes it (higher `revision`).

---

## 5. L4 — Revision history + compare + restore (Phase 44)
- Every **Save** of an existing bill stores the previous persisted state as a revision (`bill_revisions` table: bill id, revision number, full snapshot JSON, saved_at, saved_by_branch). Revision 1 is the first save.
- Retention: keep the **last 50** revisions per bill (`REVISION_MAX_PER_BILL`).
- UI: from the Create page (editing a saved bill) or History → "Revisions" (Ctrl+Shift+V): list of revisions with time and totals; selecting one shows a **side-by-side or inline diff** (rows added / removed / changed; qty, rate, total, extra-col cell changes; party field changes; format/paper changes).
- **Restore this revision** loads it into the editor as an **unsaved change** (so the normal Save/Discard prompt and L1 undo apply) — it never overwrites silently.
- Diff is a pure function in `src/shared/diff/billDiff.ts`, Vitest-covered.

---

## 6. L5 — Backups (Phase 50)
Automatic daily backup + manual backup + restore, using the SQLite backup API. Restore always makes a safety backup of the current DB first. Not detailed here; see Phase 50.

---

## 7. Required tests
1. Type 5 chars quickly → one undo removes all 5; type, pause > 1 s, type → two undos.
2. Paste 3×3 range → single undo restores previous values and row count.
3. Remove an extra column with data → undo restores header, marks, data.
4. Switch GST → non-GST → undo → format id restored, row data untouched.
5. New edit after undo clears redo.
6. Undo back to saved snapshot → dirty = false.
7. Depth limit: 501st entry drops the oldest, no crash.
8. Derived totals correct after every undo/redo (property test over random edit sequences: apply N random edits, undo all, state equals initial; redo all, state equals final).
9. Soft delete → restore returns identical bill (deep-equal) with same PO number.
10. billDiff: add/remove/change row, extra col change, party change, format change.

---

## 8. Decisions recorded
- **D-U1** One undo system only (bill-wide); native per-cell browser undo is suppressed.
- **D-U2** History survives Save (can undo past a save); cleared on bill close.
- **D-U3** Depth 500, coalesce window 1000 ms — constants, owner-tunable.
- **D-U4** Trash retention 30 days; revision cap 50 — constants, owner-tunable in Settings.
- **D-U5** Restoring a revision never overwrites silently; it opens as an unsaved change.
