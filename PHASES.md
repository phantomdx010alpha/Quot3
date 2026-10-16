# PHASES — Quot3 (Milestone 15 = Phases 158–164 appended at the bottom; 144 phases; Phases 70–91 = Milestone 8, 92–106 = Milestone 9, 107–115 = Milestone 10, 116–127 = Milestone 11, 128–143 = Milestone 12, 144 = Milestone 13, all executed BEFORE Phase 69)

**Edit in place** rather than regenerating. Never reorder or renumber a completed phase. If a phase proves too large, split it and renumber forward; record that in `PHASE_STATUS.md`.

Each phase is sized to be completable — read docs, implement, verify, update status, re-zip — inside one Claude.ai session. Every phase ends with the project **type-checking** (`npm run typecheck`), its tests passing (`npm test`), and `npm run dev` still launching the Electron app. "How to verify" is never optional, but follow the precedence rule in `CLAUDE_MUST_READ.md`: do the phase's verify step, not a broader sweep.

Format: **Goal · Depends on · In scope · Out of scope · Key files · How to verify**
Rule files named in a phase (`KB` = `KEYBOARD_CELL_RULES.md`, `UR` = `UNDO_REDO_RULES.md`, `PE` = `PAPER_ENGINE_RULES.md`, `XU` = `EXTRA_COLS_UNITS_RULES.md`, `RQ` = `REQUIREMENTS_ORIGINAL.md`, `DM` = `docs/DATA_MODEL.md`, `SY` = `docs/SYNC_POSTBOX_SPEC.md` (v1, replaced by M12), `SS` = `docs/SYNC_SHARED_STORE_SPEC.md`, `DT` = `docs/design/DESIGN_TOKENS.md`) are binding for that phase.

**Honesty rule for "How to verify":** where the sandbox has no display or printer, the phase says what is proven by tests and what is a *standing gap for the owner to confirm locally*. Log gaps; never claim what wasn't run.

---

## MILESTONE 1 — Foundation (Phases 1–8)
*Exit criteria: secure Electron + React + TS app launches; tokens/themes and the shell exist; SQLite + migrations work; the calculation, units and format engines exist as tested pure code.*

---

## Phase 1 — Repo scaffold, toolchain, native module proof
**Goal:** A runnable electron-vite + React + TypeScript + Tailwind v3 project exists, the pinned dependencies are really installed, and `better-sqlite3` is proven to load inside Electron.
**Depends on:** Phase 0 (these docs).
**In scope:** `npm init`; install **only** the packages `DEPENDENCY_VERSIONS.md` assigns to Phases 1–5 (electron, electron-vite, vite, plugin-react, typescript, react, react-dom, tailwind/postcss/autoprefixer, vitest, @types/*, @electron/rebuild, better-sqlite3, zod, decimal.js, zustand, immer, phosphor); `.npmrc` (`save-exact=true`), `.editorconfig`; configs per `PROJECT_STRUCTURE.md`; npm scripts `dev`, `build`, `typecheck`, `test`; a placeholder window "Quot3 — loading"; `postinstall` native rebuild; a throwaway main-process check that opens `better-sqlite3` `:memory:` and logs `select sqlite_version()`; fill the **Install-test log** in `DEPENDENCY_VERSIONS.md` with what really happened and adjust pins in place if anything failed.
**Out of scope:** real UI, IPC, DB schema, any feature.
**Key files:** `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `vitest.config.ts`, `src/main/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`.
**How to verify:** `npm install` completes; `npm run typecheck` and `npm test` (one trivial test) pass; if a display/xvfb exists run `npm run dev` and confirm the window + the sqlite version log, otherwise `electron-vite build` succeeds and the sqlite check runs under `electron` headless or is logged as a standing gap. **If the native rebuild fails, this is a blocker — record it and stop.**

---

## Phase 2 — Secure shell, LocalAppData, typed IPC skeleton
**Goal:** The Electron shell is hardened and stores data under `%LOCALAPPDATA%\Quot3\`; a typed Zod-validated IPC/bridge skeleton exists.
**Depends on:** 1.
**In scope:** `app.setPath('userData', %LOCALAPPDATA%\Quot3)` **before** `whenReady` (fallback `~/.quot3` on non-Windows dev machines); folder creation (`backups`, `themes`, `logs`, `assets`); single-instance lock; BrowserWindow with `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP, navigation/`window.open` guards; preload exposing `window.quot3` with `app.getInfo` and `app.openDataFolder`; `ipc/envelope.ts` and `ipc/register.ts`; logger with rotation; a Vitest "import boundaries" check enforcing the rules at the bottom of `PROJECT_STRUCTURE.md`; `window.quot3` typing shared to the renderer.
**Out of scope:** any real feature channels.
**Key files:** `src/main/{index,window,paths,logger}.ts`, `src/main/ipc/{register,envelope}.ts`, `src/preload/index.ts`, `src/renderer/types/bridge.d.ts`.
**How to verify:** tests for envelope + boundaries pass; typecheck passes; (display) the placeholder page shows data dir + version fetched through `window.quot3.app.getInfo()`; confirm DevTools `typeof require === 'undefined'` and `typeof process === 'undefined'` in the renderer (or log as a gap).

---

## Phase 3 — Design tokens, neumorphic primitives, theme loader
**Goal:** The whole visual language exists as CSS variables; primitives exist; themes can be swapped, including drop-in JSON themes.
**Depends on:** 2. **Read:** `DT`.
**In scope:** `tokens.css` with the **Navy Ember** default (deep navy + light red) and a light **Paper** theme; `neumorph.css` utilities; `components/ui/` (Surface, Button, IconButton, Input, Select, Badge, Kbd, Dialog/ConfirmDialog, Toast, EmptyState, Tooltip); Phosphor wiring (light/bold/duotone); `/dev/design-preview` page; `themeService` + `themes:list/load/reload` IPC reading `%LOCALAPPDATA%\Quot3\themes\*.json` with whitelist + sanitising + clamping per `DT`; theme persisted in settings (in-memory until Phase 5, then DB).
**Out of scope:** navigation shell, grid.
**Key files:** `src/renderer/styles/{tokens,neumorph,index}.css`, `src/renderer/components/ui/*`, `src/renderer/pages/dev/DesignPreview.tsx`, `src/main/services/themeService.ts`, `src/shared/theme/validateTheme.ts` (+ tests).
**How to verify:** Vitest for theme validation (rejects `url()`, unknown tokens, out-of-range `--row-height`); (display) design-preview shows all primitives at both themes; editing one token reskins everything; drop a custom theme JSON in the themes folder → "Reload themes" applies it. No hardcoded colors (grep for `#` hex literals in `components/`).

---

## Phase 4 — App shell, dashboard-first navigation, hotkey registry, command palette shell
**Goal:** The permanent navigation structure exists and is fully keyboard-reachable; the single shortcut registry exists.
**Depends on:** 3.
**In scope:** in-memory router with history/back; `AppShell` with a compact left **SideRail** (Dashboard, Create, History, Customers, Settings) — always visible on work screens; Dashboard placeholder with four large entry cards; `shortcuts.ts` registry + `useHotkeys` hook; **Ctrl+K command palette** (fuzzy list generated from the registry); F1 / Ctrl+/ cheat-sheet overlay; global nav shortcuts (Ctrl+0..4); Esc/back stack; focus management rules (visible focus ring, no mouse-only controls).
**Out of scope:** real page content, Create page.
**Key files:** `src/shared/shortcuts.ts` (+ tests), `src/renderer/router/*`, `components/layout/{AppShell,SideRail,CommandPalette,ShortcutSheet}.tsx`, `hooks/useHotkeys.ts`, `pages/Dashboard.tsx` (placeholder).
**How to verify:** tests for `matchShortcut` (scopes, conflicts — a test fails if two shortcuts collide in one scope); (display) navigate all pages by keyboard only; Ctrl+K finds and runs "Go to History"; cheat-sheet lists every registered shortcut.

---

## Phase 5 — SQLite, Drizzle, migrations, settings storage
**Goal:** The database exists exactly as `DM` specifies and is safe to evolve.
**Depends on:** 1, 2. **Read:** `DM`.
**In scope:** `connection.ts` (pragmas WAL/foreign_keys, `user_version` guard, automatic **pre-migration backup**), `schema.ts` for **all** tables in `DM` (including those used by later phases, so the schema is stable early), drizzle-kit generated migration `0001`, a `db` test helper (temp-file DB per test), `settingsService` + `settings:*` IPC, `branches` seeding (one local branch with default prefix `Q3-`), PO counter helper function (not yet used by UI).
**Out of scope:** bill save logic, any UI beyond a dev "DB info" line.
**Key files:** `src/main/db/{connection,schema}.ts`, `src/main/db/migrations/*`, `src/main/services/settingsService.ts`, `src/main/ipc/settings.ts`.
**How to verify:** Vitest: migrations apply to an empty DB, re-open is a no-op, newer-`user_version` DB is refused for writes, settings round-trip, PO counter increments atomically in a transaction, FK cascade (`bill_rows`) works. `npm run typecheck` passes.

---

## Phase 6 — Money and calculation engine (pure)
**Goal:** All bill math exists as pure, exhaustively tested code. **Depends on:** 1. **Read:** `MASTERPLAN.md` §8, §11.
**In scope:** `money.ts`; `classifyRow`; `rowCalc`; `billTotals` (including adjustment grouping, display-row generation, Sl.No rule, paper row counts, optional round-off line); shared types; fixtures (legacy bill from the screenshot, adjustment bills, GST bills, override bills, decimal edge cases like `0.1+0.2`, 1e6-row sums); property tests (footer = sum of rows, order-independence of totals).
**Out of scope:** formats registry (stub `FormatDef` types only), UI.
**Key files:** `src/shared/{money,types}.ts`, `src/shared/calc/*`, `src/shared/__fixtures__/*`, tests.
**How to verify:** `npm test` — all calc tests pass, including: item with qty+rate; only qty; only rate; override wins; adjustment (name + total only) moves to adjustment block; negative adjustment; GST from overridden total; Sl.No skips adjustments/partials; `0.1 + 0.2` style cases exact.

---

## Phase 7 — Units parser and extra-column summary engine (pure)
**Goal:** `parseUnits` and `summarizeUnits` exist, tested against the owner's worked example. **Depends on:** 6. **Read:** `XU`.
**In scope:** both functions; fixture `legacy_ruby_tomato`; Mark segment logic (segments, unmark merging); every row of the §2 examples table as a test; fractional units; stray bracket handling.
**Out of scope:** any UI.
**Key files:** `src/shared/units/*`, `src/shared/units/__tests__/*`.
**How to verify:** tests prove `ruby = 12`, marked `idk bruhh = 55`, `tomato = 7` from the legacy fixture, plus all parse examples.

---

## Phase 8 — Format registry and bill data model
**Goal:** Formats are data; the superset row model and extra-column definitions are final. **Depends on:** 6, 7.
**In scope:** `registry.ts` with `non_gst` (default, Alt+2) and `gst` (Alt+1) per `MASTERPLAN.md` §10 and assumption A1; `registerFormat` proving a third dummy format works in a test with **zero** other code changes; `createEmptyBill()`; `normalizeBill()`; conversions between `Bill` and DB row shapes (serialiser/deserialiser with Zod); verification that switching `formatId` leaves `rows` byte-identical.
**Out of scope:** UI, persistence calls.
**Key files:** `src/shared/format/*`, `src/shared/billModel.ts`, tests.
**How to verify:** tests: GST columns are `slNo,name,qty,rate,total,gstRate,gstAmt,amount`; non-GST are `slNo,name,rate,qty,total`; round-trip serialise/deserialise equality; dummy format registers and drives `computeBill` unchanged; grep proves no `=== 'gst'` style branching exists in `src/`.

---

## MILESTONE 2 — The Grid (Phases 9–24)
*Exit criteria (Phase 24 gate): the bill grid has Excel-class navigation and editing with the owner's append-caret rule, rich text, clipboard, undo/redo, adjustments, formats, extra columns, overflow handling — and recorded performance numbers against the 240 Hz budget.*

---

## Phase 9 — Grid core render
**Goal:** A compact, flat, high-contrast grid renders a bill from the format registry. **Depends on:** 3, 8.
**In scope:** `BillGrid` rendering derived display rows (`computeBill`) with columns from the active format + extra columns; sticky header; 26px rows; trailing blank entry rows (always ≥ 3 empty rows after the last used row); per-row memoisation and per-cell store selectors (the architecture of `MASTERPLAN.md` §9); billStore skeleton (Zustand); dev page `/dev/grid` seeded with the legacy fixture and a 80-row fixture; `grid.css` using tokens only.
**Out of scope:** editing, navigation, formats switching UI.
**Key files:** `components/grid/{BillGrid,GridRow,GridCell,ColumnHeader}.tsx`, `stores/billStore.ts`, `styles/grid.css`, `pages/dev/GridDev.tsx`.
**How to verify:** (display) dev grid shows ≥ 20 rows at 1366×768; render-count test (React Profiler or counter) proves changing one cell re-renders one cell + footer only; typecheck/tests pass.

---

## Phase 10 — Cell navigation state machine (pure)
**Goal:** `cellNav.ts` implements `KB` completely as a pure reducer. **Depends on:** 8. **Read:** `KB` (all).
**In scope:** `NavState`, `navReduce`, `LEFT_UNLOCK_PRESSES`, `LEFT_EDGE_LEAVES_CELL`, all key rules incl. Tab wrapping, trailing-row creation effect, Ctrl+arrows, PageUp/Down, Home/End, range extend, Esc handling, Delete semantics, numeric character filtering predicate; **all 12 required test cases of `KB` §9** plus extras.
**Out of scope:** DOM.
**Key files:** `src/shared/nav/cellNav.ts`, `src/shared/nav/__tests__/cellNav.test.ts`.
**How to verify:** `npm test` — the full KB §9 list passes.

---

## Phase 11 — Cell editing modes in the DOM (append caret / free / F2)
**Goal:** The owner's "tricky part" works for real in the grid. **Depends on:** 9, 10. **Read:** `KB`.
**In scope:** one `keydown`/`beforeinput`/`mousedown`/`dblclick` pipeline on the grid root forwarding to `navReduce` and applying effects directly to the DOM (focus, caret placement, mode class, armed-left hint); `NameCell` (contenteditable, plain text for now) and `NumCell`; arrival always in Append with caret at end; typing never replaces content in Append; mouse click → Free at click point; F2; Esc rules; Delete clears; native browser text-undo suppressed (`historyUndo/Redo` prevented) in preparation for Phase 17; visible mode indicator in the status line ("APPEND" / "EDIT").
**Out of scope:** rich text, clipboard, undo.
**Key files:** `components/grid/{NameCell,NumCell,useGridKeys}.ts(x)`, `stores/billStore.ts` (commit text).
**How to verify:** (display) walk the KB §9 scenarios by hand and by Playwright-Electron smoke if a display exists; **otherwise** unit-test the DOM layer with jsdom/happy-dom where feasible and list "real caret behaviour in Chromium" as a standing gap for the owner to confirm — this phase is the one the owner will test hardest, so say precisely what was and wasn't run.

---

## Phase 12 — Numeric cells and Sl.No auto rule
**Goal:** Rate/Qty/Total/GST % cells accept only valid input; Sl.No updates automatically. **Depends on:** 11, 6.
**In scope:** numeric filtering (digits, one `.`, leading `-` only in Total), paste sanitising for numeric cells, qty/rate negative rejection (D-M7), Sl.No column rendering from `computeBill().slNo` (owner's rule), keyboard-only entry flow (type name → Tab → rate → Tab → qty → Tab → total auto), auto trailing rows.
**Out of scope:** override UI (Phase 13).
**Key files:** `components/grid/NumCell.tsx`, `shared/money.ts` additions.
**How to verify:** tests for filters; (display) typing a name + qty or rate numbers the row; clearing both un-numbers it.

---

## Phase 13 — Auto-calculation wiring and total override
**Goal:** Totals recalculate incrementally; the Total cell is overridable with a visible marker. **Depends on:** 12.
**In scope:** store commit → recompute only the edited row + footer (incremental), override set when the user edits an auto total, override marker + "reset to auto" (key `Ctrl+Backspace` on a total cell and a context action), tooltip showing the auto value, footer total live, GST columns computing in the GST format (visible once Phase 20 adds the switch; testable now via dev toggle).
**Out of scope:** adjustments (Phase 19).
**Key files:** `stores/billStore.ts`, `components/grid/TotalCell.tsx`.
**How to verify:** tests: changing qty updates total and footer without re-running other rows (spy on `calcRow`); override survives qty change; reset restores auto. Perf note recorded.

---

## Phase 14 — Rich-text runs engine (pure)
**Goal:** The run model and operations exist as pure tested code. **Depends on:** 8.
**In scope:** `runs.ts` per `API_CONTRACTS.md`; `normalize`, `toggleBold` (partial/whole/mixed selections), `setRedBold`, `setRed`, `setHighlight`, `clearFormat`, `applyEdit` (insert/delete keep the style of the neighbouring run), Unicode/surrogate safety, idempotence property tests.
**Key files:** `src/shared/richtext/*`.
**How to verify:** `npm test`; property test: random edits then `normalize` equals canonical form, plain text preserved.

---

## Phase 15 — Rich-text editing UI (bold, Red+Bold, colours, highlight, clear)
**Goal:** Item names support Excel-like per-letter/word formatting. **Depends on:** 11, 14.
**In scope:** serialise contenteditable ⇄ runs; **Ctrl+B** bold; **Ctrl+Shift+R** one-press Red+Bold on the selection (whole cell if none); plain red and colour options from a compact palette (Ctrl+Shift+K opens palette); **Ctrl+H** highlight cell; **Ctrl+Shift+C** clear formatting; toolbar buttons mirroring each (Red+Bold, Bold, Clear, Highlight); formatting preserved through edits; formatting exported to print runs.
**Out of scope:** formatting in numeric cells (not required).
**Key files:** `components/grid/NameCell.tsx`, `components/create/FormatToolbar.tsx`.
**How to verify:** tests for serialisation round-trips; (display) select a word → Red+Bold in one key; caret behaviour intact after formatting.

---

## Phase 16 — Range selection and clipboard (copy/paste/TSV)
**Goal:** Excel-compatible copy/paste in and out of the grid. **Depends on:** 11, 12. **Read:** `KB` §5.
**In scope:** range selection (keyboard + mouse); copy/cut → `text/plain` TSV + Quot3 JSON flavour; paste from Excel/TSV with row/column expansion and numeric rejection report; `tsvCodec`; `clipboard:readGrid` channel; delete/clear range; single history entry hook points for Phase 17.
**Out of scope:** the whole-bill TSV copy button (Phase 31).
**Key files:** `src/shared/tsv/tsvCodec.ts`, `components/grid/useGridClipboard.ts`, `src/main/ipc/clipboard.ts`.
**How to verify:** tests for TSV parse/format (quotes, tabs, newlines, CRLF); paste applies to the right cells; (display) paste a block from Excel.

---

## Phase 17 — Undo/redo engine (bill-wide)
**Goal:** One bill-wide history exists and every grid edit goes through it. **Depends on:** 13, 15, 16. **Read:** `UR` §2.
**In scope:** `createHistory`; billStore integrated with Immer `produceWithPatches`; coalescing (typing, backspace); range operations = one entry; selection restore (Append mode, caret end); depth 500; dirty tracking by deep-equal vs last saved snapshot; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; native cell undo already suppressed (Phase 11); labels per entry; the property test from `UR` §7 (random edit sequences → undo all = initial; redo all = final).
**Out of scope:** history panel UI and party-bar/format/extra-column coverage (Phase 18 and the phases that add those features register their own entries).
**Key files:** `src/shared/history/undoStack.ts`, `stores/billStore.ts`.
**How to verify:** all `UR` §7 cases 1, 2, 5, 6, 7, 8 pass.

---

## Phase 18 — Undo/redo UI and the "related features"
**Goal:** Undo/redo is visible and complete. **Depends on:** 17. **Read:** `UR` §2.5–2.7.
**In scope:** Undo/Redo buttons in the bottom bar with next-action tooltips; transient status messages; **Undo history panel** (Ctrl+Shift+H, keyboard operable, jump-to-state); "Revert to last saved" (Ctrl+Alt+Z, confirm); registration hooks so later phases (party bar, format switch, extra columns, paper override) push labelled entries; shortcut registry entries + palette actions.
**Out of scope:** trash and revisions (Phases 43–44).
**Key files:** `components/create/{UndoPanel,BottomBar}.tsx`, `shortcuts.ts`.
**How to verify:** tests for jumpTo and label generation; (display) panel shows labelled entries; jumping and redoing work.

---

## Phase 19 — Adjustments and footer rows
**Goal:** The owner's adjustment system works in the grid. **Depends on:** 13. **Read:** `MASTERPLAN.md` §11.
**In scope:** render footer rows from `computeBill().display` (Items total → adjustment rows → Adjustments total → Final total; collapses to a single "Total" when no adjustments); a row that becomes an adjustment moves automatically into the adjustment block and the active cell **follows it**; moving back when a qty/rate is added; adjustments editable in place; negative adjustments styled; footer rows non-editable but navigable (arrows pass through); `--grid-adjustment-bg` / `--grid-total-bg`.
**Out of scope:** GST-specific footer text beyond what the format's `footer` declares (Phase 20 verifies).
**Key files:** `components/grid/FooterRows.tsx`, `stores/billStore.ts`.
**How to verify:** tests with the adjustment fixtures (item + adjustment + final); focus-follow test on the reducer/store level; (display) type name + total in the blank row → it jumps below the items total.

---

## Phase 20 — Format switching (Alt+1 / Alt+2) and GST columns
**Goal:** Formats switch instantly without data loss. **Depends on:** 19, 8, 18.
**In scope:** Alt+1 → `gst`, Alt+2 → `non_gst`; format indicator + switcher in the toolbar; column set swap with no row mutation; active cell remapped sensibly (same logical column if present else nearest); GST % cell, GST Amt, Amount derived columns; GST footer behaviour; format change registered as an undoable entry; palette entries for every registered format (dynamic from registry).
**Out of scope:** extra-column management (Phase 21).
**Key files:** `components/create/FormatSwitcher.tsx`, `components/grid/*`.
**How to verify:** test: enter data in non-GST, switch to GST, switch back → rows byte-identical; GST math verified on the fixture; (display) Alt+1/Alt+2 flip < 1 frame perceivably.

---

## Phase 21 — Extra columns: add / remove / rename
**Goal:** Extra columns are safe to add, remove, rename. **Depends on:** 20. **Read:** `XU` §5.
**In scope:** `+Col` / `−Col` (Ctrl+Alt+= / Ctrl+Alt+−) and toolbar buttons; default headers; in-place header rename (single-line, ellipsis, full on focus); confirm on removing a column with data; all undoable with full data restore (`UR` §2.7); columns persist across formats (A4); appended after the format's own columns; keyboard navigation includes them.
**Out of scope:** units summary and Mark (Phase 22).
**Key files:** `components/grid/ColumnHeader.tsx`, `stores/billStore.ts`.
**How to verify:** tests: remove + undo restores data/headers; format switch keeps extras; `extraColCount` exposed for the paper engine; (display) rename a long header — no overflow.

---

## Phase 22 — Units summary, Mark, show-marked
**Goal:** The owner's item-code units feature works. **Depends on:** 21, 7. **Read:** `XU`.
**In scope:** Mark/Unmark (Ctrl+M) with visual treatment (`--grid-marked-underline`); Units summary popup (Ctrl+U) and Marked-calculations popup (Ctrl+Shift+M) driven by `summarizeUnits`; live recompute; copy-as-text from the popup; keyboard operable; undoable mark changes; reproduce the legacy screenshot's numbers from the fixture in an automated UI-level test.
**Out of scope:** units in print (appear as ordinary cells).
**Key files:** `components/create/UnitsPopup.tsx`, `components/grid/*`.
**How to verify:** tests: the legacy fixture produces ruby=12, tomato=7 in summary and idk bruhh=55 in marked view; (display) popups render and close with Esc.

---

## Phase 23 — Overflow and long-text handling in the grid
**Goal:** Nothing in the UI ever looks congested or ugly. **Depends on:** 22.
**In scope:** single-line ellipsis cells; full text on focus (expanding overlay that never shifts layout); tooltips for truncated headers; column width policy (min/max, user-resizable columns with persisted widths per format); horizontal scroll only inside the grid with sticky Sl.No/Item Name; long name and 40-character header fixtures; RTL/emoji-safe truncation; no layout shift when a cell enters edit mode.
**Key files:** `components/grid/*`, `styles/grid.css`.
**How to verify:** tests for width policy; (display) long-name fixtures at 1366×768 — no overlap, no horizontal page scroll.

---

## Phase 24 — Grid performance harness and **GRID GATE**
**Goal:** Measure the 240 Hz goal and sign off Milestone 2. **Depends on:** 9–23.
**In scope:** dev-only harness (`/dev/perf`): synthetic keydown stream at 240 Hz on the 80-row bill; records keydown→paint using `performance.now()` + `PerformanceObserver('long-animation-frame')`; scenarios — type in a name cell, hold Down arrow, Tab across a full row, paste 200 cells, format switch, undo storm; results table written to `PHASE_STATUS.md`; fix regressions found; confirm no whole-grid re-render; **gate checklist** below.
**Gate checklist (all must pass or be logged with owner-visible reasons):** [ ] KB §9 tests green [ ] UR §7 grid cases green [ ] 20 rows visible at 1366×768 [ ] append-caret rule works by hand-test or is an explicit standing gap [ ] Red+Bold one-key works [ ] adjustments move correctly [ ] Alt+1/2 lossless [ ] extra cols add/remove/rename/undo [ ] units numbers match [ ] long text never breaks layout [ ] perf numbers recorded (target: p95 input→paint ≤ 4.2 ms on 80 rows; if the sandbox cannot measure real paint, record the logic-path timings and flag the real-paint measurement as a standing gap).
**How to verify:** run the harness; paste numbers into `PHASE_STATUS.md`.

---

## MILESTONE 3 — Create page (Phases 25–32)
*Exit criteria: a complete bill can be created, saved (with PO number), reopened, edited, recovered after a crash, and copied as TSV — all by keyboard.*

---

## Phase 25 — Compact party/detail bar
**Goal:** The top bar is compact and keyboard-driven. **Depends on:** 24. **Read:** `KB` §7; `legacy_create_screen.png`.
**In scope:** one-row bar (≤ ~72px incl. address pull-down closed): Party Name, Phone, Transport, Date, PO number display (read-only preview of the next PO number), format indicator; **address field collapsed behind a pull-down** (Alt+Down / chevron; Esc/Alt+Up closes); field-to-field flow (Right at end edge / Tab; Shift+Tab back; from Transport into grid row 1); all party-bar edits are undoable entries (Phase 18 hooks); store slice in `billStore`.
**Out of scope:** autocomplete (Phase 26).
**Key files:** `components/create/PartyBar.tsx`, `pages/Create.tsx` (first version assembling bar + grid + a stub bottom bar).
**How to verify:** (display) bar height measured ≤ 72px; keyboard-only field traversal works; undo restores a party field.

---

## Phase 26 — Party fuzzy autocomplete and the new-party flow
**Goal:** Typing a party name offers fuzzy suggestions and auto-fills details; new names are valid. **Depends on:** 25, 5.
**In scope:** `partyService` + `parties:list/upsert`; in-memory Fuse index (`createPartyIndex`); dropdown (Up/Down, Enter select, Esc closes dropdown only); auto-fill phone/transport/address on select (one undo step); new party = just type a name, Right/Tab continues to optional fields; **on Save only the new party is added** (logic lives in `bills:save` Phase 27 — this phase defines the `isNewParty` detection and tests it); seed data for dev (30 sample parties).
**Out of scope:** Excel import (Phase 47), Customers page.
**Key files:** `src/shared/party/fuzzy.ts`, `src/main/services/partyService.ts`, `components/create/PartyAutocomplete.tsx`.
**How to verify:** tests: fuzzy ranking (typos, partial words, phone digits, "Lakshmi Cloth" variants); new-party detection; (display) dropdown renders and keyboard-selects.

---

## Phase 27 — Saving bills: PO numbers, validation, persistence
**Goal:** Bills persist atomically with PO numbering and validation. **Depends on:** 26, 5. **Read:** `DM`.
**In scope:** `bills:newDefaults`, `bills:save` (one transaction: bill, rows, party upsert for new party, PO counter increment, `revision`, `bill_revisions` snapshot, `totals_json`/`item_row_count` caches, outbox row when sync enabled — outbox itself a stub until Phase 54), `billService`, Zod validation, optimistic revision check (`CONFLICT_REVISION`), PO number = `prefix + padded seq` using the local branch's prefix; **Save validation:** party name required (prompt + focus jump), at least one non-blank item/adjustment row; Ctrl+S; success toast showing the PO number; bill becomes "saved" with a clean dirty flag.
**Out of scope:** Esc guard (28), drafts (29).
**Key files:** `src/main/services/billService.ts`, `src/main/ipc/bills.ts`, `components/create/SaveFlow.tsx`.
**How to verify:** Vitest against a temp DB: save creates rows + PO `Q3-0001`; second save increments `Q3-0002`; edit-save increments revision and stores a revision; two simultaneous saves never duplicate a PO; failed validation writes nothing; new party created exactly once.

---

## Phase 28 — Esc guard, unsaved-changes prompts, edit-existing flow
**Goal:** Leaving a bill never loses work silently. **Depends on:** 27, 18. **Read:** `KB` §6.
**In scope:** `useDirtyGuard`; Esc chain (Free → Append → page prompt); **Save / Discard / Cancel** dialog (keyboard: S / D / Esc); Save with no party name → name prompt first; pristine empty bill leaves silently; opening a saved bill (`?bill=<id>` via `bills:getForEdit`) and prompting on changes; navigation away (side rail, shortcuts) also goes through the guard; window close/quit goes through the guard (`app:before-quit`).
**Key files:** `hooks/useDirtyGuard.ts`, `components/create/UnsavedDialog.tsx`, `src/main/index.ts` (before-quit).
**How to verify:** tests for the guard state machine (dirty/clean/pristine, undo-to-clean removes the prompt); (display) flows by keyboard.

---

## Phase 29 — Draft autosave and crash recovery
**Goal:** An unsaved bill survives a crash. **Depends on:** 28. **Read:** `UR` §3.
**In scope:** `draftService` + `drafts:*`; debounced autosave (~2 s after last change, never on the keystroke path); draft deleted on save/discard; on launch, recoverable drafts surface on the Dashboard ("Recover unsaved bill — party, time") and via `drafts:recoverable` event; recovery opens with fresh undo history; stale-draft cleanup (> 14 days) with an audit row.
**Key files:** `src/main/services/draftService.ts`, `components/create/DraftRecovery.tsx`.
**How to verify:** Vitest for draft CRUD and cleanup; simulate crash by saving a draft then constructing a fresh app state and listing drafts; (display) kill the process mid-edit and recover.

---

## Phase 30 — Bottom action bar and the full shortcut map
**Goal:** The Create page is fully actionable from the keyboard and from a compact bottom bar. **Depends on:** 29, 20, 22.
**In scope:** bottom bar (≤ 44px): **Print Rough, Print Professional, Copy Image Rough, Copy Image Professional, TSV Copy, Undo, Redo, Save** (+ units/mark/extra-col buttons in a compact toolbar above the grid like the legacy app); buttons wired to stubs where later phases implement the action (disabled-with-reason tooltips); **freeze the global shortcut map** from `KB` §8 in `shortcuts.ts` with conflict tests; every button shows its shortcut; F1 sheet lists all.
**Key files:** `components/create/{BottomBar,Toolbar}.tsx`, `shortcuts.ts`.
**How to verify:** conflict test passes; (display) every toolbar/bottom-bar action reachable without the mouse.

---

## Phase 31 — TSV copy (whole bill)
**Goal:** One action copies the whole bill for Excel. **Depends on:** 16, 30.
**In scope:** `billToTsv` (party name, contact, transport lines **then** the table incl. header row, adjustments and totals rows, extra columns; **party side only, no company block**); `clipboard:writeTsv` with `text/plain` and an HTML table flavour so Excel pastes into cells cleanly; shortcut Ctrl+Shift+T and bottom-bar button; success toast.
**Key files:** `src/shared/tsv/tsvCodec.ts`, `src/main/ipc/clipboard.ts`.
**How to verify:** tests compare `billToTsv` output to golden files for non-GST, GST, adjustment and extra-col bills; clipboard write verified with Electron's clipboard in a headless test if possible, else logged as a standing gap (owner pastes into Excel).

---

## Phase 32 — Create page integration QA
**Goal:** The create flow is solid end to end. **Depends on:** 25–31.
**In scope:** end-to-end tests (Playwright-Electron if a display exists, otherwise store-level integration tests) for: new bill → party autocomplete → 5 items + adjustment → switch formats → add extra column → Mark → save → reopen → edit → Esc prompt → discard; seed 30 historical bills for later phases; fix defects; update docs.
**How to verify:** the integration suite passes; list what ran in `PHASE_STATUS.md`.

---

## MILESTONE 4 — Print, PDF and Image (Phases 33–40)
*Exit criteria (Phase 40 gate): rough and professional output on A5/A4 is correct for the whole edge-case matrix, long text never congests, PDF export works, and copy-as-image produces a tightly cropped, crisp image on the clipboard.*

---

## Phase 33 — Print template engine and the Rough template
**Goal:** One HTML/CSS template path that will serve preview, print, PDF and image; Rough layout done. **Depends on:** 24, 8. **Read:** `MASTERPLAN.md` §12; `RQ` printing section.
**In scope:** `buildPrintModel` (pure, snapshot-tested); template renderer producing HTML from `PrintModel`; **bundled Unicode font with ₹** (Noto Sans Regular/Bold in `resources/fonts/`) via `@font-face`; print tokens (`--print-*`) independent of UI theme; **Rough** header = party name, phone, transport only (no company block, no party address, no PO); table with runs (bold/red/highlight), extra columns, adjustment block and totals; A5 and A4 `@page` rules with small fixed margins; a dev page `/dev/print-preview` that renders the model in an iframe.
**Out of scope:** Professional template, printing, paper engine.
**Key files:** `src/shared/print/printModel.ts`, `src/main/print/template/*`, `resources/fonts/*`.
**How to verify:** snapshot tests of the model for legacy, GST, adjustment, extra-col fixtures; (display) preview page shows Rough A5/A4; ₹ renders.

---

## Phase 34 — Professional template
**Goal:** Professional layout with our company block and PO number. **Depends on:** 33.
**In scope:** header: **our company logo, name, phone, address** (from Settings; placeholders until Phase 48), party name, party address, transport, phone, **PO number**, date; same table engine as Rough; logo scaling rules (max height, aspect preserved, no stretch); layout reviewed with the owner via screenshots (owner confirms the look — the layout is not specified beyond content, so record the owner's feedback as decisions).
**Out of scope:** Settings UI for company info (Phase 48).
**How to verify:** model snapshot tests; (display/screenshot) preview A5 and A4; **ask the owner to review** and log changes in `PHASE_STATUS.md`.

---

## Phase 35 — Long-text wrapping and multi-page A4
**Goal:** No congestion, ever — in output. **Depends on:** 34. **Read:** `MASTERPLAN.md` §12; `XU` §5.
**In scope:** wrapping for item names and extra-column headers/cells; row height grows; `break-inside: avoid` for rows; **table header repeats on every A4 page**; totals block kept together on the last page; hyphenation off, `overflow-wrap:anywhere` for unbroken long codes; column width algorithm balancing item name vs extra columns; fixtures: 60-char names, 120-char name, 40-char header, 3-extra-col GST bill, 81/150-row bills.
**How to verify:** layout-measurement tests (render in the hidden window and assert no element exceeds the page content box, no horizontal overflow); screenshots of the worst fixtures inspected and saved under `docs/reference/qa/` (or logged as standing gap if no renderer is available).

---

## Phase 36 — Paper engine (pure) and thresholds
**Goal:** `decidePaper` implements `PE` exactly. **Depends on:** 8. **Read:** `PE` (all).
**In scope:** `paperConstants.ts` (the only place for 40/30/80/70), `paperRules.ts`, the **entire §6 test matrix**, plus property test (monotonic: more rows never yields a smaller page; more extra cols beyond limit never yields A5); lint-style test asserting the numbers 40/30/80/70 appear in no other source file.
**How to verify:** `npm test` — whole matrix green.

---

## Phase 37 — Print flow: dialog, preview, force size, warnings, printing
**Goal:** Printing works from the bottom bar with A5 default. **Depends on:** 35, 36, 30. **Read:** `PE` §7.
**In scope:** print dialog (keyboard: Enter = suggested size, `4`/`5` force size, Esc cancel) showing decision, reasons, warnings and a live preview; `requiresAck` flow for the extra-columns warning; hidden-window rendering of the same template; `print:decide`, `print:print` (system dialog by default, optional silent print to a configured printer); the **measured-overflow safety net** (re-decide with `measuredOverflow`); printer/default-size settings read from Settings (stubs until Phase 48); Ctrl+P = Rough, Ctrl+Shift+P = Professional.
**Out of scope:** PDF, image.
**Key files:** `src/main/print/printService.ts`, `components/create/PrintDialog.tsx`, `src/main/ipc/print.ts`.
**How to verify:** tests for the decision wiring and the overflow re-decide using a measured stub; **real printing is a standing gap** (no printer in the sandbox) — verify with print-to-PDF; owner confirms physical output.

---

## Phase 38 — PDF export
**Goal:** Save the bill as a PDF identical to the print. **Depends on:** 37.
**In scope:** `printToPDF` with `preferCSSPageSize` and the decided size; save dialog with default filename (`<PO or party>-<date>.pdf`); "Open PDF" action; also used by History's "Open PDF"; PDF inspected programmatically (page count, page size A5 = 148×210 mm / A4 = 210×297 mm, fonts embedded incl. ₹ glyph via `pdffonts`/`pdf-parse` where available).
**How to verify:** generate PDFs for the fixtures and assert page size, page count (81-row rough → 2 pages), embedded font, text extractability.

---

## Phase 39 — Copy as image (Rough and Professional) — no compromises
**Goal:** One key puts a tightly cropped, crisp image of the output on the clipboard. **Depends on:** 35, 30. **Read:** `MASTERPLAN.md` §12; `RQ` image paragraph.
**In scope:** `imageService`: render the same template in an offscreen hidden window at the decided size, measure the **content bounding box** (table + header, excluding page white space), set `deviceScaleFactor` 2–3, `capturePage(rect)` at full content height (even beyond the viewport), convert to `nativeImage`, `clipboard.writeImage`; uniform small padding; two buttons + shortcuts (Ctrl+I Rough, Ctrl+Shift+I Professional); toast with pixel size; dev flag to also write the PNG to a temp file; multi-page A4 bills → **one tall image** of the whole content; error handling (`IMAGE_FAILED`) and large-image guard (cap at 16k px height with a clear message — never silently downscale).
**How to verify:** programmatic checks on the produced PNG (crop margins ≤ padding, width/height ratio, no clipped table edge, ₹ glyph pixels present via comparison with the PDF text); **clipboard paste into WhatsApp/Paint is a standing gap the owner must confirm** — the owner flagged this as strictly required, so state plainly what was and wasn't verified.

---

## Phase 40 — Print/Image QA matrix and **OUTPUT GATE**
**Goal:** Sign off Milestone 4. **Depends on:** 33–39. **Read:** `PE` §6.
**In scope:** run every matrix row of `PE` §6 through model → paper decision → PDF → image; fix defects; compile owner-review pack (PDF/PNG samples) in `docs/reference/qa/`; **gate checklist:** [ ] A5 default correct [ ] 40/41/80/81 and 30/31/70/71 boundaries correct [ ] extra-col warning + ack [ ] GST with extras → A4 + warning [ ] no overflow in worst fixtures [ ] repeated headers on A4 page 2 [ ] ₹ glyph everywhere [ ] image tightly cropped [ ] professional has PO + company block, rough has neither [ ] rough has no party address.
**How to verify:** matrix harness passes; owner-review pack produced.

---

## MILESTONE 5 — History, Customers, Dashboard, Settings, Backups (Phases 41–50)
*Exit criteria: the owner can browse, search, reopen, reprint, delete/restore and compare bills; see customers; land on a useful dashboard; configure the app; and back up/restore safely.*

---

## Phase 41 — History page layout
**Goal:** The History page matches the owner's layout. **Depends on:** 32. **Read:** `legacy_history_screen.png`.
**In scope:** left **Dates** panel (date `DD-MM-YY` + bill count, newest first, keyboard navigable); right panel bill list (PO number, date, party, total — Indian grouping, ₹) virtualised with `@tanstack/react-virtual`; `historyService` + `history:listDates/listBills`; Up/Down/Enter/Tab between panels; compact density; empty state; branch filter control (disabled until sync, shows local branch).
**Key files:** `pages/History.tsx`, `components/history/*`, `src/main/services/historyService.ts`.
**How to verify:** Vitest for queries on a seeded 500-bill DB (dates, counts, ordering, performance < 50 ms); (display) layout vs screenshot.

---

## Phase 42 — History actions and search
**Goal:** Everything the owner can do with a saved bill. **Depends on:** 41, 38, 37.
**In scope:** Open/Edit in Create (Enter), Open PDF, Print (rough/professional), Copy image, Delete (soft, confirm), **search box** (party, PO number, item text via `name_plain`, amount; debounced; fuzzy for party) with Ctrl+F; date range filter; bottom action bar mirroring the legacy (Open PDF, Edit/Open, Print, Delete, Back) with shortcuts; multi-select (Shift+arrows) for bulk delete/export.
**Key files:** `components/history/{ActionBar,SearchBox}.tsx`, `src/main/ipc/history.ts`.
**How to verify:** tests for search ranking and filters; (display) keyboard-only operation.

---

## Phase 43 — Recently deleted (trash) and restore
**Goal:** Deleting a bill is always recoverable (undo layer L3). **Depends on:** 42. **Read:** `UR` §4.
**In scope:** soft-delete flow with an "Undo delete" toast (~10 s, Ctrl+Z on History); **Recently deleted** view (Ctrl+Shift+D): Restore (Enter), Delete forever (confirm), Empty trash (typed confirmation); auto-purge after `TRASH_RETENTION_DAYS` (30, configurable in Settings later) with audit rows; restore keeps the PO number; tombstone/revision handling per `UR` §4.
**Key files:** `src/main/services/trashService.ts`, `components/history/TrashView.tsx`.
**How to verify:** tests: delete→restore returns a deep-equal bill; purge honours retention; PO numbers never reused.

---

## Phase 44 — Revision history, compare, restore
**Goal:** See and restore earlier versions of a bill (undo layer L4). **Depends on:** 27, 42. **Read:** `UR` §5.
**In scope:** `revisionService`; `diffBills`; revisions list + diff viewer (inline diff with added/removed/changed rows, party/format/extra-col changes) from Create (Ctrl+Shift+V) and History; **Restore opens as an unsaved change** (never overwrites); cap 50 revisions per bill.
**Key files:** `src/shared/diff/billDiff.ts`, `src/main/services/revisionService.ts`, `components/history/RevisionPanel.tsx`.
**How to verify:** diff tests (add/remove/change row, extra col, party, format); restore-as-draft test; cap test.

---

## Phase 45 — Customers page
**Goal:** Searchable customer list with counts and details. **Depends on:** 26, 41.
**In scope:** `customerService`; list (name, phone, address preview, transport, **bill count**, last bill date, total billed), search (fuzzy, Ctrl+F), edit/add party inline (Enter), soft-delete a party (bills keep their snapshot), open a customer → their bills (History-style list), compact density, virtualised.
**Key files:** `pages/Customers.tsx`, `components/customers/*`, `src/main/services/customerService.ts`.
**How to verify:** tests with seeded data (counts correct incl. deleted bills excluded); (display) keyboard-only operation.

---

## Phase 46 — Dashboard
**Goal:** The landing screen. **Depends on:** 41, 45, 29.
**In scope:** four prominent cards (Create, History, Customers, Settings) with shortcuts; stats: today's bills/total, this month's total, last 7 days sparkline (simple SVG), recent bills (open on Enter), top customers, recoverable drafts banner (Phase 29), last backup time, sync status placeholder; `dashboardService`; refreshes on focus; numbers use Indian grouping.
**Key files:** `pages/Dashboard.tsx`, `src/main/services/dashboardService.ts`.
**How to verify:** tests on stats queries with seeded data; (display) layout, keyboard focus order.

---

## Phase 47 — Party Excel import (Settings) — **needs owner input**
**Goal:** Import parties from the owner's Excel. **Depends on:** 45. **Awaiting from owner:** the Excel format (columns, sheet layout, sample file).
**In scope:** **STOP and ask the owner for the format if it is not in `PHASE_STATUS.md` → "Awaiting from owner".** Then: ExcelJS reader in main; column-mapping UI with preview (first 20 rows), validation, duplicate detection (name_norm + phone), update-vs-skip choice, import report; `partyImport:preview/commit`; undo of an import (the whole import as one removable batch tagged `source='import'` + import id).
**Out of scope:** exporting parties.
**How to verify:** tests with generated sample workbooks (various header spellings, blank rows, duplicate parties); owner's real file result logged.

---

## Phase 48 — Settings: company profile, logo, PO prefix, print defaults
**Goal:** Everything configurable that printing and numbering need. **Depends on:** 34, 27.
**In scope:** Settings shell with sub-pages (keyboard navigable); **Company** (name, phone, address, logo upload → `assets/`, validated image, size/format limits, preview); **Branch / PO prefix** (editable prefix applies to *new* bills only; uniqueness check vs known branches; live preview of next PO); **Print defaults** (default size A5, default printer, silent print toggle, margins within safe range, round-off toggle); **Behaviour** (trash retention, left-unlock presses, autosave interval); settings feed Professional template and PO generation.
**Key files:** `pages/settings/*`, `src/main/services/settingsService.ts`.
**How to verify:** tests for prefix validation/PO preview; (display) changing company name changes the Professional preview.

---

## Phase 49 — Settings: themes manager, shortcuts viewer, preferences
**Goal:** Theming and keyboard config UI. **Depends on:** 48, 3.
**In scope:** Themes list (built-ins + drop-in files, validity errors shown), apply/preview, "Open themes folder", "Reload themes", export current theme as a starter file; read-only **shortcut viewer** (searchable) — rebinding is *not* in scope unless the owner asks (record as open question); density/font-size preference within clamped ranges.
**How to verify:** tests for theme validation reuse; (display) switching themes live.

---

## Phase 50 — Backup and restore
**Goal:** Safe backups (layer L5). **Depends on:** 5, 48.
**In scope:** `backupService` using the SQLite backup API (consistent online copy); automatic daily backup (first launch of the day) with retention (default keep 14); manual **Create backup** (Ctrl+Alt+B); list with size/bill count; **Restore** (always makes a `pre-restore` backup first, requires restart/reload, typed confirmation); import a backup file from another machine (also the **new-branch bootstrap** primitive for Phase 58); "Reset local data" (typed confirmation); integrity check (`PRAGMA integrity_check`) on startup, with a recovery prompt if it fails.
**Key files:** `src/main/services/backupService.ts`, `pages/settings/Backup.tsx`.
**How to verify:** tests: backup of a populated DB opens and matches; restore round-trip; retention pruning; corrupt-file handling.

---

## MILESTONE 6 — Sync (Phases 51–60)
*Optional feature; off by default. Read `docs/SYNC_POSTBOX_SPEC.md` before starting any of these. Anything that needs the owner's real Supabase project is built against `InMemoryTransport` and the SQL is handed to the owner to run — log the real-Supabase result as a standing gap.*

---

## Phase 51 — Sync design lock and Supabase SQL
**Goal:** The SQL and RPCs from `SY` §3 exist as files. **Awaiting from owner (later):** Supabase project + anon key.
**In scope:** `supabase/sql/01..05_*.sql` (licenses, branches, postbox, RPCs, sweep) with RLS enabled and **no direct-table policies**, `SECURITY DEFINER` RPCs, input limits, generic `invalid_license` errors; `docs/SUPABASE_MIGRATIONS.md`; a script to generate a license key + hash; a SQL self-test script the owner can run; `docs/security/SECURITY_MODEL.md` updated for sync.
**How to verify:** SQL syntax check via `pg-mem`/`psql --dry-run` if available, else careful review noted as a standing gap; owner runs it in a scratch project.

---

## Phase 52 — License activation and branch registration
**Depends on:** 51, 48. **In scope:** `license:activate/status/deactivate`; license key + org passphrase entry UI; `SupabaseTransport` (anon key, RPC calls only, timeouts, retries); `qt_register_branch` flow with PO-prefix uniqueness; license key stored via `safeStorage`; clear offline/invalid states; sync stays disabled until activated.
**How to verify:** transport contract tests with a mocked Supabase client; flows against `InMemoryTransport`.

---

## Phase 53 — Encryption layer
**Depends on:** 52. **In scope:** `crypto.ts` per `SY` §4 — PBKDF2 key derivation, AES-256-GCM with AAD (bill id + revision), compression, canonical JSON; key caching via `safeStorage`; wrong-passphrase detection (a known-answer check value); tamper tests.
**How to verify:** tests: round-trip; wrong key fails; swapped-AAD fails; tampered ciphertext fails; deterministic canonical JSON; known-answer vectors.

---

## Phase 54 — Outbox (local change capture)
**Depends on:** 53, 27. **In scope:** `sync_outbox` writes inside `bills:save`/`delete`/restore transactions; `bill.sync_state`; the `Transport` interface + `InMemoryTransport` (two virtual branches in one process); outbox inspection IPC for the Sync status UI.
**How to verify:** tests: outbox row exists iff the transaction commits; crash-safety (rollback leaves no outbox row).

---

## Phase 55 — Push worker
**Depends on:** 54. **In scope:** worker loop (15 s + immediate after save), batching, fan-out to every other branch, exponential backoff (cap 10 min), poison handling (≥ 10 attempts → `failed`), offline detection; never blocks UI.
**How to verify:** tests with a flaky `InMemoryTransport`: retries, ordering, fan-out count, poison state, resume after restart.

---

## Phase 56 — Pull, apply, acknowledge
**Depends on:** 55. **In scope:** pull worker (30 s, on start, on regain), decrypt, **idempotent apply in one transaction per row**, cursor advance only after apply, `qt_ack`; `bills:remoteChanged` event; **open-editor protection** — never mutate the bill open in the editor; banner "Changed on another branch — Keep mine / Load theirs" (`UR` §2.7).
**How to verify:** tests: replay safety (apply twice = once), crash between apply and ack, decrypt failure keeps the row unacknowledged, editor-open case.

---

## Phase 57 — Conflict resolution and tombstones
**Depends on:** 56. **In scope:** deterministic ordering (`updated_at` → `revision` → branch id) per `SY` §6; delete tombstones and resurrection by restore (higher revision); losing local edits stored as a revision + `audit_log` conflict row; `bill.sync_state='conflict'` surfacing.
**How to verify:** property tests: any delivery order of the same change set converges to the same state on all branches.

---

## Phase 58 — New-branch bootstrap import
**Depends on:** 50, 57. **In scope:** guided flow: export a backup from an existing branch → import on the new branch (Phase 50 primitive) → assign local branch id/prefix → start sync; dedupe by bill UUID; remote PO numbers preserved.
**How to verify:** tests: import into an empty DB, no duplicate bills, PO numbers preserved, new local bills use the new prefix.

---

## Phase 59 — Sync status UI and History branch filter
**Depends on:** 58, 41. **In scope:** `syncManager`; Settings → Sync page (enabled toggle, license/branch info, last push/pull, pending/failed counts with retry, errors); dashboard status chip; History branch filter ("This branch" / "All branches" / specific) with the PO prefix visible per bill; per-bill sync state badge.
**How to verify:** tests for manager state transitions; (display) UI states.

---

## Phase 60 — Sync hardening and two-branch simulation
**Depends on:** 59. **In scope:** dev harness running two virtual branches against `InMemoryTransport` with random delays/drops; soak test; clock-skew handling note; payload size limits; metrics logged; **owner-run real-Supabase checklist** documented in `docs/SUPABASE_MIGRATIONS.md`.
**How to verify:** harness converges across 1000 randomized operations; real Supabase = standing gap until the owner runs the checklist.

---

## MILESTONE 7 — Hardening, packaging, release (Phases 61–69)

---

## Phase 61 — Audit log and crash logging
**In scope:** `auditService` (who/what/when for bill create/edit/delete/restore, imports, restores, sync conflicts), viewer in Settings with filters, retention; global error handlers (main + renderer) writing to rolling logs (no bill content), a "Copy diagnostics" button, crash-recovery message on next launch.
**How to verify:** tests for audit writes; forced-exception test for the handlers.

---

## Phase 62 — Auto-updater
**In scope:** `electron-updater` with GitHub Releases (or a configured generic URL), manual "Check for updates" + background check, download progress, "restart to update", update **never interrupts an unsaved bill** (deferred until the dirty guard is clean), signature/channel notes.
**How to verify:** updater config test with a mock feed; real update flow is a standing gap until a release exists.

---

## Phase 63 — App icon and installer branding — **needs the owner's icon**
**Awaiting from owner:** the app icon (≥ 512 px PNG or .ico). **STOP and ask if not present.**
**In scope:** generate `.ico` (multi-size 16–256) from the supplied image; window/taskbar icon; installer/uninstaller icons; app name/ID (`Quot3`), publisher, version scheme; in-app About screen.
**How to verify:** file checks on generated icons; (display) taskbar icon.

---

## Phase 64 — Windows installer (electron-builder, NSIS per-user)
**In scope:** `electron-builder.yml` (per-user NSIS, no admin needed, `%LOCALAPPDATA%\Programs\Quot3`), desktop/start-menu shortcuts, preserve user data on uninstall (ask), file association none, auto-launch off, native module packaging (`asarUnpack` for `better-sqlite3`), fonts/resources included, CI-friendly `npm run dist`.
**How to verify:** `npm run dist` on Windows/CI produces `Quot3-Setup-x.y.z.exe`; if the sandbox is not Windows, log "installer build not run" as a standing gap and verify the unpacked build config with `electron-builder --dir` where possible.

---

## Phase 65 — Code-signing and SmartScreen notes
**In scope:** documentation + config hooks for code signing (certificate options, env vars, timestamping), SmartScreen reputation explanation, AV false-positive guidance, release checklist; no certificate is purchased by this phase.
**How to verify:** config validates; doc reviewed.

---

## Phase 66 — Playwright-Electron e2e suite
**In scope:** `tests-e2e/` covering: dashboard → create → keyboard-only bill with adjustment → save → history → reopen → edit → Esc prompt; format switch lossless; extra col + Mark + summary; print-to-PDF page size/count; image copy dimensions; trash + restore; backup + restore; headless via xvfb where available.
**How to verify:** suite passes where a display/xvfb exists; otherwise standing gap.

---

## Phase 67 — Full keyboard-only acceptance
**In scope:** structured pass of every page and every action **without the mouse**, checklist in `PHASE_STATUS.md`; fix focus traps, missing shortcuts, missing palette entries; verify the F1 sheet is complete; screen-reader-independent focus order sanity.
**How to verify:** checklist completed; automated "every action has a shortcut + palette entry" test passes.

---

## Phase 68 — Performance acceptance
**In scope:** re-run the Phase 24 harness on release builds; measure startup time, History with 5 000 bills, Customers with 2 000 parties, image copy time, print render time, memory after 1 h soak; fix regressions; record results.
**How to verify:** numbers recorded; budgets met or exceptions explained to the owner.

---

## Phase 69 — Final QA, release checklist and **RELEASE GATE**
**Execution order (changed after Phase 68, after Phase 91 and again for the item sorter):** Phase 69 now runs AFTER Phase 127 (Milestone 8 = 70–91, Milestone 9 = 92–106, Milestone 10 = 107–115, Milestone 11 = 116–127). Milestone 8 (Phases 70–91) is in the Milestone 8 section at the end of this file. The number 69 is kept so no completed phase is renumbered.
**In scope:** run every gate checklist again (24, 40) and the full requirements map in `RQ` Part D — each requirement ticked with evidence or a flagged gap; docs sweep (`PROJECT_STRUCTURE`, `API_CONTRACTS` in sync with code); version 1.0.0; owner hand-over notes (backup advice, update procedure, where data lives, how to add a format, how to add a theme).
**How to verify:** release checklist complete; zipped final deliverable.

---

# Milestone 8 — Post-Phase-68 owner feedback (Phases 70–91)

Design: `docs/MILESTONE8_DESIGN.md`. Phase 69 (RELEASE GATE) is deferred and runs AFTER Phase 91; no phase is renumbered. Assumptions marked [A] there are not owner-confirmed.

---

## Phase 70 — Create fresh-bill fix + header border alignment
**Goal:** After a successful Save the Create session clears (`startFreshBill()`); an unsaved bill is resumable with a visible New button; header dividers align with body column borders.
**Depends on:** Phase 69 is NOT a dependency; previous phase in this milestone. Source: M8 §1–2.
**In scope:** After a successful Save the Create session clears (`startFreshBill()`); an unsaved bill is resumable with a visible New button; header dividers align with body column borders.
**Out of scope:** Round-off, nav.
**Key files:** `stores/createSession.ts`, grid header/body column geometry
**How to verify:** Save then open Create: blank bill; unsaved bill resumes; New starts fresh; pixel-alignment e2e on header vs body borders (standing gap if no window).

---

## Phase 71 — Warm render window + instant image copy
**Goal:** Hidden pooled render window kept warm, direct `clipboard.writeImage` from main, idle pre-render keyed by content hash.
**Depends on:** Phase 70. Source: M8 §3.
**In scope:** Hidden pooled render window kept warm, direct `clipboard.writeImage` from main, idle pre-render keyed by content hash.
**Out of scope:** Quality/scale change (Phase 72).
**Key files:** `main/print/*`, `shared/print/imageFlow.ts`
**How to verify:** Timing test: copy-as-image click-to-clipboard measured before/after; cache hit path; window reuse.

---

## Phase 72 — HD image quality
**Goal:** Scale 4–5x via `image.scale`, Settings 'Image quality', verify the device scale factor applies by measuring output pixel width, respect `IMAGE_MAX_PX`.
**Depends on:** Phase 71. Source: M8 §3.
**In scope:** Scale 4–5x via `image.scale`, Settings 'Image quality', verify the device scale factor applies by measuring output pixel width, respect `IMAGE_MAX_PX`.
**Out of scope:** Print.
**Key files:** `shared/print/imageFlow.ts` (`IMAGE_SCALES`, `IMAGE_MAX_PX`), Settings
**How to verify:** Output PNG width equals expected scale x CSS width; oversize bills fall back safely; owner eyeball on WhatsApp is a standing gap.

---

## Phase 73 — Print dialog instant + top-aligned print
**Goal:** Dialog opens from the pure paper engine immediately; overflow measurement runs in background and updates it; print is top-aligned (diagnose template CSS vs printer driver and record the finding).
**Depends on:** Phase 72. Source: M8 §4.
**In scope:** Dialog opens from the pure paper engine immediately; overflow measurement runs in background and updates it; print is top-aligned (diagnose template CSS vs printer driver and record the finding).
**Out of scope:** New paper rules.
**Key files:** `main/print/*`, print templates, `shared/print/paperEngine.ts`
**How to verify:** Dialog open time measured; template top offset test; real printer result is a standing gap.

---

## Phase 74 — Smooth arrow navigation (pure reducer)
**Goal:** Pure reducer support for `smoothArrows`: Left/Right jump to the neighbouring cell with caret at end; edit mode letter-by-letter with start/end edge jumps.
**Depends on:** Phase 73. Source: `KEYBOARD_CELL_RULES.md` §11.
**In scope:** Pure reducer support for `smoothArrows`: Left/Right jump to the neighbouring cell with caret at end; edit mode letter-by-letter with start/end edge jumps.
**Out of scope:** DOM and Settings (Phase 75).
**Key files:** `shared/nav/cellNav.ts`
**How to verify:** Table tests for both settings values; OFF output identical to today.

---

## Phase 75 — Smooth arrow navigation (DOM + Settings toggle)
**Goal:** Wire the reducer to the grid; Settings toggle `nav.smoothArrows` (default ON); F2 enters edit mode; Esc/Enter/Tab leave it.
**Depends on:** Phase 74. Source: `KEYBOARD_CELL_RULES.md` §11.
**In scope:** Wire the reducer to the grid; Settings toggle `nav.smoothArrows` (default ON); F2 enters edit mode; Esc/Enter/Tab leave it.
**Out of scope:** Rebinding UI.
**Key files:** grid keyboard handler, Settings
**How to verify:** Keyboard e2e both settings; grid perf harness re-run (no render-count regression); update F1 hints.

---

## Phase 76 — Round-off foundation (schema + pure)
**Goal:** Migration `bills.round_off` (default 0), pure rounding in calc engine, single `getBillOptions` read, `computeBill` takes the option.
**Depends on:** Phase 75. Source: M8 §6.
**In scope:** Migration `bills.round_off` (default 0), pure rounding in calc engine, single `getBillOptions` read, `computeBill` takes the option.
**Out of scope:** Settings and callers (Phase 77).
**Key files:** `DATA_MODEL.md`, `shared/calc/*`, migration
**How to verify:** Pure tests: nearest rupee, negatives, .5 boundary, flag 0 unchanged.

---

## Phase 77 — Round-off wiring + Settings
**Goal:** Setting `calc.roundOff` default ON; every caller (`gridModel`, `billModel`, `billTsv` x2, `printModel`) uses the one shared options read; no displayed line; old bills unchanged until re-saved; imported bills 0; snapshot/diff/`sameContent` include `round_off`.
**Depends on:** Phase 76. Source: M8 §6.
**In scope:** Setting `calc.roundOff` default ON; every caller (`gridModel`, `billModel`, `billTsv` x2, `printModel`) uses the one shared options read; no displayed line; old bills unchanged until re-saved; imported bills 0; snapshot/diff/`sameContent` include `round_off`.
**Out of scope:** Importer.
**Key files:** callers listed, sync snapshot
**How to verify:** Grep test: no caller reads the setting directly; save/reopen/print/TSV/image totals agree.

---

## Phase 78 — Active-row highlight
**Goal:** Whole active row highlighted on Create/View via `--grid-active-row-bg` set through a DOM attribute, no React re-render.
**Depends on:** Phase 77. Source: M8 §8.
**In scope:** Whole active row highlighted on Create/View via `--grid-active-row-bg` set through a DOM attribute, no React re-render.
**Out of scope:** Selection-range styling changes.
**Key files:** `DESIGN_TOKENS.md`, grid CSS, theme whitelist
**How to verify:** Token in every theme; render-count harness unchanged; perf re-check.

---

## Phase 79 — Extra free cells: model/persistence
**Goal:** `footer_extras_json` and `tail_rows_json` columns, model types, trim-on-save, undo, sync snapshot fields (optional), `sameContent`/`diffBills`, paper `tailRowCount`.
**Depends on:** Phase 78. Source: M8 §7.
**In scope:** `footer_extras_json` and `tail_rows_json` columns, model types, trim-on-save, undo, sync snapshot fields (optional), `sameContent`/`diffBills`, paper `tailRowCount`.
**Out of scope:** UI (Phase 80).
**Key files:** `DATA_MODEL.md`, `computeBill`, sync snapshot
**How to verify:** Round-trip tests; old branch strips unknown fields; undo/redo.

---

## Phase 80 — Extra free cells: grid UI
**Goal:** Editable extra cells on Items total / Adjustments total / Final total (or single Total) rows; unlimited tail rows below the Final total; units count continues the last segment.
**Depends on:** Phase 79. Source: M8 §7.
**In scope:** Editable extra cells on Items total / Adjustments total / Final total (or single Total) rows; unlimited tail rows below the Final total; units count continues the last segment.
**Out of scope:** Output (Phase 81).
**Key files:** grid components, `EXTRA_COLS_UNITS_RULES.md`
**How to verify:** Keyboard e2e; units tests; paste/Enter behaviour in tail rows.

---

## Phase 81 — Extra free cells: print/image/TSV output
**Goal:** Footer extras and tail rows render in print, image and TSV; paper row counts include non-empty tail rows.
**Depends on:** Phase 80. Source: M8 §7.
**In scope:** Footer extras and tail rows render in print, image and TSV; paper row counts include non-empty tail rows.
**Out of scope:** Printer-driver work.
**Key files:** print model, `billTsv`, `PAPER_ENGINE_RULES.md`
**How to verify:** Golden outputs; A5/A4 decision with tail rows; Phase 40 print fixtures still pass.
**Status:** done 2026-10-10 (see `PHASE_STATUS.md`).

---

## Phase 82 — Calculator engine + settings
**Goal:** Pure `shared/calc` expression engine (decimal.js, no eval), `%` semantics, settings `calc.percentPresets`.
**Depends on:** Phase 81. Source: `CALCULATOR_PANEL_RULES.md`.
**In scope:** Pure `shared/calc` expression engine (decimal.js, no eval), `%` semantics, settings `calc.percentPresets`.
**Out of scope:** Panel UI.
**Key files:** `shared/calc/*`
**How to verify:** Parser table + property tests.
**Status:** done 2026-10-10 (see `PHASE_STATUS.md`).

---

## Phase 83 — Calculator panel UI
**Goal:** Collapsible drawer above the bottom bar, two modes, persisted open/mode, Esc returns focus, toggle key chosen via the shortcut-conflict test.
**Depends on:** Phase 82. Source: `CALCULATOR_PANEL_RULES.md`.
**In scope:** Collapsible drawer above the bottom bar, two modes, persisted open/mode, Esc returns focus, toggle key chosen via the shortcut-conflict test.
**Out of scope:** On-screen keypad (open question).
**Key files:** Create page, `uiPrefs`, shortcuts
**How to verify:** Keyboard e2e; no dirty/undo effect; grid perf unchanged.
**Status:** done 2026-10-10 (see `PHASE_STATUS.md`).

---

## Phase 84 — Legacy importer (pure)
**Goal:** Pure parsing, PO rules, total recomputation, differences report, party grouping, fingerprint, duplicate-number rules.
**Depends on:** Phase 83. Source: `LEGACY_IMPORT_SPEC.md` §3–6.
**In scope:** Pure parsing, PO rules, total recomputation, differences report, party grouping, fingerprint, duplicate-number rules.
**Out of scope:** DB and UI.
**Key files:** `shared/legacyImport/*`
**How to verify:** Run against the owner's corpus (`docs/reference/legacy_import/Bills_JSON.zip`) and match the acceptance numbers in the spec.
**Status:** done 2026-10-10 (see `PHASE_STATUS.md`).

---

## Phase 85 — Legacy importer service/schema
**Goal:** Migration (`import_batches`, `legacy_ref`, `import_batch_id`, `import_fingerprint` unique), all-or-nothing transaction, `pre-import` backup, undo import, deterministic ids.
**Depends on:** Phase 84. Source: `LEGACY_IMPORT_SPEC.md` §7–8.
**In scope:** Migration (`import_batches`, `legacy_ref`, `import_batch_id`, `import_fingerprint` unique), all-or-nothing transaction, `pre-import` backup, undo import, deterministic ids.
**Out of scope:** UI.
**Key files:** `main/services/legacyImport*`
**How to verify:** Temp-DB import of the corpus; re-import is a no-op; undo removes exactly the batch.
**Status:** done 2026-10-10 (see `PHASE_STATUS.md`).

---

## Phase 86 — Importer UI + History Imported badge/filter/search
**Goal:** Settings 'Import legacy bills' (Pick, Reading, Preview, Import, Report); History 'Imported' tag, filter, legacy-ref search; imported bills are fully viewable and editable.
**Depends on:** Phase 85. Source: `LEGACY_IMPORT_SPEC.md` §9–10.
**In scope:** Settings 'Import legacy bills' (Pick, Reading, Preview, Import, Report); History 'Imported' tag, filter, legacy-ref search; imported bills are fully viewable and editable.
**Out of scope:** Sync.
**Key files:** Settings, History
**How to verify:** Keyboard walk-through; imported bill opens and edits.
**Status:** done 2026-10-11 (see `PHASE_STATUS.md`).

---

## Phase 87 — Sync: parties on receive + relink
**Goal:** Create/link parties when applying received bills (exact normalised name); one-time relink of old unlinked bills.
**Depends on:** Phase 86. Source: `SYNC_POSTBOX_SPEC.md` §10.
**In scope:** Create/link parties when applying received bills (exact normalised name); one-time relink of old unlinked bills.
**Out of scope:** Import enqueue.
**Key files:** `main/sync/apply*`, `partyRepo`
**How to verify:** Two virtual branches: received bills appear in Customers; relink is idempotent.
**Status:** done 2026-10-11 (see `PHASE_STATUS.md`).

---

## Phase 88 — Sync: import to outbox + dedupe
**Goal:** Bulk-enqueue imported bills in the outbox; dedupe by fingerprint and deterministic id; import on one branch.
**Depends on:** Phase 87. Source: `SYNC_POSTBOX_SPEC.md` §10.
**In scope:** Bulk-enqueue imported bills in the outbox; dedupe by fingerprint and deterministic id; import on one branch.
**Out of scope:** Progress UI.
**Key files:** `main/sync/outbox*`
**How to verify:** 1 000-bill import enqueues in bulk; duplicate delivery ignored.
**Status:** done 2026-10-11 (see `PHASE_STATUS.md`).

---

## Phase 89 — Sync progress UI (+ count RPC)
**Goal:** Send/receive progress events and progress bar; new server RPC `qt_pending_count`; SQL written, not run against a real Supabase.
**Depends on:** Phase 88. Source: `SYNC_POSTBOX_SPEC.md` §10.
**In scope:** Send/receive progress events and progress bar; new server RPC `qt_pending_count`; SQL written, not run against a real Supabase.
**Out of scope:** Real Supabase run.
**Key files:** `supabase/*`, `SUPABASE_MIGRATIONS.md`, sync UI
**How to verify:** InMemoryTransport progress tests; SQL recorded as a standing gap.

---

## Phase 90 — About publisher + Start fresh wipe
**Goal:** About: Publisher Ankit Shukla + email with copy/mailto through main; Level 1 / Level 2 wipe with typed confirmation, `pre-wipe` backup, PO restart choice, sync warning, license local deactivation on Level 2.
**Depends on:** Phase 89. Source: M8 §9–10.
**In scope:** About: Publisher Ankit Shukla + email with copy/mailto through main; Level 1 / Level 2 wipe with typed confirmation, `pre-wipe` backup, PO restart choice, sync warning, license local deactivation on Level 2.
**Out of scope:** Changing installer publisher / `APP_ID` / signing name.
**Key files:** Settings, `pendingRestore.ts`
**How to verify:** Wipe on a temp profile; backup exists first; no deletes sent to sync.

---

## Phase 91 — Milestone 8 QA gate + perf re-run + docs sweep
**Goal:** Run the Milestone 8 checklist, re-run the Phase 24/68 perf harnesses, sweep `PROJECT_STRUCTURE`/`API_CONTRACTS`, record standing gaps honestly.
**Depends on:** Phase 90. Source: M8 §13.
**In scope:** Run the Milestone 8 checklist, re-run the Phase 24/68 perf harnesses, sweep `PROJECT_STRUCTURE`/`API_CONTRACTS`, record standing gaps honestly.
**Out of scope:** Release (Phase 69).
**Key files:** all M8 files
**How to verify:** Checklist complete; perf within budget; then proceed to Phase 69.

---

# Milestone 9 — Post-Phase-91 owner feedback (Phases 92–106)

Design: `docs/MILESTONE9_DESIGN.md`. Phase 69 (RELEASE GATE) is still deferred and now runs AFTER Phase 106; no phase is renumbered. Items marked [A] are planner assumptions the owner has not explicitly confirmed.

---

## Phase 92 — Fix Settings Sync / License pages (infinite render loop)
**Goal:** Fix Settings Sync / License pages (infinite render loop).
**Depends on:** Phase 91 (Milestone 8 complete).
**In scope:** Open Settings > Sync and Settings > License without a crash. Cause found by reading the code (not run): `BootstrapPanel.tsx` line 10 reads `useBackupStore((s) => s.list.filter(...))`, which returns a NEW array on every store read, so React's external-store check loops forever ('Maximum update depth exceeded', logged twice in the owner's diagnostics). Select the raw list and filter with `useMemo`, then grep every `use*Store((s) => s.….filter|map|sort|slice|{…})` selector in the renderer for the same pattern and fix or wrap with a shallow/stable selector.
**Out of scope:** Rewriting the Sync or License features.
**Key files:** `components/settings/BootstrapPanel.tsx`, other store selectors
**How to verify:** A test that mounts every Settings section and fails on any console error / render-depth error; a lint-style test that flags selectors returning fresh arrays/objects; the owner re-opens Settings > Sync and > License (not seen in a window until then).

---

## Phase 93 — History list layout fix
**Goal:** History list layout fix.
**Depends on:** Phase 92.
**In scope:** The History table rows stay one line each: Bill No column wide enough for the number (e.g. `Q3-0728`) AND the 'Imported' badge without wrapping or overlapping; row height fixed; party/date/total aligned on the same baseline as the bill number; selected row not clipped; header columns align with body columns (same geometry source as Phase 70).
**Out of scope:** New History features, new columns.
**Key files:** `pages/History*`, history row/column CSS
**How to verify:** Row-geometry test (no wrapped cell at default width and at the 1024 px minimum width); pixel/e2e check is a standing gap until seen in a window; screenshot compared with the owner's.

---

## Phase 94 — Page navigation model: Dashboard is the root
**Goal:** Page navigation model: Dashboard is the root.
**Depends on:** Phase 93.
**In scope:** Replace 'Esc walks the whole back-stack' with a proper app model. [A] Esc on Dashboard does nothing; Esc on History / Customers / Settings goes to Dashboard; Esc on a bill opened from History goes back to History; Esc on Create goes through the save/discard guard then to Dashboard. The back-stack stops at Dashboard (never goes behind it) and the stack depth/duplicate-entry rules are pure and tested. Today `shared/routes.ts` keeps a 50-deep stack and `navBack` pops one entry per press.
**Out of scope:** Changing the frozen global shortcuts.
**Key files:** `shared/routes.ts`, `router/routerStore.ts`, `hooks/useHotkeys.ts`, `KEYBOARD_CELL_RULES.md`
**How to verify:** Pure table tests for every page + entry route; Esc 20 times from any page ends at Dashboard and stays; update F1 hints.

---

## Phase 95 — Esc guard: no stale 'already done' popups
**Goal:** Esc guard: no stale 'already done' popups.
**Depends on:** Phase 94.
**In scope:** Owner: repeated Esc shows popups for actions that were already completed. Reproduce first (record which popup, which page, which state), then fix the guard so it asks only when there is genuinely unsaved or unfinished work: no 'save?' after a successful Save, none for a cleared/fresh bill, none when the same dialog was already answered. Depends on the Phase 70 session-clear and Phase 94 model.
**Out of scope:** Redesigning the unsaved-bill resume feature.
**Key files:** `stores/guardStore.ts`, `stores/createSession.ts`, Create/Settings guards
**How to verify:** State-table tests: saved / discarded / fresh / dirty / resumed x Esc; no popup on the clean states; the repro steps are written in the phase log.

---

## Phase 96 — Theme infrastructure: scrollbar, title bar and effect tokens
**Goal:** Theme infrastructure: scrollbar, title bar and effect tokens.
**Depends on:** Phase 95.
**In scope:** Add tokens every theme must define: `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-size`, `--titlebar-bg`, `--titlebar-fg`, `--titlebar-symbol`, `--titlebar-hover` (+ whatever the glass/space themes need, e.g. `--surface-glass`, `--glass-blur`, `--glass-border`, `--bg-image` as url-free gradients). Add them to the theme whitelist, the tokens parity test and the custom-theme JSON docs; check whether the sanitiser accepts gradients (it bans `url()`), and clamp blur so a custom theme cannot hurt grid performance. Glass/blur may be applied to chrome only, never to the grid.
**Out of scope:** The four new themes themselves.
**Key files:** `styles/tokens.css`, `DESIGN_TOKENS.md`, tokens parity test, theme loader
**How to verify:** Parity test: every theme defines every new token; custom theme with bad values is clamped/ignored; contrast rules still pass.

---

## Phase 97 — Theme-aware scrollbars
**Goal:** Theme-aware scrollbars.
**Depends on:** Phase 96.
**In scope:** Replace the generic black/white scrollbars everywhere (grid, History, lists, dialogs, Settings) with thin, rounded scrollbars driven by the Phase 96 tokens (`scrollbar-color` / `scrollbar-width` plus `::-webkit-scrollbar` styling), so every current and future theme restyles them automatically. [A] thin and rounded; owner may change.
**Out of scope:** New theme palettes.
**Key files:** `styles/ui.css`, `grid.css`
**How to verify:** Static test: no hard-coded scrollbar colours outside tokens; every theme defines the tokens; grid scroll perf unchanged (harness re-run).

---

## Phase 98 — Theme-aware title bar (minimize / maximize / close strip)
**Goal:** Theme-aware title bar (minimize / maximize / close strip).
**Depends on:** Phase 97.
**In scope:** Colour the thin top strip from the theme. [A] Keep the native Windows buttons (snap, resize, accessibility unchanged) using Electron `titleBarStyle: 'hidden'` + `titleBarOverlay` (colour / symbol colour / height) and an in-app drag region showing the app name and icon; main updates the overlay when the theme changes (`win.setTitleBarOverlay`). The custom full title bar alternative is rejected unless the owner asks. Today the window uses the default native frame (`createMainWindow` in `main/window.ts`).
**Out of scope:** A fully custom window-button implementation.
**Key files:** `main/window.ts`, theme IPC, `components/layout/*`
**How to verify:** Overlay colour equals the theme token for every theme after a switch; drag region does not swallow clicks; real appearance is a standing gap until seen on Windows 11.

---

## Phase 99 — New theme: Glossy Glass
**Goal:** New theme: Glossy Glass.
**Depends on:** Phase 98.
**In scope:** Glassy, non-generic palette (NOT the usual AI purple/blue gradient): tinted translucent panels with blur and a thin light edge, glossy highlights, accent chosen to be distinctive. Chrome only; the grid stays flat, opaque and high-contrast (grid text >= 7:1). All Phase 96 tokens defined.
**Out of scope:** The other three themes.
**Key files:** `styles/tokens.css`, theme registry
**How to verify:** Parity + contrast tests; perf harness shows no grid regression with blur on; owner picks the final palette from a preview first.

---

## Phase 100 — New theme: Space (non-neumorphic)
**Goal:** New theme: Space (non-neumorphic).
**Depends on:** Phase 99.
**In scope:** Space look with flat/glow chrome instead of neumorphic shadows (raised/inset states still distinguishable without colour), url-free background (gradients only). Defines every token including scrollbars and title bar.
**Out of scope:** Image-based backgrounds.
**Key files:** `styles/tokens.css`
**How to verify:** Parity + contrast tests; raised/inset distinguishable check; owner preview sign-off.

---

## Phase 101 — New theme: Red and Navy Blue
**Goal:** New theme: Red and Navy Blue.
**Depends on:** Phase 100.
**In scope:** Red and navy palette distinct from the default Navy Ember (own surfaces, accent and `--rt-red` that still meets 4.5:1 on the grid and in print mapping).
**Out of scope:** -
**Key files:** `styles/tokens.css`
**How to verify:** Parity + contrast tests; the Red+Bold text colour stays distinguishable from the accent.

---

## Phase 102 — New theme: Red Deep-Black dark
**Goal:** New theme: Red Deep-Black dark.
**Depends on:** Phase 101.
**In scope:** Near-black surfaces with a red accent, OLED-friendly dark mode.
**Out of scope:** -
**Key files:** `styles/tokens.css`
**How to verify:** Parity + contrast tests; owner preview sign-off.

---

## Phase 103 — Theme picker and theme QA
**Goal:** Theme picker and theme QA.
**Depends on:** Phase 102.
**In scope:** Settings theme picker lists all themes (Navy Ember, Paper + the four new ones + custom files) with a live preview, persists the choice, switches without restart, and the title bar and scrollbars follow. Print stays unthemed.
**Out of scope:** New themes beyond these four.
**Key files:** Settings > Appearance
**How to verify:** Switch through all themes: no un-themed scrollbar/strip/dialog (static + e2e list); print output identical across themes.

---

## Phase 104 — Extra columns: Down key extends the rows
**Goal:** Extra columns: Down key extends the rows.
**Depends on:** Phase 103.
**In scope:** Bug: in the Create grid, pressing Down in an EXTRA column at the bottom does nothing and the cursor stays stuck. [A] Rule: only in extra columns, Down on the bottom-most editable row (the last tail row, or the Final total row when there are no tail rows) adds a new empty extra-only tail row below and moves into it, so more can be written; Down in every other column is unchanged (does nothing at the last row). Empty trailing tail rows are still trimmed on save (Phase 79) and never count toward paper rows (Phase 81). One undo step per added row. Also decide and test Down from the last item row into the footer extras.
**Out of scope:** Tail rows for non-extra columns; changing any other key.
**Key files:** `shared/nav/cellNav.ts`, grid keyboard handler, `EXTRA_COLS_UNITS_RULES.md`, `KEYBOARD_CELL_RULES.md`
**How to verify:** Pure reducer table tests (extra vs normal column, last row vs middle, smooth arrows ON/OFF); undo test; render-count harness unchanged.

---

## Phase 105 — HD image scale actually applies
**Goal:** HD image scale actually applies.
**Depends on:** Phase 104.
**In scope:** The owner's diagnostics log 'Image scale did not apply' on every copy: wanted 4x, expected width 2160 (2976 for a bigger bill), actual 675 (930), effective scale 1.25 - the render stays at the Windows display-scale factor, so the Phase 72 HD request is ignored on the owner's PC. Diagnose why the device scale factor override is not honoured (hidden/pooled window, Windows 125% scaling, `capturePage` ignoring the override), then fix with one of: Chromium devtools-protocol `Emulation.setDeviceMetricsOverride`, `setZoomFactor`, an offscreen window with the scale factor, or rendering the content at N x CSS size. Keep the verify-by-measuring step and the safe fallback; keep `IMAGE_MAX_PX`.
**Out of scope:** Changing the image layout or crop rules.
**Key files:** `main/print/electronImagePort.ts`, `shared/print/imageFlow.ts`
**How to verify:** Pure test for the chosen method; the log shows no warning on the owner's PC and the PNG width equals expected (owner check, since this only reproduces on a real Windows window).

---

## Phase 106 — Milestone 9 QA gate + perf re-run + docs sweep
**Goal:** Milestone 9 QA gate + perf re-run + docs sweep.
**Depends on:** Phase 105.
**In scope:** Full tests and typecheck, perf harness re-run (grid with every theme, blur on), Settings walk-through of every section, Esc walk-through of every page, sweep `PROJECT_STRUCTURE`/`API_CONTRACTS`, honest standing gaps. Then proceed to Phase 69.
**Out of scope:** Release (Phase 69).
**Key files:** all M9 files
**How to verify:** Checklist complete; perf within budget; then Phase 69.

---

# Milestone 10 — Item sorter (Phases 107–115)

Design and measurements: `docs/ITEM_SORTER_SPEC.md`. Phase 69 (RELEASE GATE) is still deferred and now runs AFTER Phase 115; no phase is renumbered. Items marked [A] are planner assumptions.

---

## Phase 107 — Item normaliser (pure)
**Goal:** Item normaliser (pure).
**Depends on:** Phase 106 (Milestone 9 complete).
**In scope:** Pure `shared/items/normalise.ts`: clean names, strip bracket notes, order-insensitive key, protected number/size/unit tokens, non-product line filter (spec section 2 steps 1-4).
**Out of scope:** Typo learning, DB, UI.
**Key files:** `shared/items/normalise.ts` (+ tests)
**How to verify:** Table tests from the corpus examples (TALCO 2044 = 2044 TALCO; ARIHANT 32X50 != 25X50; MILTON 505 != D7; notes stripped; GST EXTRA / LESS / ADVANCE filtered); run on `docs/reference/legacy_import/Bills_JSON.zip` and record distinct counts (expect ~3 470 token-set groups from 4 039 spellings).

---

## Phase 108 — Vocabulary, typo suggestions, tiers and families (pure)
**Goal:** Vocabulary, typo suggestions, tiers and families (pure).
**Depends on:** Phase 107.
**In scope:** Pure `shared/items/vocabulary.ts` + `grouping.ts`: learned token frequencies, typo candidates with the safety guards, Auto / Suggested / Separate tiers, brand families, 'why' explanation per spelling, owner rules applied last (spec section 2 steps 5-9).
**Out of scope:** Persistence and UI.
**Key files:** `shared/items/*` (+ tests)
**How to verify:** Known typos fixed (JUPITOR, GRIPER, BUTTTON, SHAKKTI); the six false matches (STEAM/SEAM, STRIKER/STICKER, PERAL/PERL, JACKO/JACK, GERMANY/GERMAN, SHAPE/SHAPES) are NOT automatic; ~1 215 groups with >= 2 sales on the corpus; deterministic output.

---

## Phase 109 — Item rules schema + repository
**Goal:** Item rules schema + repository.
**Depends on:** Phase 108.
**In scope:** Migration for `item_rules` (merge / split / ignore / family), repo with undo of the last decision, deterministic ids, soft delete, audit rows; derived cache table optional (spec sections 3-4).
**Out of scope:** Sync, UI.
**Key files:** `main/db/migrations/*`, `schema.ts`, `main/db/itemRulesRepo.ts`, `DATA_MODEL.md`
**How to verify:** Temp-DB tests: create/undo/delete rule, same decision twice = one row, migration on a Phase 91 database keeps all bills.

---

## Phase 110 — Items service: groups and sales read model
**Goal:** Items service: groups and sales read model.
**Depends on:** Phase 109.
**In scope:** Main service + IPC: build groups from ALL non-trashed bills (imported and new), incremental update on bill save/edit/delete/restore, full 'Rebuild' with progress, sales query per group split Non-GST / GST (by bill format and line GST), stats (count, min/median/max, latest, total qty), last rate per party and outlier flags, open-bill target (bill id).
**Out of scope:** UI and sync.
**Key files:** `main/services/itemsService.ts`, `main/ipc/items.ts`, `API_CONTRACTS.md`
**How to verify:** Tests on a temp DB seeded from the corpus: AMETO SMALL non-GST median 82; GST and non-GST never mixed; incremental update equals full rebuild; Save adds < 5 ms (budget proposed).

---

## Phase 111 — Items rules sync
**Goal:** Items rules sync.
**Depends on:** Phase 110.
**In scope:** New snapshot kind `item_rule`, outbox/apply, last-write-wins, optional for old branches, deterministic ids, fingerprint dedupe; tests on InMemoryTransport; wipe never sends deletes (spec section 6). [A]
**Out of scope:** Real Supabase run (standing gap), autocomplete.
**Key files:** `main/sync/*`, `SYNC_POSTBOX_SPEC.md` section 11
**How to verify:** Two virtual branches converge on the same rules; same decision twice = one rule; old-branch stripping test.

---

## Phase 112 — Items page shell + navigation
**Goal:** Items page shell + navigation.
**Depends on:** Phase 111.
**In scope:** Route `/items`, side-rail icon (Phosphor, no emoji), page with the three-window layout and focus movement, search box, empty/loading states, theme tokens only; Esc goes to Dashboard (Phase 94 model); opened bill returns to Items.
**Out of scope:** Window contents (Phases 113-114).
**Key files:** `shared/routes.ts`, `pages/Items.tsx`, `SideRail.tsx`, shortcuts registry
**How to verify:** Keyboard-only acceptance for the shell; shortcut-conflict test; F1 hints updated; renders with all themes.

---

## Phase 113 — Items windows 1 and 2: groups and spellings
**Goal:** Items windows 1 and 2: groups and spellings.
**Depends on:** Phase 112.
**In scope:** Window 1 families -> variants list (virtualised), Window 2 spellings with counts/last used/why, confirm-suggestion, merge, split, move, ignore ('not an item'), undo last decision, rule-backed.
**Out of scope:** Sales window.
**Key files:** `components/items/*`, `stores/itemsStore.ts`
**How to verify:** Selector-stability test (no fresh arrays); keyboard e2e: confirm a suggestion with one key; merge/split persists after restart.

---

## Phase 114 — Items window 3: sales, who-paid-what, open the bill
**Goal:** Items window 3: sales, who-paid-what, open the bill.
**Depends on:** Phase 113.
**In scope:** Sales table with Non-GST / GST tabs, summary stats, last rate per party, high/low outlier flags, party filter, copy as TSV; Enter / double-click opens that bill in View and Esc returns to the same Items selection.
**Out of scope:** Charts.
**Key files:** `components/items/SalesPanel.tsx`
**How to verify:** Numbers match the Phase 110 read model; GST tab shows GST %, tax and line total; open-bill round trip keeps the selection (jsdom + e2e written).

---

## Phase 115 — Milestone 10 QA gate + perf + docs sweep
**Goal:** Milestone 10 QA gate + perf + docs sweep.
**Depends on:** Phase 114.
**In scope:** Full tests/typecheck, perf at 5 000 bills / 60 000 lines (rebuild, page open, Save overhead), Items walk-through with keyboard only, sweep `PROJECT_STRUCTURE` / `API_CONTRACTS`, honest standing gaps. Then Phase 69.
**Out of scope:** Release (Phase 69).
**Key files:** all M10 files
**How to verify:** Checklist complete; budgets met or recorded; owner checks grouping quality on the real bills (the sandbox cannot judge it).

---

# Milestone 11 — Bug fixes and features after Phase 115 (Phases 116–127)

Design: `docs/MILESTONE11_DESIGN.md`. Phase 69 (RELEASE GATE) is still deferred and now runs AFTER Phase 127; no phase is renumbered. Items marked [A] are planner assumptions.

---

## Phase 116 — Notification discipline (no stacked toasts)
**Goal:** Notification discipline (no stacked toasts).
**Depends on:** Phase 115 (Milestone 10 complete).
**In scope:** List every notice raised on the Esc / page-switch path (owner to give texts; record them), then: identical messages replace each other, toasts clear on page change, max 2 visible, routine confirmations (undo/redo, repeated copy) go to the quiet status line instead of a toast. [A]
**Out of scope:** New notification centre.
**Key files:** `components/ui/Toast.tsx`, callers of `toast.show` / `useOptionalToast`
**How to verify:** Tests: 10 identical shows = 1 toast; page change clears; cap respected; Esc across all pages produces no stacked toasts (jsdom + e2e written).

---

## Phase 117 — Items page: names visible, scroll fixed, wide enough
**Goal:** Items page: names visible, scroll fixed, wide enough.
**Depends on:** Phase 116.
**In scope:** Fix the Groups virtualiser so every row renders when scrolled (one measured scroll element), Spellings name column full width with tooltip, Sales stats ignore zero/empty-rate lines, Down/PageDown/End reach the last item with correct rendering in all three windows.
**Out of scope:** New Items features.
**Key files:** `components/items/*`, `styles/grid.css` (.q3-items__*)
**How to verify:** Test with 3 000+ groups: last row reachable and visible; other windows stay in sync; no blank rows (jsdom + static + e2e written); zero-rate lines excluded from min/median.

---

## Phase 118 — Create always opens blank (hard rule)
**Goal:** Create always opens blank (hard rule).
**Depends on:** Phase 117.
**In scope:** Every entry to Create (side rail, shortcut, back, after Save, after Discard) opens a clean formatted empty bill; unsaved work is only protected by the Save/Discard/Cancel guard on leaving; crash-recovery draft offered only at app start. Supersedes the Phase 70 resume/New-button assumption. [A]
**Out of scope:** Editing existing bills (View/Edit route unchanged).
**Key files:** `stores/createSession.ts`, `pages/Create.tsx`, `draftStore`
**How to verify:** State-table tests of every entry path = blank bill; guard still protects unsaved work; resume logic removed or disabled with a test.

---

## Phase 119 — Grid clipboard: Ctrl+C / Ctrl+V on ranges and cells
**Goal:** Grid clipboard: Ctrl+C / Ctrl+V on ranges and cells.
**Depends on:** Phase 118.
**In scope:** Reproduce first (real-window e2e: select range, Ctrl alone, C, paste TSV from Notepad/Excel). Modifier-only keys never change focus/selection; Ctrl+C / X / V work for range, single cell, Append and Free modes; TSV paste flows into rows as designed; keep existing clipboard rules.
**Out of scope:** New clipboard formats.
**Key files:** `components/grid/gridController.ts`, `shared/nav/cellNav.ts`, clipboard bridge
**How to verify:** Pure test: bare Control/Shift/Alt produce no state change; controller tests for copy/paste events; real-window checklist in the log is a standing gap until the owner runs it.

---

## Phase 120 — Round-off actually applies to grand totals
**Goal:** Round-off actually applies to grand totals.
**Depends on:** Phase 119.
**In scope:** Reproduce per path (new bill, open from History, after Save, print, image, TSV, imported = 0 by design), inspect the stored `calc.roundOff` and the bill flag, fix the failing path(s), add a create -> total -> save -> reopen test.
**Out of scope:** Showing a round-off line (owner: no).
**Key files:** `stores/billStore.ts`, `pages/Create.tsx`, `main/services/billService.ts`, `shared/calc/billOptions.ts`
**How to verify:** Tests across every path give a whole-rupee grand total with the setting on and an unchanged total with it off; owner confirms on the real PC.

---

## Phase 121 — HD image really applies on the owner's PC
**Goal:** HD image really applies on the owner's PC.
**Depends on:** Phase 120.
**In scope:** The owner's screenshot after Phase 105 still shows 675 px. Log the real device scale factor and captured width, try the alternatives from Phase 105 until the width equals the plan, keep the measuring check, fallback and `IMAGE_MAX_PX`.
**Out of scope:** Layout or crop changes.
**Key files:** `main/print/electronImagePort.ts`, `shared/print/imageFlow.ts`
**How to verify:** Pure tests for the chosen method; the log shows no 'Image scale did not apply' and a PNG at the planned width (owner check on Windows).

---

## Phase 122 — Delete row (extras stay)
**Goal:** Delete row (extras stay).
**Depends on:** Phase 121.
**In scope:** Row selection (click row number / Shift+Space) then Delete removes the item cells; rows below move up; extra-column cells stay on their row positions; one undo step; units/segments recomputed in display order; adjustment/total rows not deletable. [A]
**Out of scope:** Reordering (Phases 123-124).
**Key files:** `shared/nav/cellNav.ts`, grid controller, `billStore`, `KEYBOARD_CELL_RULES.md` section 14
**How to verify:** Pure reducer + store tests (delete first/middle/last/only row, with extras, with marked segments); undo restores; paper row count updates; F1 hints.

---

## Phase 123 — Row reorder: model (pure)
**Goal:** Row reorder: model (pure).
**Depends on:** Phase 122.
**In scope:** Pure move-row operation (items move, extras stay [A]), formatting travels with the item cells, units/segments recomputed, one undo step, sync/diff treat a move as a change.
**Out of scope:** UI.
**Key files:** `shared/*` row model, `billStore`, `sameContent` / `diffBills`
**How to verify:** Table tests of moves (up/down/to top/bottom, across extras and marked segments); diff and sameContent detect a move; round trip to DB and snapshot.

---

## Phase 124 — Row reorder: keyboard and mouse UI
**Goal:** Row reorder: keyboard and mouse UI.
**Depends on:** Phase 123.
**In scope:** Alt+Up / Alt+Down move the active row (confirm via the shortcut-conflict test), optional drag handle; no render storm (render-count harness), F1 hints, themes.
**Out of scope:** New shortcuts beyond these.
**Key files:** grid controller, `shared/shortcuts.ts`
**How to verify:** Keyboard e2e; render-count harness unchanged; undo/redo of a move.

---

## Phase 125 — Dashboard data services (weather, forex, metals, holidays)
**Goal:** Dashboard data services (weather, forex, metals, holidays).
**Depends on:** Phase 124.
**In scope:** Main-process fetchers with cache + offline fallback + refresh timers; free no-key sources (Open-Meteo; a free forex feed verified for terms/availability; gold/silver source with a reliability note); offline Indian holidays table; settings `dash.city` (default Bangalore) with city search; CSP/host allow-list; privacy: only city and currency codes leave the PC. [A]
**Out of scope:** Tiles UI.
**Key files:** `main/services/dashboardLive*`, `shared/dashboard/*`, Settings
**How to verify:** Fetchers tested against fake HTTP; cache/offline tests; no network in tests; real API behaviour is a standing gap until run on the owner's PC.

---

## Phase 126 — Dashboard tiles UI (symmetric grid)
**Goal:** Dashboard tiles UI (symmetric grid).
**Depends on:** Phase 125.
**In scope:** Six tiles (Weather, USD/INR, EUR/GBP/AED, Gold & Silver, Clock & date, Upcoming holidays) in a 3x2 / 2x3 grid that never leaves an orphan tile at any window width >= 1024 px; per-tile on/off in Settings with reflow; dimmed 'offline' state; themed; separate 'Today' section [A].
**Out of scope:** New data sources.
**Key files:** `pages/Dashboard.tsx`, `components/dashboard/*`, Settings
**How to verify:** Layout test at 1024/1280/1920 px and every enabled-count 1-6 (no orphan); tiles respect all themes; Dashboard open time within the perf budget.

---

## Phase 127 — Milestone 11 QA gate + perf + docs sweep
**Goal:** Milestone 11 QA gate + perf + docs sweep.
**Depends on:** Phase 126.
**In scope:** Full tests + typecheck, perf harness re-run (grid with moves/deletes, Dashboard open), honest standing gaps (clipboard, round-off, HD image, live APIs need the owner's PC), sweep `PROJECT_STRUCTURE` / `API_CONTRACTS`. Then Phase 69.
**Out of scope:** Release (Phase 69).
**Key files:** all M11 files
**How to verify:** Checklist complete; budgets met or recorded; owner re-walks the reported bugs on the real app.

---

# Milestone 12 — Shared-notebook sync (Phases 128–143)

Spec: `docs/SYNC_SHARED_STORE_SPEC.md` (abbreviated `SS` below, binding); design and owner decisions: `docs/MILESTONE12_DESIGN.md`. Replaces the encrypted postbox of `SY`. Phase 69 (RELEASE GATE) is still deferred and now runs AFTER Phase 144 (Milestone 13); no phase is renumbered. Server phases (128-131) are SQL written and statically tested only: **never run against a real Supabase from the sandbox**; every real-Supabase item is a standing gap until the owner runs the checklist. Items marked [A] are planner assumptions. Money stays decimal strings; the Phase 92 selector rule applies to every new store.

---

## Phase 128 — Server schema v2 (records, history, members, branches, doorbell)
**Goal:** The shared-notebook tables exist as SQL with RLS on and no write policies.
**Depends on:** Phase 127. Source: `SS` sections 3, 4, 11.
**In scope:** Re-read Supabase's current plan and limits pages if the network allows (record the facts, or record "not checked"). `supabase/sql/11_members_branches.sql`, `12_records.sql`, `13_rls.sql`: `sn_members`, `sn_branches` (unique name_norm and PO prefix per organisation), `sn_records`, `sn_history`, `sn_ping`, the `server_seq` sequence, size/check constraints, RLS select policies for the caller's own organisation only, all other privileges revoked from `anon` / `authenticated`. `licenses` reused (no edit to files 01-06). Extend `src/__tests__/supabaseSql.test.ts` for the new files.
**Out of scope:** RPCs, license generator, any app code, dropping the v1 tables.
**Key files:** `supabase/sql/11_*.sql`..`13_*.sql`, `src/__tests__/supabaseSql.test.ts`, `docs/SUPABASE_MIGRATIONS.md`
**How to verify:** Static test: RLS enabled on every `sn_*` table, no insert/update/delete policy, no grant to `anon`, constraints present, files re-runnable (`if not exists`). Not run on Postgres (standing gap).

---

## Phase 129 — License + login generator (one query makes the license AND the email/password)
**Goal:** One SQL query in the Supabase SQL editor creates an organisation, its license key and one Supabase email/password per seat.
**Depends on:** Phase 128. Source: `SS` section 5.
**In scope:** `supabase/sql/14_license_admin.sql`: `qt_create_org(label, seats, emails text[] default null, domain text default ...)` returning `license_key, seat_no, email, password` (key stored hashed only; passwords bcrypt via `auth.users` insert + `auth.identities`; confirmed at once; generated emails or the owner's own); helpers `qt_add_seats`, `qt_reset_seat`, `qt_revoke_seat`, `qt_set_license_status`, `qt_attach_seat` (the documented fallback when creating users from SQL fails); all owner-only (not executable by app roles). `docs/SUPABASE_MIGRATIONS.md` "Create an organisation" section with the exact query, the dashboard fallback and the sign-ups-disabled instruction. `scripts/generate-license.mjs` is kept and marked legacy. [A]
**Out of scope:** App sign-in, RPCs used by the app.
**Key files:** `supabase/sql/14_license_admin.sql`, `docs/SUPABASE_MIGRATIONS.md`, `src/__tests__/supabaseSql.test.ts`
**How to verify:** Static test (functions exist, `security definer`, empty `search_path`, revoked from app roles, password never logged or stored in a plain column); key format and hash equal to the existing `qt_license_hash`. Whether Supabase accepts users created this way is a standing gap the owner confirms with the real query.

---

## Phase 130 — Server RPCs: activate, manifest, push, pull
**Goal:** The only write door and the read helpers for the notebook exist as RPCs with the exact version rules of the spec.
**Depends on:** Phase 129. Source: `SS` sections 6, 7, 11.
**In scope:** `supabase/sql/15_rpcs.sql`: `sn_now`, `sn_activate` (license + membership check, unique name and prefix, seat bound to one branch, explicit takeover flag), `sn_branch_name_free`, `sn_rename_branch`, `sn_list_branches`, `sn_manifest`, `sn_push` (`accepted` / `noop` / `won` / `lost`, history cap 20, one ping per call), `sn_pull` (by `server_seq`, 200 rows / about 4 MB, `has_more`, `server_time`), `sn_touch`. New error codes `Q3A01`, `Q3B04`, `Q3B05`, `Q3R01`; the generic `Q3L01` kept. Grants to `authenticated` only.
**Naming (Phase 130 as built):** the app-callable RPCs are named `sn_*`, not `qt_*`: the v1 functions `qt_list_branches`, `qt_push`, `qt_touch` have identical signatures and `create or replace` would have overwritten them while the v1 app still runs (until Phase 140). The owner-only `qt_create_org` family keeps its names. `sn_branch_name_free` takes an optional third argument (own branch id); `sn_manifest` returns a JSON array.
**Out of scope:** Realtime publication (Phase 131), app code.
**Key files:** `supabase/sql/15_rpcs.sql`, `docs/SUPABASE_MIGRATIONS.md` (RPC reference), `src/__tests__/supabaseSql.test.ts`
**How to verify:** Static test (every function `security definer`, empty `search_path`, `auth.uid()` used, no grant to `anon`, limits present). The conflict table of `SS` section 6 is restated as an executable truth table in a Vitest file that Phase 132's in-memory server must also pass. SQL not run (standing gap).

---

## Phase 131 — Server self-test v2 + Realtime publication
**Goal:** An owner-runnable self-test and the doorbell's server side.
**Depends on:** Phase 130. Source: `SS` sections 10, 13.
**In scope:** `supabase/sql/16_realtime.sql` (add `sn_ping` to the Realtime publication, idempotent) and `supabase/sql/91_selftest_v2.sql` (ends in ROLLBACK; covers org creation, name/prefix clash, seat takeover, push accepted / noop / conflict both ways, tombstone, pull cursor, RLS isolation between two organisations, anon refused). Optional owner-run `99_drop_v1.sql` is only WRITTEN here (not wired; used in Phase 142). `docs/SUPABASE_MIGRATIONS.md` run order and the real-Supabase checklist v2 (sections A-E of the old checklist rewritten for sign-in, compare, conflict, pause).
**Out of scope:** Running anything.
**Key files:** `supabase/sql/16_realtime.sql`, `91_selftest_v2.sql`, `99_drop_v1.sql`, `docs/SUPABASE_MIGRATIONS.md`
**How to verify:** Static parse/shape test; the checklist and self-test are listed as the owner's standing gap.

---

## Phase 132 — Client transport v2 + sign-in (in-memory first)
**Goal:** The app can sign in and talk to the notebook through one interface, proven against an in-memory server that mirrors the RPC rules.
**Depends on:** Phase 131. Source: `SS` sections 3, 11, 12.
**In scope:** `main/sync/sharedTransport.ts` (`SharedStoreTransport`, `InMemorySharedTransport` copying Phase 130's rules, `SupabaseSharedTransport` as the only importer of `@supabase/supabase-js`); `signInWithPassword`, session refresh, error mapping (`AUTH_FAILED`, `LICENSE_INVALID`, `SERVER_PAUSED` distinct from offline); session + seat password wrapped by `safeStorage` in `sync_state`; activation service v2 (URL, anon key, license, email, password, branch name, PO prefix, takeover). The renderer never receives secrets. Refuse a `service_role` key as in Phase 52.
**Out of scope:** Push/pull workers, UI.
**Key files:** `main/sync/sharedTransport.ts`, `main/sync/activationV2.ts`, `shared/sync/license.ts`, `main/db/syncStateRepo.ts`
**How to verify:** Vitest on the in-memory transport and the truth table of Phase 130; mocked HTTP error mapping; secrets absent from logs/status; typecheck; real Supabase = standing gap.

---

## Phase 133 — Local schema 0006, snapshot codec v2, version stamp, set-aside
**Goal:** Records are stored/read as plain stamped JSON; newer data from a newer app is set aside, never stripped.
**Depends on:** Phase 132. Source: `SS` section 8; `DM`.
**In scope:** Migration `0006` (table `sync_record_state(kind, rec_id, base_version, base_hash, server_seq, synced_at)`, table `sync_aside(kind, rec_id, version, min_reader_ver, payload_json, seen_at)`, `parties.merged_into` nullable); pure `shared/sync/codecV2.ts` (`encodeRecord` / `decodeRecord`, `READER_VER`, `schema_ver`, `min_reader_ver`, `unknown_json` preserved and re-emitted); `retryAside()`; local edit of an aside record blocked.
**Out of scope:** Workers, UI.
**Key files:** `main/db/migrations/0006_*.sql`, `main/db/schema.ts`, `shared/sync/codecV2.ts`, `main/db/syncRecordRepo.ts`
**How to verify:** Migration test on a real temp SQLite (old DB upgrades, new tables empty); codec round trip incl. unknown optional fields; reader older than `min_reader_ver` sets aside and does not overwrite; retry applies after the reader version rises.

---

## Phase 134 — Diff matcher (pure)
**Goal:** The compare step as a tested pure function.
**Depends on:** Phase 133. Source: `SS` section 7.
**In scope:** `shared/sync/diff.ts`: `planSync(local, remote) -> { skip, upload, download, conflict }` per the table in `SS` section 7; content hash over the canonical sync fields (same notion as `sameContent` / legacy fingerprint, never `revision` / `updated_at`); `resolveConflict(a, b)` (later skew-corrected `edited_at`, tie: greater branch id); clock-offset helper (`offsetFromServerTime`, 2-minute warning threshold).
**Out of scope:** I/O.
**Key files:** `shared/sync/diff.ts`, `shared/sync/canonicalJson.ts`
**How to verify:** Table tests incl. the owner's real shapes (1 927 identical bills = all skip; 761 only-local = upload; same id, different content = conflict); property test: plan then apply on both sides converges; no float / no fresh-object selector issue.

---

## Phase 135 — Push/pull workers v2 + first compare
**Goal:** Changes flow both ways through the notebook; a new or returning computer catches up without a backup file.
**Depends on:** Phase 134. Source: `SS` sections 6, 7.
**In scope:** Outbox reused for capture (bulk enqueue of imported bills kept from Phase 88); push worker sends `base_version`; handles `accepted` / `noop` / `won` / `lost` (a `lost` stores the local version as a local revision); pull worker by `server_seq` cursor (no ack, no delete; idempotent apply; failing row never blocks the cursor: it is recorded and retried, then set aside after the existing attempt cap); first-run "Compare and sync" using `sn_manifest` + `planSync`, resumable and with the existing progress events (Phase 89). Backoff and kick-after-Save timings reused from Phase 55/56.
**Out of scope:** Doorbell, UI, cutover.
**Key files:** `main/sync/pushWorkerV2.ts`, `main/sync/pullWorkerV2.ts`, `main/sync/compareService.ts`, `shared/sync/{push,pull,progress}.ts`
**How to verify:** Two virtual branches on real temp SQLite over `InMemorySharedTransport`: save on A appears on B; edit on both, later wins, loser is a revision; 761 imported bills upload once and B downloads them; a new third branch gets everything from 0; a crash mid-pull replays safely.

---

## Phase 136 — Apply on receive: revisions, tombstones, parties, item rules, set-aside count
**Goal:** Everything a received record needs locally.
**Depends on:** Phase 135. Source: `SS` sections 6, 8; Phases 56, 57, 87, 111.
**In scope:** `remoteApplier` for kinds `bill`, `party`, `item_rule` over the v2 records (soft-delete tombstones; restore is a new version; open-bill banner reused, never overwriting the open editor); party link by id (then exact normalised name as before); item rules keep their ordering rule; `sync_aside` count in the status overview and in History ("Update the app to see N bills").
**Out of scope:** Customer merging (Phase 137).
**Key files:** `main/sync/remoteApplierV2.ts`, `main/db/remoteApplyRepo.ts`, `shared/sync/manager.ts`
**How to verify:** Tests per kind incl. delete/restore, open-bill banner, an aside bill never overwritten and counted; party link idempotent.

---

## Phase 137 — Customers: exact-name auto-merge, Possible duplicates, synced merges
**Goal:** The same customer never exists twice; similar names are merged only by the owner.
**Depends on:** Phase 136. Source: `SS` section 9.
**In scope:** Deterministic party record id from `org|name_norm`; one-time idempotent **unify** (survivor = most bills, tie oldest; re-point bills; soft-delete others; emit `party_merge`) with undo; Customers page section "Possible duplicates" (fuzzy + token rules, Merge / Not the same, undo last merge, keyboard-first, shortcuts registered); `party_merge` record kind applied everywhere. Counts-only test on a generated corpus; no real names in code, tests or logs. [A]
**Out of scope:** Auto-merging similar names.
**Key files:** `shared/customers/duplicates.ts`, `main/db/partyRepo.ts`, `main/services/customerService.ts`, `pages/Customers.tsx`, `shared/shortcuts.ts`
**How to verify:** Pure tests (exact = one record; similar names only suggested); unify on a generated duplicate corpus then on a second branch converges to the same survivor; undo; selector-stability test.

---

## Phase 138 — Realtime doorbell + poll fallback
**Goal:** The other computer sees a change within seconds, and still works when Realtime does not.
**Depends on:** Phase 137. Source: `SS` section 10.
**In scope:** Re-read the live Supabase Realtime limits and record them (or "not checked"). `subscribeDoorbell` in `SupabaseSharedTransport` (main only; `postgres_changes` on `sn_ping`, org filter); 500 ms debounce; 60 s poll always on; reconnect with backoff; status text "Live" vs "Checking every minute"; no CSP or renderer network change.
**Out of scope:** Sending data over Realtime.
**Key files:** `main/sync/sharedTransport.ts`, `main/sync/doorbell.ts`, `shared/sync/manager.ts`
**How to verify:** In-memory doorbell tests (event -> one debounced pull; dropped events -> poll catches up; reconnect); real Realtime = standing gap.

---

## Phase 139 — Settings > Sync UI v2 (sign-in, branch name, branches, status)
**Goal:** The owner activates a computer with email + password and chooses its branch name.
**Depends on:** Phase 138. Source: `SS` sections 3, 5, 11.
**In scope:** Sync section: URL, anon key, license key, email, password, branch name (live "name free?" check), PO prefix, device label, seat-takeover prompt; branch list (rename with the same uniqueness check); status (Live / paused server / signed-out / offline / aside count / clock offset warning); Sync now; Compare and sync; no passphrase fields anywhere; every action keyboard-reachable with palette entries; themed; the Phase 92 selector rule.
**Out of scope:** Cutover wizard (Phase 140).
**Key files:** `components/settings/SyncSection.tsx`, `components/sync/SyncStatusPanel.tsx`, `stores/syncStatusStore.ts`, `shared/sync/manager.ts`
**How to verify:** jsdom tests with a fake bridge (valid / name taken / prefix taken / seat in use / bad password / paused server); no secrets echoed; F1 hints; real window = standing gap.

---

## Phase 140 — Cutover from v1 (wizard, safety backup, first compare)
**Goal:** The owner's two computers move to the notebook without losing or duplicating anything.
**Depends on:** Phase 139. Source: `MILESTONE12_DESIGN.md` section 6.
**In scope:** Detect an active v1 activation; force a fresh local backup first (and say why: the Free plan has no server backups); stop v1 workers; keep v1 settings readable but inert; guided steps: sign in, choose name, first compare (progress), then optional customer unify; suspend/abandon the v1 license note; "Join an existing branch" import stays available as a manual tool but is no longer needed for sync.
**Out of scope:** Deleting v1 code (Phase 142).
**Key files:** `main/sync/cutoverService.ts`, `components/settings/CutoverWizard.tsx`, `main/sync/syncManager.ts`
**How to verify:** Simulation: two branches holding the same 1 927 bills plus 761 / 1 166 one-sided bills end identical after the wizard on each; re-running is a no-op; interrupted wizard resumes; v1 rows never read.

---

## Phase 141 — Simulation harness v2 and convergence tests
**Goal:** Prove convergence under bad conditions without a real server.
**Depends on:** Phase 140. Source: `SS` section 13; Phase 60 harness.
**In scope:** N virtual branches over `InMemorySharedTransport` wrapped by the existing `FlakyTransport` idea (loss, delay, down, duplicate delivery); seeded property tests: random edits/deletes/restores/merges on 3 branches then full sync = identical content everywhere; version skew (an older reader) sets aside and later applies; 1 000-operation soak; clock-offset scenarios decide conflicts correctly; Windows-flake note for the soak seed recorded.
**Out of scope:** Real network.
**Key files:** `main/sync/__tests__/simHarnessV2.ts`, `harnessV2.test.ts`, `main/sync/flakyTransport.ts`
**How to verify:** The new suite green with fixed seeds; timing recorded; any flake is logged, not hidden.

---

## Phase 142 — Retire v1 (crypto, passphrase, postbox) and sweep errors/strings
**Goal:** One sync engine remains.
**Depends on:** Phase 141 and the owner's confirmation that the real-Supabase checklist passed on the two real computers (if not confirmed, do only the dormant-flag part and say so). [A]
**In scope:** Remove `sync/crypto.ts`, passphrase and key-check handling, postbox transport, ack paths, v1 UI strings and `DECRYPT_FAILED`; keep the importer; wire `99_drop_v1.sql` into the docs as an owner-run step; update `SYNC_POSTBOX_SPEC.md` to a history banner, `SECURITY_MODEL.md`, `SUPABASE_MIGRATIONS.md`, `CLAUDE_MUST_READ.md` section 3, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`. Every deletion logged in `PHASE_STATUS.md` (this is the one place removal is expected).
**Out of scope:** New features.
**Key files:** `main/sync/*`, `shared/sync/*`, `src/__tests__/importBoundaries.test.ts`, docs listed above
**How to verify:** Typecheck + full suite green; import-boundary test still allows `@supabase/supabase-js` only under `main/sync`; grep shows no passphrase / postbox references outside history docs.

---

## Phase 143 — Milestone 12 QA gate + perf + docs sweep
**Goal:** Gate for the milestone.
**Depends on:** Phase 142.
**In scope:** Full tests + typecheck; perf (a 2 000-bill first compare, a 1 000-record pull page, Dashboard open and grid numbers not regressed); honest standing gaps (real Supabase run of 11-16 / 91 / 14, generator accepted by Auth, Realtime on the free plan, pause/restore behaviour, real two-computer cutover); sweep `PROJECT_STRUCTURE` / `API_CONTRACTS` / `DATA_MODEL`. Then Phase 69.
**Out of scope:** Release (Phase 69).
**Key files:** all M12 files
**How to verify:** Checklist complete; budgets met or recorded; owner re-walks the real-Supabase checklist (`SUPABASE_MIGRATIONS.md`) on both computers.

---

# Milestone 13 — Print position bug (Phase 144)

Owner report 2026-10-12 (photo of a real A4 printout): the bill starts roughly 65-70 mm down the sheet and leaves about 95 mm blank below, so it looks vertically centred; it must start at the top (10 mm margin) and leave the white space at the bottom. Phase 73 had only diagnosed this from the source ("most likely the printer driver / page setup") and never saw paper. This phase is REPRODUCE-FIRST (same discipline as Milestone 11): decide whether it is the template, Electron's print call, or the driver, then fix what is ours. Independent of Milestone 12: depends only on Phase 127 and may run BEFORE Phase 128. Phase 69 (RELEASE GATE) now runs AFTER Phase 144.

---

## Phase 144 — Print starts at the top: verify, find the cause, fix
**Goal:** An A4 (and A5) printout starts at the page's top margin and leaves the spare white space at the bottom, proven on paper by the owner.
**Depends on:** Phase 127 (Phase 73's top-aligned CSS and the print port). Not on Milestone 12.
**In scope:**
1. **Prove the template in the sandbox.** Render the Rough and Professional A4 and A5 HTML (a 15-row bill like the owner's, plus 1 row, plus a 60-row bill) to PDF in headless Chromium with the same `@page` and options the app uses, and measure the first ink / first text Y from the top (`pdftotext -bbox` or equivalent). Expected: about the page margin (10 mm A4, 6 mm A5), never more. Record the numbers. If this already fails, the template is the cause: fix it.
2. **Add a print diagnostic** behind `QUOT3_PRINT_DEBUG=1` (like `QUOT3_IMAGE_DEBUG`): log paper, `pageSize` actually passed, margins, hidden-window size, the `@page` rule, the measured content height, device name; never bill content, names or phones.
3. **Owner paper test (the decisive step, written as a 5-line checklist in the phase log):** same bill printed (a) via Save PDF opened full-size, (b) to "Microsoft Print to PDF", (c) to the real printer, (d) the real printer with the driver's centring / fit-to-page off and paper = A4 actual size. Record which of (a)-(d) show the gap. Rule: PDF good + real printer bad = driver or Windows setup (document the exact settings in the Print settings help and the dialog; no code change beyond that); PDF bad = ours.
4. **Fix what is ours, smallest first, one at a time, each with a test:** (i) pass the page size to `webContents.print` as an explicit width/height in microns instead of the `'A4'` string, and compare; (ii) try `marginType: 'printableArea'` / custom margins with the template carrying the 10 mm top gap itself, instead of `none` plus CSS `@page` margins (the code comment says the template's margins win; confirm that is true in the installed Electron or correct the comment); (iii) check the hidden window's size / `useContentSize` / `scaleFactor` / `pagesPerSheet` are not shrinking or re-paginating the page; (iv) only if the owner confirms the driver adds a fixed shift that cannot be switched off: a Settings > Print \"Vertical adjust (mm)\" nudge, default 0, clamped, applied as extra top margin and never changing the image/PDF output [A].
5. A5 gets the same measurement and the same fix; Save PDF and Print must agree.
**Out of scope:** Template redesign, the image-copy path (Phases 105/121/127 hotfixes), paper-size decisions (Phase 36-37), sync.
**Key files:** `shared/print/template/printCss.ts`, `shared/print/printFlow.ts`, `shared/print/printConstants.ts`, `main/print/electronPrintPort.ts`, `main/services/printService.ts`, Settings > Print (only for item 4(iv))
**How to verify:** Sandbox PDF measurements (first-ink Y per template/paper/row count) recorded in `PHASE_STATUS.md`; a regression test that fails if the sheet gains any top offset beyond the page margin and, if item 4 changes the port options, a test on the exact options passed; typecheck and the print suites green. **What the sandbox cannot prove** (Electron print to a real printer) is a standing gap until the owner reports the paper test results; never write \"fixed\" before that.

---

# Milestone 14 — Owner feedback for 0.1.7 (Phases 145–153)

Read `docs/MILESTONE14_DESIGN.md` before any Phase 145–153 (it holds the owner's rules and the [A] assumptions). **Testing rule for every phase below: never run the full test suite; run `npm run typecheck` plus only the test files you wrote/changed and the ones that could conflict with the change (`CLAUDE_MUST_READ.md` 10i).** Order is flexible (see its section 2); Phase 69 (RELEASE GATE) runs AFTER Phase 153. Each phase that changes the app follows `GITHUB_UPDATE_PUSH.md` only at Phase 153 (one release, 0.1.7) unless the owner asks for an earlier one.

## Phase 145 — Party combobox: full names visible
**Goal:** The party-name dropdown on Create shows each party's whole name (long names wrap, nothing truncated with an ellipsis in the LIST).
**Depends on:** none.
**In scope:** the dropdown width/wrapping (see design 1.1); keep keyboard behaviour (ArrowUp/Down, Enter, Esc, Tab) exactly as Phase 26 defined; the input box keeps its size.
**Out of scope:** search ranking, party data, the Customers page.
**Key files:** `components/create/PartyAutocomplete.tsx`, `styles/grid.css` (find the combobox classes with grep).
**How to verify:** component test with a very long name (wrapped, full text present, no `text-overflow: ellipsis` on list rows), existing party autocomplete tests green, typecheck.

## Phase 146 — History sorted by invoice number
**Goal:** History is one plain list, not split by branch, sorted by invoice number.
**Depends on:** none.
**In scope:** pure comparator in `shared/` (numeric part, tie-break prefix then date; design 1.2) used as the default History order; tests with mixed prefixes (`AV-0748`, `AV-0749`, another prefix at the same number, numbers of different widths such as `9` and `10`, malformed numbers last).
**Out of scope:** branch filters (keep as they are), schema, sync.
**Key files:** `shared/history/*` (locate), `main/services/historyService.ts` or the history repo query, `pages/History.tsx`.
**How to verify:** comparator unit tests, one history service/UI test showing the order, typecheck.

## Phase 147 — Create toolbars: visible names, hidden on small screens
**Goal:** Icon buttons in the Create page top toolbar and bottom action bar show their name next to the icon; on small screens only icons show (tooltips stay).
**Depends on:** none.
**In scope:** labels from the existing shortcut/palette registry names where they exist (one source of truth), a CSS/container breakpoint (design 1.4), no change to heights beyond the existing budget, no hardcoded colours.
**Out of scope:** other pages' toolbars (note them in the log if also icon-only), new buttons.
**Key files:** the Create page toolbar / action bar components (locate with grep), `styles/*.css`.
**How to verify:** component test that labels render at a wide width and are hidden (class/attribute) at a narrow one; layout-density tests (20 rows at 1366x768) still green; typecheck. Real look = owner's PC (standing gap).

## Phase 148 — Print spatial awareness (fit-to-page), A5 and A4
**Goal:** Printed A5 / A4 bills use the page well so text is easy to read, without making short bills fill the page, with the old behaviour as a configurable fallback.
**Depends on:** 144 (print position rules).
**In scope:** design 1.3 in full: pure fit engine (scale factor from measured content height, paper and cap), wiring into the print model/template for Print, Save PDF and image copy, Settings > Print "Fit bill to page" (On default) + max enlargement, Off = identical to today, thresholds untouched, tests table, measurements of first-ink Y still top-aligned.
**Out of scope:** changing 40/30/80/70, template redesign, driver issues, Hybrid and Stock transfer layouts (they reuse the engine later).
**Key files:** `shared/print/*` (new `fitScale.ts`), `shared/print/template/printCss.ts`, `shared/print/printFlow.ts`, `shared/paper/paperConstants.ts` (read only), Settings > Print section.
**How to verify:** engine unit tests (5-6 rows stays near 1.0-cap, 40 rows, long wrapped names, adjustments, extra cols, A5 and A4, Off = unchanged output), headless-Chromium PDF measurement recorded in `PHASE_STATUS.md` (no overflow, top-aligned), typecheck. Real printer = standing gap.

## Phase 149 — Stock transfer format (Alt+4)
**Goal:** A fourth format "Stock transfer": Item name + Qty (words allowed), no party, "Select branch for transfer" instead.
**Depends on:** none (uses the branch list).
**In scope:** design 1.5: one format-registry entry (columns, free-text qty for this format only, no money columns/totals), header with branch picker, PO/date/save/history/print/image as [A] stated, Alt+4 + palette entry (frozen shortcut tests updated WITH this approval), print layout, tests (registry, calc = no totals, qty accepts "two dozen" and "12", other formats still reject words, switching formats never loses data, save/load round trip).
**Out of scope:** actually moving stock between branches (no inventory), Hybrid.
**Key files:** `shared/format/registry.ts` + new format file, `shared/shortcuts.ts`, create header components, `shared/print/*`, bill save/serialize (check the bill record stores qty as a string).
**How to verify:** pure tests above, UI test for the branch picker replacing the party field, typecheck.

## Phase 150 — Hybrid format: model, contract, pure logic, storage
**Goal:** The data model and pure logic for Hybrid, with NO UI yet.
**Depends on:** none.
**In scope:** design 1.6 rules 1-11; FIRST extend `API_CONTRACTS.md` (supersession of rule 4.5, storage shape, sync `min_reader_ver` handling, what Items/dashboard/export count); pure functions: `makeSecondTable(bill)` (GST->non-GST and non-GST->GST copy of names, qty, amounts; no adjustments, no labels; shared extra columns), independent calc per table, switch in/out without loss, no overwrite on second Alt+3, serialize/deserialize/normalize, `sameContent`/`diffBills` aware, undo model decision; storage as an optional field if possible (no migration), otherwise a new numbered migration (then `schema: N` applies, see `GITHUB_UPDATE_PUSH.md`).
**Out of scope:** UI, print (Phase 152).
**Key files:** `shared/format/*`, `shared/calc/*`, bill record/serialize, `shared/sync/*` (read), `API_CONTRACTS.md`.
**How to verify:** thorough unit tests (round trips, independence after copy, separate totals, shared extra cells, adjustments separate, both start sides), typecheck.

## Phase 151 — Hybrid format: Create UI (Alt+3)
**Goal:** Alt+3 shows the two tables side by side; both editable; shared extra columns; own adjustments per side.
**Depends on:** 150.
**In scope:** layout that respects density (5.2) and the keyboard rules (navigation between tables per design 1.6 [A]), Alt+3 + palette, per-side adjustments UI, shared extra columns, undo/redo, draft/autosave, format-switch behaviour per rules 10-11, selector rule (Phase 92) for new stores, tests.
**Out of scope:** print/image (Phase 152).
**Key files:** grid components, `billStore`, `cellNav` reducer, `shortcuts.ts`.
**How to verify:** reducer/store tests, component tests for both tables, existing grid tests not regressed (note: some grid tests were already failing before this milestone, see `PHASE_STATUS.md` 0.1.5 entry), typecheck.

## Phase 152 — Hybrid output: ask which side, output only that side
**Goal:** In Hybrid, Print / Save PDF / image copy (and any other output path) first ask "GST side or non-GST side?" and output ONLY the chosen side in that format's normal layout.
**Depends on:** 148, 150, 151.
**In scope:** the side-picker dialog (keyboard friendly: G / N, Esc cancels with nothing printed), routing the chosen side through the existing print model (so fit-to-page, hide-adjustments-total setting, rupee sign etc. apply), shared extra columns printed on both outputs, tests that exactly one side's data reaches the output.
**Out of scope:** printing both sides on one page.
**Key files:** `shared/print/printFlow.ts`, `printService`, `imageService`, clipboard text copy, the print/copy dialogs.
**How to verify:** unit tests per output path (GST side vs non-GST side, nothing of the other side present), typecheck. Real printing = owner's PC.

## Phase 153 — Milestone 14 QA gate and release 0.1.7
**Goal:** Check Phases 145-152 together, then ship version 0.1.7.
**Depends on:** 145-152.
**In scope:** run the touched suites + typecheck; reconcile `PHASE_STATUS.md`; update `GITHUB_UPDATE_PUSH.md` / `API_CONTRACTS.md` / `PROJECT_STRUCTURE.md`; bump the version to 0.1.7 (package.json + both spots in package-lock.json) and hand back the changed-files zip, the full zip and the push steps per `GITHUB_UPDATE_PUSH.md` section 2. The release notes line `schema: N` is written by the workflow (N = migration count).
**Out of scope:** new features.
**How to verify:** suites green or each failure listed with its cause; owner checklist for what only a real PC can show (print size, Hybrid layout, toolbar look).


---

# Milestone 15 — Legacy watch: background app + automatic legacy import (Phases 158–164)

Read `docs/MILESTONE15_DESIGN.md` before any Phase 158–164 (owner's rules and [A] assumptions). **Testing rule for every phase below: never run the full test suite; run `npm run typecheck` plus only the test files you wrote/changed and the ones that could conflict (`CLAUDE_MUST_READ.md` 10j). Name them in the phase log and list what was not run.** Order: 158, 159, 160, then 161 (any time after 158), 162, 163, 164. Only Phase 164 bumps the version (0.1.12) and hands back the zips per `GITHUB_UPDATE_PUSH.md` section 2. Phase 69 (RELEASE GATE) still runs after the last feature phase.

## Phase 158 — Legacy watch: content fingerprint and classifier (pure)
**Goal:** The pure rules that decide what an incoming legacy file is: new, exact duplicate, edited copy, older copy, or uncertain.
**Depends on:** the existing `shared/legacyImport/*` parse/convert code.
**In scope:** design 3.1-3.4: `contentFingerprint` (ignores the PO number), line matching by normalised name, the 50% shared-lines threshold as a named constant, `classify(incoming, candidates, ctx)` returning `{kind, candidates, reason}`, mtime-wins rule, stable oldest-first ordering helper. No I/O.
**Out of scope:** database, files, UI.
**Key files:** new `src/shared/legacyWatch/{fingerprint,classify,order}.ts` + tests; reads `shared/legacyImport/*`.
**How to verify:** unit tests with SYNTHETIC bills only: exact duplicate with a different PO, edit kinds (item added/removed/renamed, qty/rate change, adjustments-only, phone/transport-only), same party+day but different bill, two candidates, older copy, ordering independent of input order; typecheck.

## Phase 159 — Legacy watch: storage and apply engine
**Goal:** Remember what was seen and apply a classification safely and undoably.
**Depends on:** 158.
**In scope:** one new numbered migration (state table: file name, size, mtime, content hash, last result, bill id; needs-review table; activity table of the last 200 events) and the repo for them (the release `schema: N` line covers the migration, see `GITHUB_UPDATE_PUSH.md`); decide and record how "bill edited inside Quot3 after import" is detected (design 3.3); `applyDecision` that, per file in one transaction through the normal bill write path, imports a new bill, updates an existing bill in place as a new revision, skips a duplicate, or files a review item; one `pre-import` backup per batch; Undo for automatic imports/updates (a revision restore or an ignore marker, never a delete); same-number clash rules reused from the existing importer.
**Out of scope:** watching folders, UI.
**Key files:** `src/main/db/migrations/*`, schema + repo files, new `src/main/services/legacyWatchApply.ts`, bill service (read/extend carefully).
**How to verify:** service tests on an in-memory DB with synthetic bills (new, duplicate, edited newer, edited older, locally edited -> review, undo), outbox rows exist after an import, migration count tests updated; typecheck.

## Phase 160 — Legacy watch: folder scanner service
**Goal:** Find new/changed legacy files and feed them to the engine, reliably.
**Depends on:** 158, 159.
**In scope:** design 3.6: `fs.watch` + timed rescan (default 2 min [A]) + `scan()` entry for wake; debounce; skip unstable/unparseable files and retry; state-table check so unchanged files are not re-read; oldest-mtime-first batches; status object (last scan, counts, sync on/off, errors); pause/resume; a missing or unreachable folder reports a plain status and never crashes; settings keys + Zod schema (folder path, enabled, interval) with OFF defaults; IPC channels (`legacyWatch:status`, `scanNow`, `pause`) in `shared/ipc.ts`, preload, `window.quot3`.
**Out of scope:** tray/login item (161), UI (162-163).
**Key files:** new `src/main/services/legacyWatchService.ts`, `src/main/ipc/legacyWatch.ts`, `shared/settings.ts`, `shared/ipc.ts`, preload, `main/index.ts` wiring.
**How to verify:** service tests with a temp folder and fake timers (new file imported, unchanged file skipped, half-written file retried, folder missing, pause), IPC schema tests, typecheck.

## Phase 161 — Background mode: start at sign-in, tray, close-to-tray, wake rescan
**Goal:** Quot3 keeps running hidden so the watcher keeps working.
**Depends on:** 160 (for the wake rescan hook); otherwise independent.
**In scope:** design 3.7: settings "Start Quot3 when I sign in to Windows" (`app.setLoginItemSettings`, `--hidden` start) and "Keep running in the background when the window is closed"; tray icon with Open / Pause watching / Quit; `window-all-closed` and the per-window close guard respect the toggle (explicit Quit really quits, update install still quits); single-instance lock keeps showing the window; `powerMonitor` 'resume' / 'unlock-screen' -> `legacyWatch.scan()`; OFF defaults; a pure `backgroundPolicy` function (should the app quit / hide / start hidden) kept testable.
**Out of scope:** Settings UI (162), macOS/Linux behaviour.
**Key files:** `src/main/index.ts`, new `src/main/services/backgroundService.ts`, `src/shared/background.ts`, `shared/settings.ts`.
**How to verify:** unit tests of `backgroundPolicy` and settings defaults; typecheck. Real login start, tray and wake = owner's PC (standing gap).

## Phase 162 — Settings: "Background and legacy watch" section
**Goal:** One Settings section to control it all.
**Depends on:** 160, 161.
**In scope:** folder picker, Watch on/off, rescan interval, Scan now, Pause, the two background toggles, a live status line (last scan, imported/updated/skipped/needs-review counts, "sync is off" when so), plain-language errors; Phase 92 selector rule for any new store; tokens only.
**Out of scope:** the review and activity lists (163).
**Key files:** new `pages/settings/LegacyWatchSection.tsx` (+ store), `pages/Settings.tsx`, styles.
**How to verify:** component test with a mocked `window.quot3` (toggles save, status renders, errors shown), settings page tests that could conflict (note the known pre-existing failures in `PHASE_STATUS.md`), typecheck.

## Phase 163 — Needs review list and Activity log with Undo
**Goal:** The owner can resolve uncertain matches and undo any automatic action.
**Depends on:** 159, 162.
**In scope:** design 3.8: Needs review list (file, party, date, total, candidate bill(s), reason) with "Import as new bill", "Replace existing bill with this", "Ignore"; Activity list (last 200: imported, updated, skipped duplicate, needs review) with Undo; a small badge in Settings/sidebar when items wait; IPC for list/resolve/undo; every action reversible, nothing deleted.
**Out of scope:** new matching rules (158).
**Key files:** new `ReviewList.tsx` / `ActivityList.tsx`, `ipc/legacyWatch.ts`, `legacyWatchApply.ts`.
**How to verify:** service tests for each resolve action and undo, component tests with mocked bridge, typecheck.

## Phase 164 — Milestone 15 QA gate and release 0.1.12
**Goal:** Check Phases 158-163 together, then ship version 0.1.12.
**Depends on:** 158-163.
**In scope:** typecheck plus the touched suites only (no full suite unless the owner agrees); optional counts-only run of the classifier against the owner's attached sample (never print contents); reconcile `PHASE_STATUS.md`; update `GITHUB_UPDATE_PUSH.md`, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`, `docs/LEGACY_IMPORT_SPEC.md` (new fingerprint, edit rules, review list); bump the version to 0.1.12 (package.json + both spots in package-lock.json) and hand back the changed-files zip, the full zip and the push steps per `GITHUB_UPDATE_PUSH.md` section 2.
**Out of scope:** new features.
**How to verify:** suites green or each failure listed with its cause; owner checklist for what only a real PC shows (start at sign-in, tray, close-to-tray, wake rescan, watching the real folder, bills reaching the other PCs through real sync).
