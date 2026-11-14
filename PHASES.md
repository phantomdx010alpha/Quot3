# PHASES — Quot3 (Milestone 17 = Phases 173–188, the phone PWA, appended at the bottom; Milestone 15 = Phases 158–164; 144 phases; Phases 70–91 = Milestone 8, 92–106 = Milestone 9, 107–115 = Milestone 10, 116–127 = Milestone 11, 128–143 = Milestone 12, 144 = Milestone 13, all executed BEFORE Phase 69)

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


---

# Milestone 16 — Themes 2.0: richer themes, animations, 3D backgrounds, theme sharing (Phases 165–172)

Read `docs/MILESTONE16_DESIGN.md` before any Phase 165–172 (owner's rules and [A] assumptions). **Testing rule for every phase below: never run the full test suite; run `npm run typecheck` plus only the test files you wrote/changed and the ones that could conflict (`CLAUDE_MUST_READ.md` 10k). No build, no dev server. Name the files in the phase log and list what was not run.** Order: 165, 166, 167, 168, 169, then 170, 171 (any time after 165), 172. Only Phase 172 bumps the version (0.1.14) and hands back the zips per `GITHUB_UPDATE_PUSH.md` section 2. Phase 69 (RELEASE GATE) still runs after the last feature phase.

## Phase 165 — Themes 2.0: schema v2 and validation (pure)
**Goal:** A richer theme file format that is still pure data and still safe, with old files working unchanged.
**Depends on:** the existing `shared/theme/*` (Phase 49 area).
**In scope:** design 3.1-3.3: `schema: 2` envelope with optional `gradients`, `fonts`, `shape`, `effects`, `background` sections next to `tokens`; validation reusing the existing hostile-value rules (no `url()`, no code, clamps, caps, unknown keys warned); a v1 file validates exactly as before; new tokens added with defaults; the theme list/error messages in plain words; update `docs/design/DESIGN_TOKENS.md` (schema v2) and `API_CONTRACTS.md` first. **Also (owner request): rewrite section 8 of `docs/THEME_CREATION_GUIDE.md` to the final v2 schema (replace the DRAFT), extend `tools/check-theme.mjs` to check the v2 sections, and add a v2 example under `docs/themes/` that passes it, so a Claude session given this folder can generate v2 themes.**
**Out of scope:** applying anything in the UI, animations, Three.js, sharing.
**Key files:** `src/shared/theme/{validateTheme,tokens,starter}.ts` + new `schemaV2.ts`, tests in `src/shared/theme/__tests__/`; `docs/THEME_CREATION_GUIDE.md`, `tools/check-theme.mjs`, `docs/themes/`.
**How to verify:** unit tests: every v1 fixture still passes unchanged; v2 valid file; hostile gradient / font / effect values rejected; clamps; unknown scene / preset name warns; size caps; parity test still green; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 166 — Themes 2.0: apply the new sections (gradients, fonts, shape)
**Goal:** The renderer applies the v2 sections that need no animation.
**Depends on:** 165.
**In scope:** `ThemeProvider` maps validated gradients / fonts / shape to CSS custom properties; `tokens.css` defaults for every new token (built-ins unchanged in look); the grid and print stay unthemed by gradients/blur (design 3.4); a theme error never breaks the look (fallback to the base theme); Settings > Themes shows the new warnings and a larger live preview; the starter/export theme includes the new sections.
**Out of scope:** animations, Three.js, sharing.
**Key files:** `src/renderer/theme/ThemeProvider.tsx`, `src/renderer/styles/tokens.css`, `src/renderer/components/settings/ThemesSection.tsx`, `src/shared/theme/preview.ts`.
**How to verify:** parity test (every theme defines every token), ThemeProvider and themes-section tests, a test that the grid selectors never receive blur/gradient tokens; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 167 — Themes 2.0: animation presets
**Goal:** Named, safe animations a theme can switch on.
**Depends on:** 165, 166.
**In scope:** design 3.4: a pure preset registry (id, allowed parameters, clamps) in `shared/theme/effects.ts`; CSS/renderer implementation (page transitions, hover/press motion, accent glow, ambient motion) using transform/opacity on chrome only; honours reduce-motion; a master switch setting `effects.enabled` (default ON, Off = today's look exactly); never on the grid or print; paused when the window is hidden.
**Out of scope:** Three.js, the Settings controls page (168), sharing. Add the final list of animation presets and their parameters to `docs/THEME_CREATION_GUIDE.md` section 8.
**Key files:** new `src/shared/theme/effects.ts`, `src/renderer/theme/effects.ts` (+ css in `styles/`), `ThemeProvider.tsx`, `src/shared/settings.ts`.
**How to verify:** registry tests (unknown preset, clamps, reduce-motion off switch), a test that no effect rule targets the grid or print, typecheck. Real look = owner's PC. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 168 — Themes 2.0: Settings controls for effects
**Goal:** The owner controls effects from Settings.
**Depends on:** 167.
**In scope:** Settings > Themes: "Visual effects" master switch, per-effect on/off and intensity overrides (saved as settings, applied over the theme's own values), "Pause effects when the window is not focused" [A: ON], a reset button, plain-words hints; command-palette entry and shortcut for toggling effects (registered in `shared/shortcuts.ts`).
**Out of scope:** Three.js scenes, sharing.
**Key files:** `ThemesSection.tsx` (or a new `EffectsSection.tsx`), `settingsStore.ts`, `shared/settings.ts`, `shared/shortcuts.ts`.
**How to verify:** component test (switch, intensity saved, reset), shortcut registry tests that you touched, Phase 92 selector rule test for any new store; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 169 — Themes 2.0: Three.js background scenes
**Goal:** Built-in 3D / shader backgrounds a theme can choose by name.
**Depends on:** 165, 166, 167.
**In scope:** design 3.5-3.6: add one pinned `three` dependency (read `DEPENDENCY_VERSIONS.md`, install once, record it there); a scene registry (e.g. particles, waves, gradient mesh) with validated parameters (colours, speed, density, intensity); a canvas layer behind the chrome (`pointer-events: none`, never behind the grid), lazy-loaded only when the active theme names a scene; frame cap, pause when hidden / minimised / tray, dispose on theme change, fallback to no background when WebGL fails or a frame budget is blown; confirm the CSP (record any change and why); a Settings switch "3D backgrounds" [A: default ON when a theme asks for one].
**Out of scope:** images in themes, user-supplied shaders or scripts (never), sharing. Add the final list of scenes and their parameters to `docs/THEME_CREATION_GUIDE.md` section 8 and an example theme that uses one.
**Key files:** new `src/renderer/theme/scenes/*`, `ThemeProvider.tsx`, `src/shared/theme/schemaV2.ts` (scene names + parameter specs), `package.json` / `package-lock.json` (dependency only; do NOT bump the version), `DEPENDENCY_VERSIONS.md`.
**How to verify:** pure tests for scene parameter validation and the pause / fallback decision logic; a test that an unknown scene is ignored with a warning; a Node-level check that the scene modules import cleanly; typecheck. WebGL rendering and frame rate = owner's PC (standing gap). **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 170 — Theme sharing: server SQL and contract
**Goal:** The server side that lets branches share theme files.
**Depends on:** 165; the Milestone 12 shared-notebook setup (`docs/SYNC_SHARED_STORE_SPEC.md`, `docs/SUPABASE_MIGRATIONS.md`).
**In scope:** design 3.8: ONE new numbered SQL file (never edit a file already run) adding a themes table (organisation, theme id, JSON, `edited_at`, author seat, `min_reader_ver`, history rows), RLS select-own-organisation only, RPC-only writes (upsert with size cap, list since a cursor), no `service_role`; contract written first in `API_CONTRACTS.md` and `docs/SUPABASE_MIGRATIONS.md` (owner's run-order and checklist line); static SQL tests following the Milestone 12 pattern.
**Out of scope:** client code, anything run against a real Supabase.
**Key files:** new SQL file under the existing SQL folder, `docs/SUPABASE_MIGRATIONS.md`, `API_CONTRACTS.md`, static tests next to the existing SQL tests.
**How to verify:** static SQL tests (RLS present, no direct insert/update grants, size cap, function signature), typecheck. "Works on Supabase" is a standing gap until the owner runs the checklist; never write "verified". **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 171 — Theme sharing: client sync and Settings
**Goal:** Themes added on one PC appear on the other branches.
**Depends on:** 165, 170.
**In scope:** push a new / edited local theme file and pull others through the existing sync worker pattern (no second channel); a received theme is validated like a local file and written to the themes folder only when valid (bad ones set aside and listed); newest `edited_at` wins, older version kept in history, nothing silently deleted; "Share my themes with the other PCs" switch (OFF by default [A]); Settings > Themes lists shared themes with their origin and a local-only Remove; `min_reader_ver` rule ("Update the app to use N themes"); logs carry counts only, no theme contents.
**Out of scope:** Three.js changes, a real Supabase run.
**Key files:** new `src/main/sync/themeShare*.ts` (the only Supabase code), `themeService.ts`, `ThemesSection.tsx`, IPC + preload + `Quot3Bridge`, settings keys.
**How to verify:** service tests with a fake server (new theme arrives, same id newer wins, bad theme set aside, switch off = nothing sent, older reader), IPC strict-schema tests, component test; typecheck. Real sync = owner's PC. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**

## Phase 172 — Milestone 16 QA gate and release 0.1.14
**Goal:** Check Phases 165-171 together, then ship version 0.1.14.
**Depends on:** 165-171 (or the subset the owner chose to ship; say so).
**In scope:** typecheck plus the touched suites only (no full suite unless the owner agrees); reconcile `PHASE_STATUS.md`; confirm `docs/THEME_CREATION_GUIDE.md`, `tools/check-theme.mjs` and the examples in `docs/themes/` agree with the code (run the checker on a v1 and a v2 example only); update `GITHUB_UPDATE_PUSH.md` (history entry; if the milestone added a migration or SQL file, the `schema: N` note), `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`, `docs/design/DESIGN_TOKENS.md`; bump the version to 0.1.14 (`package.json` + both spots in `package-lock.json`) and hand back the changed-files zip, the full zip and the push steps per `GITHUB_UPDATE_PUSH.md` section 2.
**Out of scope:** new features.
**How to verify:** suites green or each failure listed with its cause; owner checklist for what only a real PC shows (look and frame rate of effects and 3D on an office PC, hidden / tray pause, WebGL fallback, a theme shared from one PC arriving on another through real Supabase). **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No build, no dev server.**


---

## MILESTONE 17 — Phone version: Android PWA on Vercel (Phases 173–188)
*Exit criteria: an installable Android PWA hosted on Vercel that creates, edits and views GST / non-GST bills in a compact screen, keeps data in IndexedDB with persistent storage, syncs through the shared notebook as its own seat and branch, and outputs only by share image / share PDF. Desktop behaviour unchanged. Phase 69 (release gate) still runs after the last feature phase (188).*

**Planned 2026-10-21 from the owner's request. Docs only; nothing built or run. Binding design: `docs/MILESTONE17_DESIGN.md` (read it first; it also lists the [A] assumptions and the [CHECK] items). Hard rules: `CLAUDE_MUST_READ.md` section 10l.**

**Stage 0 (prerequisite, existing work, not Milestone 17):** finish phase "140b" (wire the v2 sync engine into the app), the owner's real-Supabase checklist (`docs/SUPABASE_MIGRATIONS.md`), and the real Phase 142. Re-read `PHASE_STATUS.md` to see whether they are done. Phases 173-177 and 180-187 do not need real sync; real phone sync testing does.

**Version numbers below are placeholders** (renumber if 140b / 142 take patch numbers first). Each code phase bumps `package.json` and both spots at the top of `package-lock.json`. Tag a desktop release only if the desktop actually changed.

## Phase 173 — Contract and spikes (reproduce-first, on the owner's real phone)
**Goal:** Find out what really works on the owner's Android phone, using small throw-away dev pages only, and record the numbers and decisions.
**Depends on:** Phase 172. Read `docs/MILESTONE17_DESIGN.md` first. Phone code lives in `src/pwa/*` and `src/shared/*` only; desktop behaviour does not change.
**In scope:** Small spike pages (not shipped) for each [CHECK] in `docs/MILESTONE17_DESIGN.md` section 6: persistent storage granted when installed vs browser tab; Web Share with a file to WhatsApp (image and PDF); single-writer lock; image from the print model (canvas vs SVG) against the desktop look incl. the rupee sign; PDF method (page image vs real text PDF with embedded font); Android keyboard behaviour (Next/Done, number keypad, text selection for B and R+B); Vercel CSP for a user-typed Supabase URL + websocket; `supabase-js` bundle size; whether company settings sync today (read the code). Write a short "spike results and decisions" section into `MILESTONE17_DESIGN.md` and resolve Q4, Q6 (if numbers are available) and the share methods. Contracts first: freeze the phone data-layer, platform-flags and share-output sections in `API_CONTRACTS.md` if the spikes change them.
**Out of scope:** Shipping any phone feature, any change to the desktop, a real Supabase run.
**Key files:** new throw-away files under `docs/design/m17_spikes/` (or a scratch folder outside `src`), `docs/MILESTONE17_DESIGN.md`, `API_CONTRACTS.md`.
**Version:** none
**How to verify:** The owner opens each spike page on the phone and reports results; the phase log records exactly what the owner saw. Anything the owner has not run stays "unconfirmed" in Standing gaps. Sandbox checks (bundle size, canvas output in headless Chromium) are labelled as sandbox only. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 174 — PWA shell and Vercel
**Goal:** An installable, offline-opening empty phone shell that Vercel can build and host, with the desktop build untouched.
**Depends on:** 173.
**In scope:** `vite.pwa.config.ts`, `src/pwa/main.tsx` + `App.tsx` + tiny in-memory router, `platform/` flags (`isPhone`), web manifest and icons (reuse the app icon; folder name decided so it does not collide with desktop `resources/`), service worker (never long-cached), `vercel.json` (SPA fallback, headers, CSP per spike results), scripts `dev:pwa` and `build:pwa`, a phone `tsconfig`. Vercel production-branch rule per Q8 (default: separate `pwa` branch until 0.2.0).
**Out of scope:** Any bill, data or sync code; any change to desktop scripts, `electron-builder.yml`, `release.yml` or `updaterPort.ts`.
**Key files:** new `vite.pwa.config.ts`, `vercel.json`, `src/pwa/*`, `tsconfig` for the phone, manifest + icons, `package.json` scripts only.
**Version:** 0.1.15
**How to verify:** typecheck (desktop and phone configs); one test proving the desktop config files are unchanged / the desktop entry does not import `src/pwa`; the shell builds with `build:pwa` if the sandbox allows it, otherwise say not run. Installability, offline start and the Vercel preview are the owner's to confirm (Standing gaps). **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 175 — Phone data layer 1 (IndexedDB, settings, persistence, backup file)
**Goal:** Open and upgrade the IndexedDB database, create all stores, and provide settings / meta repos, the persistent-storage request and a backup export / import.
**Depends on:** 174.
**In scope:** DB `quot3-phone` with the stores in `docs/DATA_MODEL.md` (Milestone 17 section); open / upgrade by IndexedDB version; `meta` and `settings` repos; `navigator.storage.persist()` request and a storage-health read (persisted yes/no, usage); single-writer lock per the spike; manual Export backup / Import backup file and a "last export is old" flag; optional helper library only if needed (look the version up first, `DEPENDENCY_VERSIONS.md`).
**Out of scope:** Bills, parties, sync, any UI beyond what a test needs.
**Key files:** new `src/pwa/data/{db,metaRepo,settingsRepo,backup}.ts`, `src/pwa/platform/storage.ts`, tests with an in-memory IndexedDB fake.
**Version:** 0.1.16
**How to verify:** tests for open / upgrade, settings round trip, backup export then import into a fresh DB, a second tab blocked from writing; typecheck. Real persistence on Android is a Standing gap. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 176 — Phone data layer 2 (bills)
**Goal:** Save, get, list, delete and restore bills on the phone with the same rules as the desktop.
**Depends on:** 175.
**In scope:** Bills and bill_rows repos; PO number from the phone's branch prefix and counter taken in the SAME transaction as the save; `po_number` immutable; revision +1 and a small revision cap (default 5, [A]); party snapshot on the bill; soft delete and restore; totals cache and item row count rewritten on every save through `src/shared/calc`; drafts autosave and crash recovery; money as decimal strings. Port the desktop rules, not the SQL (read the desktop repo and its tests for the rules).
**Out of scope:** UI, sync, parties list features, stock transfer / hybrid editing.
**Key files:** new `src/pwa/data/{billsRepo,draftsRepo}.ts` + tests; reads `src/shared/*` only.
**Version:** 0.1.17
**How to verify:** tests: PO numbers never repeat, two quick saves, revision cap, soft delete / restore, totals equal the shared calc on the shared fixtures, draft survives a simulated reload, round-off flag and bill-options read; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 177 — Phone parties
**Goal:** Customers data and fuzzy autocomplete on the phone.
**Depends on:** 176.
**In scope:** Parties store with `name_norm`, phone, address, transport, `merged_into`; deterministic id from the normalised name (shared rule from Milestone 12 section 9); fuzzy autocomplete with Fuse.js (already a dependency); auto-create from a new party name on save; customers list data (bill counts, last bill date); in-memory light list for speed (measure with counts only).
**Out of scope:** Duplicate / merge tools (desktop only), Excel import, UI.
**Key files:** new `src/pwa/data/partiesRepo.ts`, `src/pwa/data/partySearch.ts` + tests.
**Version:** 0.1.18
**How to verify:** tests: same normalised name gives the same id, autocomplete ranking on fixtures, auto-create on save, counts match bills; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 178 — Phone sync 1: login and branch
**Goal:** Sign the phone in as its own seat and choose its branch name and PO prefix.
**Depends on:** 175, Stage 0.
**In scope:** Seat email + password sign-in through `SupabaseSharedTransport` (the only code that imports `@supabase/supabase-js`); session kept in IndexedDB with browser crypto (non-extractable key); optional app-lock groundwork (PIN / biometric, off by default, [A]); branch name and PO prefix selection (unique per organisation, [A] one seat per phone); clock offset; clear error text for a paused or unreachable server.
**Out of scope:** Push / pull, UI polish, any real Supabase run.
**Key files:** new `src/pwa/sync/{session,branch,clock}.ts` + tests with the fake / in-memory transport.
**Version:** 0.1.19
**How to verify:** fake-transport tests only: sign in, sign out clears the session, duplicate prefix refused, paused-server message. Real Supabase and the strength of the browser key store are Standing gaps (do not claim it equals desktop secret storage). **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 179 — Phone sync 2: push and pull
**Goal:** The phone exchanges bills, parties and tombstones with the shared notebook and converges with other branches.
**Depends on:** 176, 177, 178.
**In scope:** Outbox, record state, aside storage and cursor re-implemented on IndexedDB; push / pull workers using `src/shared/sync/*` (codec, diff, pull) unchanged; first-sync progress screen data, size check and the Q6 decision (everything or recent + all customers; never break `base_version` / aside rules); pull on start, when visible, on network regain, after Save and every 60 s while open; doorbell when the page is open; no background sync promise; `min_reader_ver` aside rule.
**Out of scope:** Real Supabase, any change to the spec or to desktop sync.
**Key files:** new `src/pwa/sync/{outbox,recordState,aside,push,pull,doorbell}.ts` + tests; reads `src/shared/sync/*`.
**Version:** 0.1.20
**How to verify:** N-branch convergence test (desktop-side fake + phone adapter) against the in-memory transport, incl. conflict (latest wins, loser kept), delete / restore, aside, lossy network; typecheck. Real Supabase is a Standing gap. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 180 — Mobile shell and Dashboard
**Goal:** The phone app frame and a compact Dashboard.
**Depends on:** 174, 175.
**In scope:** Bottom navigation, safe areas, compact tokens (default navy/red + one light theme), Dashboard (today and month totals, recent bills, sync status, last export), Back-button rule (Dashboard is the root, like desktop Esc), update / install placeholders.
**Out of scope:** Live tiles, themes editor, effects, Three.js.
**Key files:** new `src/pwa/ui/{BottomNav,Dashboard,tokens}.tsx|css`, router tests.
**Version:** 0.1.21
**How to verify:** jsdom component tests (navigation, Back from each page goes to Dashboard, totals from fixtures); typecheck. The real look on an Android screen is the owner's to confirm. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 181 — History and view bill
**Goal:** Find and read bills on the phone.
**Depends on:** 176, 177, 180.
**In scope:** Date-grouped list, search (party, PO number, item text, amount) and filters, a read-only compact bill view, edit entry point, delete to trash, Recently deleted and restore; stock transfer and hybrid bills open read-only with "Edit on PC" ([A]).
**Out of scope:** The editor itself, revision compare screen.
**Key files:** new `src/pwa/ui/{History,BillView,Trash}.tsx` + tests.
**Version:** 0.1.22
**How to verify:** jsdom tests with seeded bills: grouping, search, trash / restore, read-only view of each format; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 182 — Compact bill editor 1
**Goal:** Create and edit a plain bill on one compact screen.
**Depends on:** 176, 177, 180.
**In scope:** Party bar (name autocomplete, phone, transport, address pull-down), compact item rows `# | name | qty | rate | total`, tap-to-expand row editor, number keypad inputs, Next / Done moves name -> qty -> rate -> next row, GST / non-GST toggle (rows are a superset, no data lost), adjustments (name + amount, negative allowed), sticky totals strip, Save with name check, unsaved-changes guard on Back, draft recovery, Create always opens clean (A31). Totals only via `src/shared/calc`.
**Out of scope:** Total override, extra columns, rich text, units (Phase 183); print / clipboard / TSV (never on the phone).
**Key files:** new `src/pwa/ui/editor/*` + tests.
**Version:** 0.1.23
**How to verify:** jsdom tests: totals equal desktop on shared fixtures, GST toggle keeps data, save creates the party, guard prompts, Create is clean after a draft exists; typecheck. Real Android keyboard behaviour is a Standing gap until the owner tries it. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 183 — Compact bill editor 2
**Goal:** The remaining bill features on the phone.
**Depends on:** 182.
**In scope:** Total override; round-off flag (per-bill flag via the shared bill-options read); extra columns with header rename and a Columns sheet; units summary and Mark (rules: `EXTRA_COLS_UNITS_RULES.md`); rich text per Q4 (B and R+B on selection, or plain text with preserved runs); unknown fields (footer extras, tail rows, cell styles) preserved untouched on save; stock transfer / hybrid stay read-only.
**Out of scope:** Hybrid and stock-transfer editing, revision compare.
**Key files:** edit `src/pwa/ui/editor/*`; new tests; reads `src/shared/{units,runs}`.
**Version:** 0.1.24
**How to verify:** tests: override and round-off match desktop on shared fixtures, units summary and Mark results equal the shared engine, editing a name keeps or updates runs as decided, a bill with unknown fields round-trips unchanged; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 184 — Share image and PDF
**Goal:** The only output on the phone: share a bill as an image or a PDF.
**Depends on:** 183, 173 (method decisions).
**In scope:** Builders from the pure print model (`src/shared/print/*`, `paper/paperRules.ts`, `imageTrim.ts`): image and PDF, Rough / Professional (Professional adds the company block and PO number), paper size from the existing paper rules only, bundled font with the rupee sign, Web Share with a file and a download fallback, remembers the last choice (Q9, [A]); sharing never changes the bill.
**Out of scope:** Print dialog, clipboard image, TSV copy, any new paper threshold.
**Key files:** new `src/pwa/share/{image,pdf,shareSheet}.ts` + tests.
**Version:** 0.1.25
**How to verify:** tests: same numbers and rows as the desktop print model on shared fixtures, paper decision equals the shared rule, fallback path when sharing is unavailable; sandbox-rendered sample images / PDFs may be looked at but are labelled sandbox only. Sharing to WhatsApp on the owner's phone is a Standing gap until confirmed. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 185 — Customers and Settings (phone subset)
**Goal:** Customers pages and the phone Settings.
**Depends on:** 177, 178, 181.
**In scope:** Customers list / detail / add / edit with call and WhatsApp links ([A]); Settings: company profile for professional output (synced or phone-own per the Phase 173 finding), branch name + PO prefix, share defaults, sync login, storage and backup page (persisted yes/no, usage, Export / Import, "Reset phone data" with a double confirm), app lock, About + version.
**Out of scope:** Themes manager, shortcuts, audit viewer, updater controls, diagnostics.
**Key files:** new `src/pwa/ui/{Customers,Settings}*.tsx` + tests.
**Version:** 0.1.26
**How to verify:** jsdom tests: customer edit, bill counts, reset needs two confirms, settings round trip; typecheck. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 186 — Offline, install and update flow
**Goal:** The app behaves well offline, can be installed, and updates safely.
**Depends on:** 174, 179, 185.
**In scope:** Offline start and use, install prompt, "New version, reload" prompt that waits until no bill is unsaved, service-worker cache named from the version, version / schema gate (`min_reader_ver` -> "Update the app to see N bills"), safe behaviour when storage is full or cleared.
**Out of scope:** Background sync, push notifications.
**Key files:** edit `src/pwa/platform/*`, service worker, tests.
**Version:** 0.1.27
**How to verify:** tests for the update-wait rule and the version gate; typecheck. Offline, install and update on a real phone are the owner's to confirm. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 187 — Hardening
**Goal:** Make the phone app fast and safe on a mid-range Android and on the real corpus size.
**Depends on:** 181-186.
**In scope:** Large-corpus test using counts only (about 1.9k bills and 12.9k customers per the docs; never real contents); speed pass (list, search, autocomplete, first sync); touch targets and accessibility pass; mobile-emulation e2e with Playwright if available; the owner's device checklist written out.
**Out of scope:** New features.
**Key files:** tests and perf notes under `src/pwa/__tests__/`, `docs/MILESTONE17_DESIGN.md`.
**Version:** 0.1.28
**How to verify:** synthetic large-data tests and timings recorded as sandbox numbers only; the owner's device checklist is handed over unfilled. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

## Phase 188 — Milestone 17 QA gate and docs sweep
**Goal:** Check Phases 173-187 together and decide the first public phone release.
**Depends on:** 173-187 (or the subset the owner chose to ship; say so).
**In scope:** typecheck, then ONLY the Milestone 17 test files, the phone build (`build:pwa`) and the desktop typecheck / the few desktop files touched by shared changes; the full suite only if the owner agrees; fill in the owner's real-device checklist from what the owner reports; reconcile `PHASE_STATUS.md`; update `GITHUB_UPDATE_PUSH.md`, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`, `DEPENDENCY_VERSIONS.md`; bump to 0.2.0 and hand back the changed-files zip, the full zip and the push steps (`GITHUB_UPDATE_PUSH.md` section 2). Tag a desktop release only if the desktop changed.
**Out of scope:** New features.
**Key files:** docs, `package.json` + both spots in `package-lock.json`.
**Version:** 0.2.0
**How to verify:** suites green or each failure listed with its cause. Owner checklist (only a real phone shows these): install from Chrome, offline open, persistent storage granted, bill create / edit / view, share image and PDF to WhatsApp, sync with the desktop through real Supabase, update prompt, app lock, speed with the full data. **NO FULL TEST SUITE in this phase: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and only the few existing ones that could conflict), and list them and what was NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified" from the sandbox; it goes in Standing gaps. Say that [A] items are unconfirmed.**

---

## MILESTONE 18 — Phone UI layouts (Phases 189–196)
*Exit criteria: three new phone layouts (A Tidy tabs, B Guided flow, C Bills inbox) that the owner switches in phone Settings (`ui.layout`), all views over the same data, sync, share and calc code; the classic UI is the default and behaves exactly as before; names and amounts are never truncated in the new layouts; money is shown in Indian format; nothing about bills, formats, paper rules or sync changes. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still pending.*

**Planned 2026-10-22 from the owner's request. Docs only; nothing built or run. Binding design: `docs/MILESTONE18_DESIGN.md` (read it first; it holds the checked claims, the [A] list and the [CHECK] list). Reference art: `docs/design/m18_phone_ui_options.html` (not code). Hard rules: `CLAUDE_MUST_READ.md` section 10m.**

**Standing rules for every Phase 189-196:** classic is untouched and locked by `src/pwa/__tests__/classicParity.test.ts` (DOM snapshot + SHA-256 of `ui/ui.css`, `ui/tokens.css`, `ui/themes.css`, `styles/pwa.css`); new code only in new files (`src/pwa/ui/layouts/*`, `src/pwa/ui/kit/*`); no edit to `src/shared/*`, `router.ts` exports or `editorModel.ts` behaviour; no format-name branching; tokens only; Phosphor only, no emoji; the Phase 92 selector rule; owner rules kept (Create always clean A31, unsaved guard, name required, drafts and recovery, share only, "Edit on PC", version gate, read-only). **NO FULL TEST SUITE in these phases except the Phase 196 gate and only if the owner agrees: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run only `npm run typecheck` once plus the named test files (and `src/__tests__/importBoundaries.test.ts`), and list what you ran and what you did NOT run in the phase log. No desktop build, no dev server. Real Android behaviour is never written as "verified"; it goes in Standing gaps. Say that [A] items are unconfirmed.** Version numbers are placeholders (renumber if Phase 188 ships 0.2.0 first); each code phase bumps `package.json` and both spots at the top of `package-lock.json` (`GITHUB_UPDATE_PUSH.md` section 2) and hands back the changed-files zip, the full zip and the push steps with the real version.

## Phase 189 — Layout contract, `ui.layout` setting, layout switch, chooser, classic locks
**Goal:** Put the switch in place with ONLY `classic` built, and lock classic so every later phase can prove it did not change.
**Depends on:** Phase 187d (0.1.31). Read `docs/MILESTONE18_DESIGN.md` sections 1, 4, 9 first.
**In scope:** (1) FIRST write `classicParity.test.ts` (DOM snapshots of every classic screen and banner state on the fake IndexedDB fixture; SHA-256 pins of the four classic CSS files) and run it green before touching anything else. (2) Contract first in `API_CONTRACTS.md`: setting `ui.layout`, `LayoutDefinition`, the editor props / `EditorApi` contract, `interceptBack`, `onSaved` behaviour. (3) `layouts/layoutRegistry.ts` (`LAYOUT_IDS`, `LayoutId`, `DEFAULT_LAYOUT`, `isLayoutId`, labels, blurbs, `LAYOUTS` of built layouts = classic only), `layouts/types.ts`. (4) `ui.layout` in `settingsRepo.ts` (`SettingDefaults`, default `'classic'`), read in `bootstrap.ts` and passed via `services.ts` like `theme.name`; unknown value -> classic. (5) `App.tsx`: layout state, `document.documentElement.dataset.layout`, the registry lookup and the unsaved-guard hold for a change; the classic branch stays exactly today's JSX. (6) A "Layout" section on Settings > Themes (page id `appearance`, label unchanged) listing only built layouts (so only Classic for now), remembered, with the plain sentence that Classic is today's screen; update ONLY that one snapshot, say so in the log. (7) Docs: `PROJECT_STRUCTURE.md` entry.
**Out of scope:** any new layout, kit component, token, label rename or CSS change.
**Key files:** new `src/pwa/ui/layouts/{layoutRegistry,types}.ts`, `src/pwa/__tests__/{classicParity,layoutRegistry,layoutSwitch}.test.ts`; edited in place `src/pwa/data/settingsRepo.ts`, `ui/bootstrap.ts`, `ui/services.ts`, `ui/ThemePicker.tsx` (or a new `LayoutPicker.tsx` mounted from `Settings.tsx`), `App.tsx`, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.32
**How to verify:** `npm run typecheck` once; run `classicParity.test.ts`, `layoutRegistry.test.ts`, `layoutSwitch.test.ts`, `src/pwa/__tests__/{shell,ui,themes,customersSettings}.test.ts`, `src/__tests__/importBoundaries.test.ts`. `layoutSwitch.test.ts` proves a layout change writes nothing to bills, parties, drafts or the outbox and is held while a bill is unsaved. Say that the real phone look is not checked and [A] items are unconfirmed.

## Phase 190 — Shared kit 1: larger tokens, display helpers, item line, totals block, buttons
**Goal:** Build the reusable pieces every new layout needs for reading a bill, with the wrap rule and Indian money built in.
**Depends on:** 189.
**In scope:** `kit/display.ts` (`moneyText`, Indian grouping through shared `fmtMoney`, never raw "12988.00", never number maths), `kit/plainWords.ts` (the map of section 7, by column key; "Before GST" only when the format also has a `gstAmt` column), `ItemLine` (two lines, name wraps, amount right bold tabular, "382 x Rs34 · +18% GST"), `TotalsBlock` (Before GST / GST / Total, grand total largest, rupee sign on the final total), `Button` (primary / secondary / text), `SegmentedControl`; `kit/kit.css` and `layouts/layouts.css` with the larger tokens scoped to `:root[data-layout='tidy'|'guided'|'inbox']` (text 16 / 17 px, amounts 17-18 px semibold, touch 48 px, nav 60 px); contract in `API_CONTRACTS.md` first; `docs/design/DESIGN_TOKENS.md` note finalised.
**Out of scope:** sheet, snackbar, status pill, any layout screen, any edit to the four classic CSS files or to `src/shared/*` (do NOT change `billTotals.ts`: display formatting happens in the kit only).
**Key files:** new `src/pwa/ui/kit/{display,plainWords,ItemLine,TotalsBlock,Button,SegmentedControl}.ts*`, `kit/kit.css`, `layouts/layouts.css`, `src/pwa/__tests__/{kitDisplay,kitWrap,plainWords}.test.ts`.
**Version:** 0.1.33
**How to verify:** `npm run typecheck` once; run `kitDisplay.test.ts`, `kitWrap.test.ts` (CSS scan: no ellipsis / nowrap on name classes, amounts never clipped, touch classes at least 48 px, every button named), `plainWords.test.ts`, `classicParity.test.ts`, `src/pwa/__tests__/{themes,hardening}.test.ts`, `src/__tests__/importBoundaries.test.ts`. Not run: real phone look.

## Phase 191 — Shared kit 2: bottom sheet, snackbar with Undo, status pill, share bar, Saved sheet, date field, party pre-build
**Goal:** Build the cross-layout behaviours once, so each layout only places them.
**Depends on:** 190.
**In scope:** `BottomSheet` (focus trap, Back and Esc close the sheet first); `SnackbarHost` + `useSnackbar` (one message, no identical stacking, 6 s, Undo) and the row-remove Undo model (pure, tested); `statusModel.ts` + `StatusPill` (one pill by priority, a sheet lists every active notice with its action; read-only also a persistent thin line; fed by the SAME flags `App.tsx` already holds); `ShareBar` and the "Saved" sheet (Share, Done) over the existing share code, never changing the bill; `DateField` over the existing `setBillDate` (new layouts only, [A]); party index pre-build at start for the new layouts (idle callback after the directory loads, [A]; classic unchanged). Contracts first.
**Out of scope:** layout screens, the GST % chips (Phase 195, [A]), any classic change, any share or sync change.
**Key files:** new `src/pwa/ui/kit/{BottomSheet,Snackbar,StatusPill,statusModel,ShareBar,SavedSheet,DateField}.ts*`, `src/pwa/__tests__/{statusModel,snackbar,kitSheets}.test.ts`; additive only in `ui/bootstrap.ts` for the pre-build.
**Version:** 0.1.34
**How to verify:** `npm run typecheck` once; run `statusModel.test.ts`, `snackbar.test.ts`, `kitSheets.test.ts`, `kitWrap.test.ts`, `classicParity.test.ts`, `src/pwa/__tests__/{editor,editor2,shareUi,offlineUpdate}.test.ts`, `src/__tests__/importBoundaries.test.ts`. Not run: the real keyboard, focus and sheet behaviour on a phone.

## Phase 192 — Layout A: Tidy tabs
**Goal:** The first new layout, using the kit.
**Depends on:** 191. Mockup row A.
**In scope:** register `tidy` in `LAYOUTS` (the chooser then offers it); Shell with the five-tab nav (raised round New button in the centre), hidden in the editor; Home (today / month tiles, recent bills as two-line rows); Bills list (two-line rows, party names wrap); bill view (header = party name, PO / date / format under it; two-line item rows; totals block; sticky bottom bar [Share (primary)] [Edit]; "rev" in the overflow menu; "Edit on PC" for hybrid / stock transfer); editor (party, visible GST / Non-GST segmented control, name box that grows while typing, sticky totals bar with a big Save, date field, bottom sheet for typed total / extra columns and Mark / B and R+B / GST %, Undo snackbar on row removal); Save -> bill view + Saved sheet. Same `EditorApi`, guard, drafts, A31, name required; status pill instead of banners. Customers and Settings reuse the classic pages inside the new shell (restyled only by the larger tokens).
**Out of scope:** layouts B and C, Settings plain words (Phase 195), any classic change.
**Key files:** new `src/pwa/ui/layouts/tidy/*`, `src/pwa/__tests__/tidyLayout.test.ts`; additive registration in `layouts/layoutRegistry.ts` and the `App.tsx` layout branch.
**Version:** 0.1.35
**How to verify:** `npm run typecheck` once; run `tidyLayout.test.ts` (long item names wrap in rows and bill view, guard on Back, Save -> Saved sheet -> Share, read-only and "Edit on PC", remove row -> Undo, switching away and back keeps data), `layoutSwitch.test.ts`, `classicParity.test.ts`, `kitWrap.test.ts`, `src/pwa/__tests__/{editor,editor2,history,shell}.test.ts`, `src/__tests__/importBoundaries.test.ts`. Not run: the real phone look and keyboard.

## Phase 193 — Layout B: Guided flow
**Goal:** The step-by-step layout.
**Depends on:** 191 (192 not required, but the layout pattern from 192 is the model). Mockup row B.
**In scope:** register `guided`; four-tab nav (Home, Bills, Customers, More; Bills = `history`, More = `settings`); Home (huge "New bill", "Continue draft" from the existing draft recovery, today's bills each with a visible Share button); the three steps Party / Items / Review with `interceptBack` (Back steps back, then the normal guard); Items step: quick-add bar above the keyboard (Item, Qty, Rate, GST %, Add) with the running total, added lines as `ItemLine`s above it (tap to edit), Undo on removal; Review: total, Rough / Professional segmented control, "Share image" (primary), "Share PDF", "Saved as SMB-xxxx; pick WhatsApp in the share list", Done. Same `EditorApi`, drafts, A31, name required, status pill.
**Out of scope:** layout C, GST % chips unless Phase 195 ran first and the owner agreed.
**Key files:** new `src/pwa/ui/layouts/guided/*`, `src/pwa/__tests__/guidedLayout.test.ts`; additive registration and `interceptBack` wiring in `App.tsx`.
**Version:** 0.1.36
**How to verify:** `npm run typecheck` once; run `guidedLayout.test.ts` (steps, Back order, quick-add adds a row through the existing editor model, running total, Review share path, Continue draft, A31), `layoutSwitch.test.ts`, `classicParity.test.ts`, `kitWrap.test.ts`, `src/pwa/__tests__/{editor,editor2,shareUi,shell}.test.ts`, `src/__tests__/importBoundaries.test.ts`. Not run: the quick-add bar above the real Android keyboard (a [CHECK]).

## Phase 194 — Layout C: Bills inbox
**Goal:** The paper-bill layout (the riskiest view, built last).
**Depends on:** 191. Mockup row C.
**In scope:** register `inbox`; no bottom nav, Settings as a gear in the top bar; Home = bills grouped by day with an always-on search bar (same shared ranking), one-line today / sync strip, floating "New bill"; paper-style bill view (light paper card, columns # / Item / Qty / Rate / Amount, GST lines as Before GST / GST / Total, floating Share and Edit, bottom padding so they never cover the last row); paper editor (tap a cell to edit, name cell wraps and grows, docked toolbar above the keyboard [previous][next][B][R+B][done] using the existing Next / Done order); Save -> bill view + Saved sheet. Same `EditorApi`, guard, drafts, A31, status pill. Paper card colours are theme tokens (a light paper token pair added in `layouts.css`, never raw hex).
**Out of scope:** any print or paper-size logic (the card is a screen, not the printed bill), any classic change.
**Key files:** new `src/pwa/ui/layouts/inbox/*`, `src/pwa/__tests__/inboxLayout.test.ts`; additive registration in `App.tsx`.
**Version:** 0.1.37
**How to verify:** `npm run typecheck` once; run `inboxLayout.test.ts` (grouping, search, long names, cell edit order, B / R+B through the editor model, Save -> Share, read-only, guard), `layoutSwitch.test.ts`, `classicParity.test.ts`, `kitWrap.test.ts`, `src/pwa/__tests__/{editor,editor2,history,shell}.test.ts`, `src/__tests__/importBoundaries.test.ts`. Not run: docked toolbar and selection on the real keyboard (a [CHECK]).

## Phase 195 — Plain words in Settings, Advanced fold, overflow menu, owner-approved opt-ins
**Goal:** Finish the wording and the Settings pages for the new layouts, and build the optional items only if the owner agreed.
**Depends on:** 192-194 (at least one new layout built).
**In scope:** in the new layouts only: Settings home labels ("Connect to your PC", "Last backup", "Bill number letters"), Supabase URL / anon key / license key under a closed "Advanced" fold, the overflow menu holding "rev N" (version history info); the classic Settings screens are not touched (the new layouts get their own thin wrappers that pass different labels). Optional, ONLY if the owner confirmed (say which in the log): GST % quick-pick chips 5 / 12 / 18 / 28 with `ui.lastGstPct`; `ui.wrapNames` opt-in for classic (one data attribute, classic CSS lock re-pinned only with the owner's approval); party pre-build for classic.
**Out of scope:** renaming anything in classic by default, the shared format registry, print.
**Key files:** new `src/pwa/ui/layouts/shared/{SettingsWords,AdvancedFold}.tsx`; `src/pwa/__tests__/plainWords.test.ts` (extended), `src/pwa/__tests__/layoutSettings.test.ts`.
**Version:** 0.1.38
**How to verify:** `npm run typecheck` once; run `plainWords.test.ts`, `layoutSettings.test.ts`, `classicParity.test.ts`, `src/pwa/__tests__/{customersSettings,syncLogin}.test.ts`, `src/__tests__/importBoundaries.test.ts`. The Advanced fold must keep the sign-in form working (fields still reachable, values kept when folded).

## Phase 196 — Milestone 18 QA gate
**Goal:** Check Phases 189-195 together and hand over the owner's phone checklist.
**Depends on:** 189-195 (or the subset the owner chose to ship; say so).
**In scope:** `npm run typecheck`; ONLY the Milestone 18 test files, the classic locks, the phone test files listed in `docs/MILESTONE18_DESIGN.md` section 9, `src/__tests__/importBoundaries.test.ts`, and the phone build (`build:pwa`); the full suite only if the owner agrees; confirm the classic CSS hashes and DOM snapshots are unchanged since Phase 189; reconcile `PHASE_STATUS.md` (including the stale Phase 186 / 187 table rows); finalise `docs/M18_DEVICE_CHECKLIST.md` (handed over UNFILLED); update `GITHUB_UPDATE_PUSH.md` if needed, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`; bump 0.1.39 and hand back the changed-files zip, the full zip and the push steps.
**Out of scope:** new features. Phase 188 and Phase 69 stay separate.
**Key files:** docs, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.39
**How to verify:** suites green or each failure listed with its cause (compare against the previous zip before calling anything a regression). Owner checklist (only a real phone shows these): `docs/M18_DEVICE_CHECKLIST.md`. NO FULL TEST SUITE unless the owner agrees; real Android behaviour is never written as "verified" from the sandbox.

---

## MILESTONE 19 — Games: bundled open-source web games + chess, Games page, "(?)" tile (Phases 197–204)
*Exit criteria: the Windows app has a Games page (`/games`) with a searchable catalogue of playable games copied from permissively licensed public GitHub repos (no game written from scratch, no API, no key, no network), plus chess (vs computer and two players); each game runs offline in a sandboxed frame on its own `q3game://` origin; every vendored game passes the audit and has its licence kept and credited; the Dashboard has one more tile whose visible name is exactly "(?)" that opens a random game; the only change to the app CSP is `frame-src q3game:`; bills, history, customers, items, print, sync and backup behave exactly as before. Desktop only. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still pending.*

**Planned 2026-10-29 from the owner's request ("add a games page and free games repos from GitHub so we don't write code from scratch, also chess, a Dashboard tile named (?), desktop only"). Docs only; nothing built or run. Binding design: `docs/MILESTONE19_DESIGN.md` (read it first; it holds the source list, the hard rules, the [A] list and the [CHECK] list). Hard rules: `CLAUDE_MUST_READ.md` section 10n. There is NO games API in this milestone (an earlier RAWG idea was scrapped).**

**Standing rules for every Phase 197-204:** the games are copied from upstream, not rewritten; only repos whose real LICENSE file was opened and is MIT / BSD / ISC / Apache-2.0 / Unlicense / CC0 are used (never GPL, AGPL, CC-BY-NC, or no licence); every game passes `tools/audit-games.mjs` before it is added (no remote URLs, no `fetch` / XHR / WebSocket / `eval` / trackers); no game copies a commercial game's name, art or characters; every game keeps its LICENSE and is listed in `docs/THIRD_PARTY_GAMES.md` and on the Credits screen; no network call for games anywhere; the CSP changes only by `frame-src q3game:`; nothing games-related touches bills, parties, items, Supabase, sync or SQL; tokens only, Phosphor only, no emoji in Quot3's own UI, the Phase 92 selector rule; edits to shared registries are small and additive with their existing tests updated, never deleted. **NO FULL TEST SUITE in these phases except the Phase 204 gate and only if the owner agrees: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run the typecheck once plus the named test files (and `src/__tests__/importBoundaries.test.ts`), and list what you ran and what you did NOT run in the phase log. No desktop build, no dev server. Real Windows behaviour (how a game plays, sound, keyboard focus, installer size) is never written as "verified"; it goes in Standing gaps. Say that [A] items are unconfirmed.** Versions are placeholders (renumber if Phase 188 ships 0.2.0 first); each code phase bumps `package.json` and both spots at the top of `package-lock.json` (`GITHUB_UPDATE_PUSH.md` section 2) and hands back the changed-files zip, the full zip and the push steps with the real version.

## Phase 197 — Contract, licence audit, audit tool, pure core
**Goal:** Freeze the contract, prove which repos may be used, build the audit tool, and write the pure catalogue code every later phase builds on.
**Depends on:** Phase 196 (0.1.39). Read `docs/MILESTONE19_DESIGN.md` sections 1-5 first.
**In scope:** (1) Clone / open each source repo in design section 2 (the sandbox can use GitHub; if a repo cannot be fetched, say so and ask the owner to attach a zip of it), read its real `LICENSE` file and the licence of every third-party file it carries, record licence text, commit SHA, date and the [CHECK] answers (`gabrielecirulli/2048`, `chessboard.js`, the chess piece art licence) in a NEW `docs/THIRD_PARTY_GAMES.md`; drop any repo that is not on the allowed list and say so. (2) Contract first in `API_CONTRACTS.md` (M19-1: `manifest.json` schema, the `q3game` URL form, the `games:*` channels, `games.state`, `games.enabled`, the tile-key change). (3) `src/shared/games/{manifest.ts, search.ts, gamesState.ts}` exactly as design 4.1 with tests. (4) `tools/audit-games.mjs` (rules of design 3.4) and `tools/__tests__/auditGames.test.ts` on tiny fixtures. (5) Repair the two pre-existing type errors in `src/renderer/components/grid/__tests__/formatSwitch.test.ts` (lines 222-223, `Cannot find name 'btn'`) so `npm run typecheck` can pass (design A11; test-only; if the owner objected, skip it and list it). (6) `PROJECT_STRUCTURE.md` entry.
**Out of scope:** copying any game into `resources/games`, the protocol, IPC, UI, tile, settings.
**Key files:** new `docs/THIRD_PARTY_GAMES.md`, `src/shared/games/{manifest,search,gamesState}.ts`, `src/shared/games/__tests__/*`, `tools/audit-games.mjs`, `tools/__tests__/auditGames.test.ts`; edited in place `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`, `docs/MILESTONE19_DESIGN.md` (answers to [CHECK]), `src/renderer/components/grid/__tests__/formatSwitch.test.ts` (two lines).
**Version:** 0.1.40
**How to verify:** `npm run typecheck` once (it should now pass; if not, run each `tsc -p` config and list failures with causes); run `manifest.test.ts` (rejects missing fields, a disallowed licence id, an `entry` outside its folder, duplicate ids), `search.test.ts` (typo tolerant, tags, empty query, favourites first, `pickRandom` never repeats the last game when more than one exists, deterministic with a fixed rng), `gamesState.test.ts` (parse garbage safely, cap, prune unknown ids), `auditGames.test.ts` (clean game passes; CDN, `fetch`, `eval`, tracker, oversized file each fail), `src/__tests__/importBoundaries.test.ts`. Not run: any real game.

## Phase 198 — Local game host: `q3game://`, catalogue reader, IPC, CSP, packaging
**Goal:** The app can serve and list games safely from a read-only folder, with no game content yet beyond one tiny test game.
**Depends on:** 197. Read design sections 3 (rules 1, 3, 7, 8), 4.2.
**In scope:** `src/main/games/gameProtocol.ts` (privileged `q3game` scheme registered before `app.ready`; handler serving only inside the game's own folder, read-only; per-response game CSP header; `webRequest` filter cancelling any non-`q3game:` / `data:` / `blob:` request from game frames; path traversal, absolute path and symlink escape refused), `src/main/games/gameCatalog.ts` (reads and validates `manifest.json` through `runtimePaths.ts`, skips and counts invalid entries), `src/main/ipc/games.ts` (channels of design 4.2, zod `.strict()`, `wrapHandler`), channels in `src/shared/ipc.ts`, the typed preload surface, registration in `src/main/ipc/register.ts`, settings defaults `games.enabled` (true) and `games.state` in `src/shared/settings.ts`, `frame-src q3game:` added to BOTH CSP strings in `src/main/security.ts` and asserted in `security.test.ts` (nothing else in the CSP changes), `electron-builder.yml` `extraResources` (`resources/games` -> `games`), the `Alt+Left` `before-input-event` handler that tells the renderer to leave the player, and ONE tiny hand-written test game `resources/games/_selftest/` (not listed in the shipped manifest; used only by tests).
**Out of scope:** any real game, any renderer UI, the tile, the route.
**Key files:** new `src/main/games/{gameProtocol,gameCatalog}.ts`, `src/main/ipc/games.ts`, `resources/games/_selftest/*`, tests `src/main/games/__tests__/{gameProtocol,gameCatalog}.test.ts`, `src/main/ipc/__tests__/games.test.ts`; additive edits in `src/shared/ipc.ts`, `src/shared/settings.ts`, `src/preload/*`, `src/main/ipc/register.ts`, `src/main/security.ts`, `src/main/__tests__/security.test.ts`, `src/main/window.ts` (the key hook only), `electron-builder.yml`, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.41
**How to verify:** typecheck once; run `gameProtocol.test.ts` (serves the self-test game; `..`, encoded `..%2f`, absolute and symlink paths refused; unknown game id 404; no write method; CSP header present; non-allowed request cancelled), `gameCatalog.test.ts` (valid list, an invalid entry skipped and counted, missing manifest = empty list, no crash), `games.test.ts` (bad input rejected), `src/main/__tests__/security.test.ts` (the only CSP difference is `frame-src q3game:`), the existing settings / backup tests that could conflict, `src/__tests__/importBoundaries.test.ts`. Not run: a real Electron window, a real `before-input-event`, the packaged installer.

## Phase 199 — Games batch 1: skymoon173, bushimashen, TomMalbran, gd4Ark 2048, mumuy pacman
**Goal:** The first real games, copied from the repos with licences and audit results recorded.
**Depends on:** 198. Read design 3.2-3.6 and 4.3.
**In scope:** copy only the game folders that pass the audit into `resources/games/<gameId>/` (upstream files, LICENSE kept, minimum patches recorded as diffs in `docs/THIRD_PARTY_GAMES.md`); `resources/games/manifest.json` entries (title, tags, description written by us, source URL, commit, SPDX licence, author, players, touch); apply the IP filter (neutral titles, no copied commercial sprites or sounds; list every rename and every game dropped, with the reason); `src/main/games/__tests__/vendoredGames.test.ts` (runs the audit and the manifest validator over the REAL `resources/games` folder: this is the permanent guard); `docs/THIRD_PARTY_GAMES.md` filled for every shipped game; `PROJECT_STRUCTURE.md`.
**Out of scope:** batch 2, chess, any UI, rewriting any game.
**Key files:** new `resources/games/*` (batch 1), `resources/games/manifest.json`, `src/main/games/__tests__/vendoredGames.test.ts`; edited `docs/THIRD_PARTY_GAMES.md`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.42
**How to verify:** typecheck once; run `vendoredGames.test.ts` (every game: audit clean, licence id allowed, entry inside folder, LICENSE file present, listed in `THIRD_PARTY_GAMES.md`), `gameCatalog.test.ts`, `src/__tests__/importBoundaries.test.ts`. Report the total size added. Not run: playing any game (how each plays on Windows is owed to the owner's checklist).

## Phase 200 — Games batch 2: mini-browser-games (curated), awesome-mini-game (generic only)
**Goal:** Grow the catalogue to a good variety without clones or duplicates.
**Depends on:** 199.
**In scope:** from `wangzifan396-wzf/mini-browser-games`: only the higher-grade games (use its `GAME_TIERS.json`, then OUR audit; target 30-40) that pass the audit and the IP filter; from `davidzhanghui/awesome-mini-game`: only the generic games (Gomoku, Sokoban, Minesweeper, Snake, Memory, Breakout, 2048 type; skip every commercial clone); collapse duplicates (keep the best one per type); same recording rules as Phase 199; log the list of dropped games and reasons; update `THIRD_PARTY_GAMES.md`, the manifest and `PROJECT_STRUCTURE.md`.
**Out of scope:** chess, UI, any code rewrite of a game.
**Key files:** new `resources/games/*` (batch 2), edited `resources/games/manifest.json`, `docs/THIRD_PARTY_GAMES.md`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.43
**How to verify:** typecheck once; run `vendoredGames.test.ts` (must still pass over the larger folder), `gameCatalog.test.ts`, `src/__tests__/importBoundaries.test.ts`. Report the total games count and total size. Not run: playing any game.

## Phase 201 — Chess
**Goal:** A proper chess game in the catalogue, vs computer and two players, built from the permissive chess repos.
**Depends on:** 199 (the host and manifest); independent of 200.
**In scope:** `chess.js` (BSD-2) rules + `chessboard.js` (licence verified in 197) + `zeyu2001/chess-ai` (MIT) as the base game "Chess": play White / Black / random, four levels (search depth), undo, flip board, new game, move list, two-players-on-one-PC mode, game-over messages (checkmate, stalemate, draw rules from chess.js); `kbjorklu/chess` added as "Chess (classic)" only if it adds something; make every asset local (no CDN: the audit must pass); the piece art licence resolved in Phase 197 is applied (credit on the Credits data, LICENSE kept, or a freely licensed set swapped in); minimum patches only, recorded; OPTIONAL and ONLY if the owner confirmed A5 / design rule 10: Stockfish lite single-thread as a worker through `q3game://`, with its full GPLv3 text and corresponding-source offer in `THIRD_PARTY_GAMES.md` and on the Credits screen, as a separate labelled component and a "Strong computer" level; otherwise not shipped and say so in the log.
**Out of scope:** any other game, UI outside the game, online play, opening books, engine downloads.
**Key files:** new `resources/games/chess/*` (and `chess-classic/*`), edited `resources/games/manifest.json`, `docs/THIRD_PARTY_GAMES.md`, `PROJECT_STRUCTURE.md`; a test `src/main/games/__tests__/chessBundle.test.ts` (files present, local assets only, rules library present, audit clean).
**Version:** 0.1.44
**How to verify:** typecheck once; run `vendoredGames.test.ts`, `chessBundle.test.ts`, `src/__tests__/importBoundaries.test.ts`. Rules and AI play are the upstream libraries' behaviour: a headless test may drive chess.js through a short scripted game (scholar's mate, a stalemate position) to prove the bundled library loads; real play strength and the look are owed to the owner's checklist. Not run: the real board on Windows.

## Phase 202 — Games page, player, Settings > Games, Credits
**Goal:** The user-facing Games feature: browse, search, play, favourite.
**Depends on:** 198 (200 and 201 not required to start, but run after 199 so there is something to show). Read design 3.8, 4.4.
**In scope:** `ROUTES.games = '/games'` (+ `routes.test.ts`); nav item (`GameController`, "Games") shown only when `games.enabled`; shortcut `nav.games` `Ctrl+6` [A] with the conflict test passing; command-palette entry; `Games.tsx` page (search focused on arrival, tag chips, card grid, favourites star, Favourites / Recently played filters, Random game button, empty and error states in plain words); the player (`GamePlayer.tsx`: top bar outside the frame with Back, title, Fullscreen, Restart; the sandboxed `<iframe>` of design 3.3; `Alt+Left` event from the main process closes it; opening a game updates `games.state`); `gamesStore.ts` / `gamesActions.ts` (Phase 92 selector rule); Settings > Games (`GamesSection.tsx`: on / off switch, game count and any skipped-entry count, clear favourites and history, the "never uses the internet" sentence, Credits link); the Credits screen (`GamesCredits.tsx`: every game with author, repo, licence and commit; click opens the full LICENSE text from `games:getLicense`; the chess art and, if shipped, Stockfish notices).
**Out of scope:** the tile, more games, any API.
**Key files:** new `src/renderer/pages/Games.tsx`, `src/renderer/components/games/{GamesGrid,GameCard,GamesSearch,GamePlayer,GamesCredits}.tsx`, `src/renderer/components/settings/GamesSection.tsx`, `src/renderer/stores/{gamesStore,gamesActions}.ts`, tests `src/renderer/components/games/__tests__/{gamesPage,gamePlayer}.test.tsx`, `src/renderer/components/settings/__tests__/gamesSection.test.tsx`; additive edits in `src/shared/routes.ts`, `src/renderer/components/layout/navItems.ts`, `src/shared/shortcuts.ts` (+ `shortcutList.ts`), `src/renderer/App.tsx` / router mapping, `src/renderer/pages/Settings.tsx`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.45
**How to verify:** typecheck once; run `gamesPage.test.tsx` (search and tags, favourites persist through `games:setState`, long titles wrap, empty state, nav hidden when disabled), `gamePlayer.test.tsx` (frame `src` is `q3game://<id>/<entry>`, the sandbox attribute is exactly the allowed set, Back button, Restart reloads, `Alt+Left` event closes, state updated on open), `gamesSection.test.tsx`, `src/shared/__tests__/routes.test.ts`, `src/shared/__tests__/shortcuts.test.ts`, the existing layout / nav / settings tests that could conflict, `src/__tests__/importBoundaries.test.ts`. Not run: real iframe focus and keyboard behaviour on Windows.

## Phase 203 — The "(?)" Dashboard tile
**Goal:** The Dashboard has one more tile whose visible name is exactly "(?)" and opens a random game.
**Depends on:** 202. Read design 4.5.
**In scope:** `'games'` added to `DASH_TILE_KEYS` and `DEFAULT_DASH_TILES` in `src/shared/dashboard/live.ts`; `TILE_LABELS.games = '(?)'` in `tileLayout.ts`; `tileRows` for 7 tiles (wide `[[4,4,4],[3,3,3,3]]`, narrow `[[6,6],[6,6],[4,4,4]]` [A]) with every row summing to 12, the clamp and the doc comment updated; the stored `dash.tiles` read path treats a missing `games` key as the default so existing PCs keep their other tiles; `GamesTile.tsx` in `TodayTiles.tsx` (text "(?)" only, a real button, click / Enter calls `games:pickRandom` and opens the player, `aria-label="Random game"`, tokens only, same size and neumorphic style as the others); hidden when `games.enabled` is off or the catalogue is empty (others re-flow with the 1-6 rules); listed as "(?)" in Settings > Dashboard (`DashboardSection.tsx`).
**Out of scope:** any live fetch for this tile (it has none), counts, icons or captions on the tile.
**Key files:** new `src/renderer/components/dashboard/GamesTile.tsx`, test `src/renderer/components/dashboard/__tests__/gamesTile.test.tsx`; edited in place `src/shared/dashboard/{live.ts, tileLayout.ts}`, `src/renderer/components/dashboard/TodayTiles.tsx`, `src/renderer/components/settings/DashboardSection.tsx`, `src/shared/dashboard/__tests__/tileLayout.test.ts` (extended), `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`.
**Version:** 0.1.46
**How to verify:** typecheck once; run `tileLayout.test.ts` (1-7 tiles, no orphan, rows sum to 12, narrow and wide), `gamesTile.test.tsx` (visible text is exactly "(?)", click and Enter open a game, hidden when disabled or empty, an old stored `dash.tiles` without `games` still renders the other six unchanged), the existing `src/renderer/components/dashboard/__tests__/*` files, `src/main/services/__tests__/dashboardLive125.test.ts` (the live tiles are untouched), `src/__tests__/importBoundaries.test.ts`. Not run: the real Dashboard at 1024 / 1280 px on a real screen.

## Phase 204 — Milestone 19 QA gate
**Goal:** Check Phases 197-203 together and hand over the owner's Windows checklist.
**Depends on:** 197-203 (or the subset the owner chose to ship; say so).
**In scope:** the typecheck; ONLY the Milestone 19 test files, `routes`, `shortcuts`, `security` (the CSP differs from 0.1.39 only by `frame-src q3game:`), the dashboard tile tests, the settings tests that could conflict, and `src/__tests__/importBoundaries.test.ts`; the full suite only if the owner agrees; re-run the audit over every shipped game and confirm `THIRD_PARTY_GAMES.md`, `manifest.json` and the Credits data list exactly the same games; confirm no GPL / AGPL / non-commercial licence slipped in (unless the owner approved Stockfish); re-check the IP filter list; report the installer-size change; reconcile `PHASE_STATUS.md`; write `docs/M19_OWNER_CHECKLIST.md` and hand it over UNFILLED (play each game briefly: keyboard focus, sound, restart, Back and `Alt+Left`, fullscreen; high scores survive a restart; chess: all four levels, undo, flip, two-player, checkmate and stalemate; search and tags; favourites; Games off hides nav, shortcut and tile; the tile text is exactly "(?)" at 1024 and 1280 px; Credits shows every licence; offline with Wi-Fi off; installer size acceptable); update `GITHUB_UPDATE_PUSH.md` only if needed, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`; bump 0.1.47 and hand back the changed-files zip, the full zip and the push steps.
**Out of scope:** new features. Phase 188 and Phase 69 stay separate.
**Key files:** docs, `docs/M19_OWNER_CHECKLIST.md`, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.47
**How to verify:** suites green or each failure listed with its cause (compare against the previous zip before calling anything a regression). Owner checklist (only a real Windows run shows these): `docs/M19_OWNER_CHECKLIST.md`. NO FULL TEST SUITE unless the owner agrees; real Windows behaviour is never written as "verified" from the sandbox.


---

## MILESTONE 20 — Games in English: language field, English-by-default, translation phases (Phases 205–217)
*Exit criteria: every game has a `lang` (`en` or `zh`); the Games page, search, random pick and the "(?)" tile show only English-interface games unless the owner turns on "Show games with a Chinese interface" (default off); the 59 Chinese-interface games are translated to English in batches (each finished game marked `en`, its changes kept as a diff and a worksheet, no game logic touched), except any that the owner decides to keep as `zh` or drop; a tool and a permanent guard test keep the translations honest; bills, history, customers, items, print, sync and backup behave exactly as before. Desktop only. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still pending.*

**Planned 2026-10-29 from the owner's report after the Phase 204 gate ("the games are all Chinese, can't understand anything"; "make a milestone for it so I can commence the translation phases"). Docs only; nothing built or run. Binding design: `docs/MILESTONE20_DESIGN.md` (read it first, then `docs/MILESTONE19_DESIGN.md`). Hard rules: `CLAUDE_MUST_READ.md` section 10o.**

**Standing rules for every Phase 205-217:** everything in the Milestone 19 standing rules still holds (copied games, audit, no network, no API, MIT-family licences kept, `q3game` host and CSP untouched, nothing touches bills, parties, items, Supabase, sync or SQL, tokens only, Phosphor only, no emoji in Quot3's own UI, the Phase 92 selector rule, edits to shared files small and additive with their tests updated, never deleted). Plus: a translation changes STRINGS ONLY (never game logic, never a whole-file rewrite; the tool replaces exact strings and every change is kept as a diff in `docs/patches/<gameId>-en.diff`); translations are written by Claude in the session (no translation API, no key, no network) and kept as data in `docs/translations/<gameId>.json`; a game is `lang: "en"` only when the checker finds no Chinese left in visible text, attributes, string literals or CSS `content` (comments may stay) and the audit still passes; a half-translated game is never marked `en` (stop at a game boundary and carry the rest to the next batch); games whose content is the Chinese language itself are judged one by one in Phase 215. **NO FULL TEST SUITE in these phases: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run the typecheck once plus the named test files, and list what you ran and what you did NOT run in the phase log. No build, no dev server. Real Windows behaviour (does the English fit, does the game still play) is never written as "verified"; it goes in Standing gaps (`docs/M20_OWNER_CHECKLIST.md`). Say that [A] items are unconfirmed.** Versions: Phase 205 is a release gate [A] (0.1.48) and Phase 216 is the milestone release gate (0.1.49); Phases 206-215 and 217 do NOT bump the version and do NOT tag (push steps: extract the changed-files zip over the repo folder, `git add .`, `git commit`, `git push origin main`). Renumber if Phase 188 ships 0.2.0 first.

## Phase 205 — Language field, English by default, Settings switch (release gate [A])
**Goal:** Stop showing games the owner cannot read: give every game a language and show only English games unless the owner switches the others on.
**Depends on:** Phase 204 (0.1.47). Read `docs/MILESTONE20_DESIGN.md` sections 1-4.1 first.
**In scope:** (1) Contract first in `API_CONTRACTS.md` (M20-1: manifest `lang`, `filterByLanguage`, setting `games.showChinese`, the tile / random rule). (2) `src/shared/games/manifest.ts`: `lang: 'en' | 'zh'` required in the type and the validator; update `manifest.test.ts`. (3) `tools/games-lang.mjs` (counts CJK characters in visible text and in code strings per game, classifies per design A5, prints a table; plain Node, no network) and `tools/__tests__/gamesLang.test.ts` on tiny fixtures. (4) Run it over the real folder and set `lang` for all 66 games in `resources/games/manifest.json` (expected `en`: `bounce-ball`, `tower-defence`, `snake`, `spider-solitaire`, `blocks`, `2048`, `chess`; every other game `zh`; if the tool disagrees, believe the tool and say so). (5) `src/shared/games/search.ts` (additive): `filterByLanguage(list, showChinese)`; the search, sort, random pick and favourites / recent filters all work on the filtered list; state of hidden games is kept, not pruned; tests. (6) Setting `games.showChinese` (boolean, default `false`) in the settings defaults and the zod schema (small and additive; existing settings tests updated, not deleted). (7) UI: Games page note "N games with a Chinese interface are hidden" plus a "Show them" button, a "Chinese" label on those cards when shown; Settings > Games switch "Show games with a Chinese interface" and "N of 66 games shown"; `openRandomGame` and the "(?)" tile use only the visible list; Credits still lists all 66. (8) `vendoredGames.test.ts`: every manifest game has a valid `lang`. (9) Docs: `PROJECT_STRUCTURE.md`, `THIRD_PARTY_GAMES.md` (note on `lang`). (10) Bump 0.1.48 (`package.json` + both spots at the top of `package-lock.json`) and hand back the changed-files zip, the full zip and the push steps with the tag `v0.1.48` [A: the owner may decide not to release yet; then no bump].
**Out of scope:** translating any game, changing any game file, new games, `src/main` protocol / CSP, `src/pwa`.
**Key files:** `src/shared/games/{manifest,search}.ts`, `tools/games-lang.mjs`, `resources/games/manifest.json`, the settings defaults + schema files, `src/renderer/components/games/*`, `src/renderer/components/settings/GamesSection.tsx`, `src/renderer/components/dashboard/GamesTile.tsx`, `gamesActions.ts`, `API_CONTRACTS.md`, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.48 (release gate [A]).
**How to verify:** `npm run typecheck` once; ONLY `src/shared/games/__tests__/{manifest,search,gamesState}.test.ts`, `src/main/games/__tests__/{gameCatalog,vendoredGames}.test.ts`, `src/main/ipc/__tests__/games.test.ts`, `tools/__tests__/gamesLang.test.ts`, `src/renderer/components/games/__tests__/{gamesPage,gamePlayer}.test.ts`, `src/renderer/components/settings/__tests__/gamesSection.test.ts`, `src/renderer/components/dashboard/__tests__/gamesTile.test.ts`, the settings default / schema tests that mention `games.enabled`, `src/shared/__tests__/{routes,shortcuts}.test.ts`, `src/__tests__/importBoundaries.test.ts`. NO FULL TEST SUITE. Owner check (real Windows only): the Games page shows the English games, the switch brings back all 66, the "(?)" tile never opens a Chinese game.

## Phase 206 — Translation tool, guard test, pilot (2 games)
**Goal:** Build the tool that makes a translation safe and repeatable, and prove the method on the two smallest games.
**Depends on:** Phase 205. Read `docs/MILESTONE20_DESIGN.md` sections 3, 4.2, 4.3 and 5 first.
**In scope:** (1) Contract first in `API_CONTRACTS.md` (M20-2: worksheet format, the three commands, exit codes). (2) `tools/games-i18n.mjs` with `extract`, `apply`, `check` exactly as design 4.2 (exact-string replace only inside the right kind of context, quote escaping per string type, `lang="en"` on `<html>`, diff written to `docs/patches/<id>-en.diff`, nothing written on any failure, idempotent), `tools/games-i18n.d.mts`, and `tools/__tests__/gamesI18n.test.ts` on tiny fixtures (an HTML text node, an attribute, a JS string with each quote type, a template literal, CSS `content`, a comment left alone, the same string in two places replaced together, an `en` still containing Chinese rejected, a `zh` not found rejected, leftovers reported by `check`, a duplicate `en` warned, the audit failing on a fixture with `fetch`). (3) `src/main/games/__tests__/gameLanguage.test.ts` (design 4.3). (4) PILOT: translate `beat-bento` (402), `pocket-golf` (424) completely with the method of design 4.2 (worksheet, apply, check, manifest `lang: "en"` and English description, patch diff, `THIRD_PARTY_GAMES.md` rows). (5) Write down in design section 4.2 anything the pilot taught (tool gaps, tricky string kinds). (6) `PROJECT_STRUCTURE.md`, `PHASE_STATUS.md`.
**Out of scope:** other games, game logic changes, UI changes, version bump.
**Key files:** `tools/games-i18n.mjs`, `tools/games-i18n.d.mts`, `tools/__tests__/gamesI18n.test.ts`, `src/main/games/__tests__/gameLanguage.test.ts`, `docs/translations/{beat-bento,pocket-golf}.json`, `docs/patches/{beat-bento,pocket-golf}-en.diff`, `resources/games/{beat-bento,pocket-golf}/*`, `resources/games/manifest.json`, `API_CONTRACTS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `tools/__tests__/{gamesI18n,gamesLang,auditGames}.test.ts`, `src/main/games/__tests__/{gameLanguage,vendoredGames}.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on the two pilot games. NO FULL TEST SUITE. Real play of the two games is the owner's.

## Phase 207 — Translate games to English, batch 1
**Goal:** Make 8 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 206. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 4751 in all): `shadow-post` (451), `orbital-pinball` (529), `mosaic-jigsaw` (572), `abyss-sonar` (583), `river-holdem` (617), `moon-lander` (625), `solitaire-classic` (673), `mine-matrix` (701). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. These are the rest of the first size group (the two smallest were done in Phase 206). `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 208 — Translate games to English, batch 2
**Goal:** Make 10 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 207. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 7981 in all): `drift-racer` (729), `chalk-billiards` (735), `gem-garden` (740), `air-hockey` (745), `thunder-vanguard` (814), `dodge-blocks` (836), `ember-tactics` (837), `comet-weaver` (846), `elemental-sandbox` (848), `curling-endgame` (851). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 209 — Translate games to English, batch 3
**Goal:** Make 9 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 208. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 9416 in all): `sokoban-quest` (875), `dice-delver` (990), `dungeon-delver` (997), `merge-2048` (1008), `neon-snake` (1041), `sky-shooter` (1077), `merge-cats` (1131), `slingstorm` (1142), `pocket-farm` (1155). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 210 — Translate games to English, batch 4
**Goal:** Make 7 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 209. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 9382 in all): `auto-chess-forge` (1216), `merge-town` (1303), `newton-lab` (1335), `neon-sudoku` (1344), `spud-arena` (1361), `stickman-runner` (1402), `iso-snake` (1421). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 211 — Translate games to English, batch 5
**Goal:** Make 6 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 210. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 9071 in all): `em-lab` (1461), `auto-composer` (1463), `farm-tycoon` (1505), `moba-frontier` (1509), `cat-seesaw` (1544), `stickman-stage` (1589). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 212 — Translate games to English, batch 6
**Goal:** Make 5 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 211. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 8637 in all): `garden-front` (1596), `tank-arena` (1608), `hydrogen-atom` (1761), `fractal-gallery` (1830), `room-styler` (1842). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 213 — Translate games to English, batch 7
**Goal:** Make 4 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 212. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 8684 in all): `math-lab` (2052), `breakout` (2110), `memory` (2192), `match3` (2330). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 214 — Translate games to English, batch 8
**Goal:** Make 3 more games readable: translate their interface to English and mark them `lang: "en"`.
**Depends on:** Phase 213. Read `docs/MILESTONE20_DESIGN.md` sections 3 and 4.2 first. [A] The owner may have named favourites to do first: if so, take those games first and move the same number from the end of this list to the next batch.
**In scope:** for each game, in this order (Chinese characters in brackets, counted 2026-10-29, 8594 in all): `gomoku` (2545), `pulse-studio` (2748), `ball-arena` (3301). Per game: `node tools/games-i18n.mjs extract` -> translate every entry in `docs/translations/<id>.json` (the method of design 4.2: read each string with its line of code, mark `risky` entries, short natural English, placeholders kept, consistent names) -> `apply` -> `check` (no Chinese left, audit passes) -> manifest: `lang: "en"`, English description without "Chinese" -> a row and the patch diff in `docs/THIRD_PARTY_GAMES.md` and `docs/patches/<id>-en.diff`. The permanent guard `gameLanguage.test.ts` picks the new games up by itself. Stop at a game boundary if the session runs short and carry the rest forward (say so in the log). List any label you had to make long and any `risky` entry you handled. `PHASE_STATUS.md` log and `PROJECT_STRUCTURE.md` / `THIRD_PARTY_GAMES.md` rows.
**Out of scope:** game logic changes, new games, translating comments, any tool change (a tool bug goes back to Phase 206 style fixes in this phase only if it blocks the batch, recorded), anything outside `resources/games`, `docs/translations`, `docs/patches`, `manifest.json`, docs.
**Key files:** `resources/games/<id>/*` (strings only), `resources/games/manifest.json`, `docs/translations/<id>.json`, `docs/patches/<id>-en.diff`, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** `npm run typecheck` once; ONLY `src/main/games/__tests__/gameLanguage.test.ts`, `src/main/games/__tests__/vendoredGames.test.ts`, `src/shared/games/__tests__/manifest.test.ts`, `tools/__tests__/gamesI18n.test.ts`, `src/__tests__/importBoundaries.test.ts`; `node tools/games-i18n.mjs check` on each translated game. NO FULL TEST SUITE. Real play is the owner's (`docs/M20_OWNER_CHECKLIST.md`, written in Phase 216).

## Phase 215 — Leftovers: the large and the language-is-content games (two sessions allowed)
**Goal:** Finish the last games, and decide the ones whose content is the Chinese language itself.
**Depends on:** Phase 214. Read `docs/MILESTONE20_DESIGN.md` sections 3 (rules 4 and 6) and 4.2 first.
**In scope:** (1) `starforge-idle` (4977), `mini-games-hub` (3739; 16 files: the hub's registry and each inner game's strings, one worksheet for the folder), `shan-hai` (3669), `star-tarot` (4061): translate with the method of design 4.2, one game at a time, each fully finished before the next (a session may end after any finished game; the next session continues). (2) `crossword-cafe` (984): read it first; if the puzzle works only with Chinese words, keep `lang: "zh"` (hidden by default) and say why [A]; if it can be translated sensibly, translate it. For any of the four that turns out unsuitable the log proposes keep-as-`zh` or drop; the owner decides, nothing is dropped without the owner's word. (3) The `zh` descriptions stay accurate. (4) Docs as in the batch phases.
**Status (2026-10-30):** DONE by the owner's order: only `mini-games-hub` was translated; `starforge-idle`, `shan-hai`, `star-tarot` and `crossword-cafe` were REMOVED on the owner's word (62 games remain, all `en`).
**Out of scope:** game logic changes, new games, version bump.
**Key files:** as in the batch phases, plus `resources/games/mini-games-hub/*`.
**Version:** no bump, no tag (not a release gate).
**How to verify:** as in the batch phases (typecheck once, `gameLanguage`, `vendoredGames`, `manifest`, `gamesI18n`, `importBoundaries`; `check` on each translated game). NO FULL TEST SUITE.

## Phase 216 — Milestone 20 QA gate (release gate)
**Status (2026-10-30):** DONE, version 0.1.49 (tag `v0.1.49`). Typecheck once clean; 13 named test files, 494 tests green; games-lang 62 `en` / 0 `zh`; audit 0 failures; `docs/M20_OWNER_CHECKLIST.md` handed over UNFILLED. The 4 untranslated games were removed in Phase 215 on the owner's word, so there is no `zh` list.
**Goal:** Check Phases 205-215 together, ship the release, and hand over the owner's Windows checklist.
**Depends on:** 205-215 (or the subset the owner chose to ship; say so, and list the games still `zh`).
**In scope:** the typecheck once; `node tools/games-lang.mjs` over every game (no `en` game has Chinese left; the `zh` list equals the games not translated); `tools/audit-games.mjs --root resources/games` (0 failures); the reconciliation of Phase 204 (manifest = folders = `THIRD_PARTY_GAMES.md` = `THIRD_PARTY.txt` = Credits data; all MIT; no GPL / AGPL / non-commercial licence) and a count of translated games, their diffs and worksheets; ONLY the named tests (`gameLanguage`, `vendoredGames`, `manifest`, `search`, `gamesState`, `gameCatalog`, `gamesI18n`, `gamesLang`, `auditGames`, the Phase 205 UI tests, `importBoundaries`); the full suite only if the owner agrees; reconcile `PHASE_STATUS.md`; write `docs/M20_OWNER_CHECKLIST.md` UNFILLED (a table: every translated game by id with the ticks "all text is English / nothing cut off or overlapping / buttons make sense / still plays", the switch on and off, the "(?)" tile, the Games page counts, offline, the decisions on `zh` games, a place to list problem games by id and what is wrong); update `GITHUB_UPDATE_PUSH.md` only if needed, `API_CONTRACTS.md`, `PROJECT_STRUCTURE.md`; bump 0.1.49 (`package.json` + both spots at the top of `package-lock.json`) and hand back the changed-files zip, the full zip and the push steps with the tag `v0.1.49`.
**Out of scope:** new features. Phase 188 and Phase 69 stay separate.
**Key files:** docs, `docs/M20_OWNER_CHECKLIST.md`, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.49 (release gate).
**How to verify:** typecheck once + the named test files green, or each failure listed with its cause (compare against the previous zip before calling anything a regression). NO FULL TEST SUITE unless the owner agrees; real Windows behaviour is never written as "verified" from the sandbox. Owner checklist: `docs/M20_OWNER_CHECKLIST.md`.

## Phase 217 — Fix pack from the owner's report (only if needed)
**Goal:** Fix what the owner found on Windows: cut-off or overlapping English text, wrong or odd wording, leftover Chinese, a game that broke.
**Depends on:** Phase 216 and the owner's filled `docs/M20_OWNER_CHECKLIST.md` (game id + what is wrong, a screenshot helps). Skip this phase if there is no report.
**In scope:** only the listed games: shorten or reword the English strings in `docs/translations/<id>.json`, re-run `apply` / `check` (the tool re-applies a changed worksheet by restoring the recorded Chinese text first) and refresh the diff; a game that cannot be fixed safely goes back to `zh` or is dropped, only with the owner's word. Small additive CSS-only fixes inside a game folder are allowed if a label cannot be made to fit by wording, each recorded as a diff [A].
**Out of scope:** new games, logic changes, anything not in the owner's list.
**Key files:** the listed games, their worksheets and diffs, `docs/THIRD_PARTY_GAMES.md`, `PHASE_STATUS.md`.
**Version:** no bump by itself; the owner may ship it with the next release.
**How to verify:** typecheck once; `gameLanguage`, `vendoredGames`, `gamesI18n` tests; `check` on each touched game. NO FULL TEST SUITE.

---

## MILESTONE 21 — Page memory and PageUp / PageDown party paging (Phases 218–221)
*Exit criteria: leaving a page remembers its position (scroll, selection by ID, filters, open panels) and Esc / the Go-to shortcuts / returning from an opened bill restore it; Esc returns to the previous page (one level) with the Dashboard still the root; PageUp / PageDown step through the parties on the Customers, History-for-a-party and Items-sales screens and inside a bill opened from a list (History first) they step to the previous / next BILL of that list directly, without going back (the grid's own page keys there move to Ctrl+PageUp / Ctrl+PageDown [A]) and keep their grid meaning on Create; the keyboard rules, the shortcut registry, the cheat-sheet and the frozen tests agree; bills, parties, print, sync, backup and the schema behave exactly as before. Desktop only. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still pending.*

**Planned 2026-11-11 from the owner's request ("the correct page navigation, and the memory such that it remembers which was the previous page and position"; "Page Up or Down in the History or party bills or anywhere other than new party bill creation, we can see the parties up and down"). Docs only; nothing built or run. Binding design: `docs/MILESTONE21_DESIGN.md` (read it first). Hard rules: `CLAUDE_MUST_READ.md` section 10p.**

**Standing rules for every Phase 218-221:** no schema, migration, Supabase, sync, backup or bill-data change; UI state only; Create always opens a clean bill (D-K15) and stores no memory; Dashboard stays the navigation root (D-K8); the unsaved-work guard (D-K9) and the Create leave guard are untouched; IDs, never row numbers, in any remembered selection; the Phase 92 selector rule for every store; tokens only; edits to shared files small and additive with their tests UPDATED, never deleted (the frozen tests `routes.test.ts` and `shortcuts.test.ts` change only as the owner's request in the design document allows, and each change is quoted in the phase log). **NO FULL TEST SUITE: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run the typecheck once plus the named test files, and list what you ran and what you did NOT run in the phase log. No build, no dev server. Real keyboard feel in a real window is never written as "verified"; it goes in Standing gaps (`docs/M21_OWNER_CHECKLIST.md`). Say that [A] items are unconfirmed.** Versions: only Phase 221 bumps (0.1.50 [A]); Phases 218-220 do not bump or tag. Renumber the version if Phase 188 ships 0.2.0 first.

## Phase 218 — Contract and pure core: page memory, previous-page rule, party paging
**Goal:** Write the contracts and the pure, tested logic so the UI phases only wire it in.
**Depends on:** Phase 216 (0.1.49) (Phase 217 only if the owner reported problems). Read `docs/MILESTONE21_DESIGN.md` sections 3-5 first, then `src/shared/routes.ts`.
**In scope:** (1) Contract first in `API_CONTRACTS.md` (M21-1 `PageMemory`, M21-2 the previous-page rule, M21-3 party paging). (2) `src/shared/nav/pageMemory.ts`: the `PageMemory` type, `emptyMemory`, `saveMemory`, `restoreSelection` with nearest-neighbour fallback when the remembered ID is gone, a size cap (at most one record per route path plus one per party for paging pages) and a `sanitize` that drops unknown fields. (3a) `src/shared/nav/billStepping.ts`: `BillContext` type and `stepBill(orderedIds, currentId, 'prev' | 'next')` returning `{ id, atEnd }` (no wrap, skips missing IDs, nearest when the current ID is missing, safe on empty and one-item lists). (3) `src/shared/nav/partyPaging.ts`: `nextParty(list, currentId, 'prev' | 'next')` returning `{ id, atEnd }`, no wrap, nearest when the current ID is missing, safe on empty and one-item lists. (4) `src/shared/routes.ts` (additive): `navPush` keeps one previous page (`[dashboard, previous, current]`) per design section 4, pops when the target equals the previous page, resets on the Dashboard; the old behaviour stays available behind an option so the UI phase can switch it on [A]; update `routes.test.ts` with new cases and keep every old case that still holds, quoting each changed expectation. (5) Tests in `src/shared/nav/__tests__/{pageMemory,partyPaging,billStepping}.test.ts` (IDs not indexes, deleted item, empty list, filtered list, ends, one party, the `[dashboard, a, b]` stack transitions, Create stores nothing). (6) Check how the settings table is synced and decide the `nav.rememberAcrossRestart` key (local-only or dropped) and record it. (7) `KEYBOARD_CELL_RULES.md` section 15 stays PLANNED; `PROJECT_STRUCTURE.md`, `PHASE_STATUS.md`.
**Out of scope:** any UI, any store, shortcuts registry changes.
**Key files:** `src/shared/nav/{pageMemory,partyPaging,billStepping}.ts`, `src/shared/routes.ts`, `src/shared/__tests__/routes.test.ts`, `API_CONTRACTS.md`, docs.
**Version:** no bump.
**How to verify:** `npm run typecheck` once; ONLY `src/shared/nav/__tests__/{pageMemory,partyPaging,billStepping}.test.ts` and `src/shared/__tests__/routes.test.ts`. NO FULL TEST SUITE.

## Phase 219 — Page memory wired in, and the previous-page rule
**Goal:** Going back puts the owner exactly where he was, on the right page.
**Depends on:** Phase 218. Read `docs/MILESTONE21_DESIGN.md` sections 3-4 first.
**In scope:** (1) `src/renderer/stores/pageMemoryStore.ts` (in memory, Phase 92 rule: no fresh arrays or objects from selectors) with save on leave plus a short debounce while scrolling / selecting. (2) The router (`routerStore.ts`) uses the new `navPush` rule; Esc (`nav.back`), Ctrl+0..4, the Items / Games / Settings go-to actions and Dashboard tiles restore memory; the Create leave guard and the drill-down `returnToCurrent` keep working unchanged. (3) Page adapters, each small: History (dates list and bills list scroll, selected bill ID, search text, date range, source filter, trash view flag), Customers (list scroll, selected customer ID, search / sort), Items (three windows' scroll, selected group and sale IDs), Settings (the open section), Games (search and scroll, only if the Games page is on). Dashboard and Create store nothing. (4) Restoring a bill opened from History returns to the same bill row and scroll (works with `returnToCurrent`). (4b) Capture the `BillContext` (the FULL ordered, filtered list of bill IDs the owner was looking at, from the page's store / repo query, not only the rendered virtual rows) whenever a bill is opened from History, the Customers or Items bill lists, or (after Phase 229) sentence-search results; keep it in `pageMemoryStore` for the life of that bill view; the Esc return selects the bill currently viewed. (5) Optional persistence across restart only if Phase 218 allowed it: setting `nav.rememberAcrossRestart` (default false) and one switch in Settings > Behaviour [A]. (6) Update `KEYBOARD_CELL_RULES.md` section 12 (Esc rule changed, with the owner's request quoted) and mark section 15 part 1 IMPLEMENTED. (7) Tests: jsdom tests per adapter (save, leave, return, restored scroll / selection, remembered item deleted meanwhile, filter text restored), the store, and the Esc walk-through of every page.
**Out of scope:** PageUp / PageDown party paging (Phase 220), any data or schema change.
**Key files:** `src/renderer/stores/pageMemoryStore.ts`, `src/renderer/router/routerStore.ts`, `src/shared/routes.ts`, `src/renderer/pages/{History,Customers,Items,Settings,Games}.tsx` and their component folders, `src/renderer/hooks/useAppActions.ts`, `docs/reference/KEYBOARD_CELL_RULES.md`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the Phase 218 test files, `routes.test.ts`, `shortcuts.test.ts`, the new adapter test files, the existing `src/renderer/components/{history,customers,items}/__tests__` files that touch the changed components, `src/__tests__/importBoundaries.test.ts`. NO FULL TEST SUITE. Owner check (real Windows only): scroll History, open a bill, Esc: same place; History to Customers to Esc: back on History.

## Phase 220 — Bill stepping and party paging with PageUp / PageDown
**Goal:** (1) In a bill opened from the History panel (or another list), PageUp / PageDown show the previous / next bill of that list directly, without going back to the list. (2) On the list screens, PageUp / PageDown step through the parties. Neither applies to the Create (new bill) screen.
**Depends on:** Phase 219. Read `docs/MILESTONE21_DESIGN.md` section 5 and 5.1 first.
**In scope:** (1) FIRST read how History (dates list + bills list), the Customers page and the Items sales panel are organised today and write that finding in the phase log (the planning session did not trace it); settle the flattened on-screen order for bill stepping and what "party in focus" means; if the screens differ from the design, follow the owner's intent and list the difference as [A]. (2) Register in `src/shared/shortcuts.ts`: `bill.stepPrev` / `bill.stepNext` (PageUp / PageDown in the opened-bill scope, only when the bill has a `BillContext`, only while no cell is being text-edited, never in an input, dropdown, dialog or menu), `party.prev` / `party.next` (PageUp / PageDown on the party list screens, only when focus is in the list or page body), and re-bind the grid's own page-up / page-down in a bill that has a `BillContext` to Ctrl+PageUp / Ctrl+PageDown [A] (a per-screen exception to `KEYBOARD_CELL_RULES.md` section 4; Create and bills without a context are unchanged); run the conflict test; update the frozen section-8 test `shortcuts.test.ts` and the cheat-sheet (F1) with each change quoted and the owner's request recorded. (3) Bill stepping: use `stepBill` with the captured `BillContext`; open the target bill in the same bill view (the stack does not grow); the unsaved Save / Discard / Cancel guard as for Esc when the current bill has unsaved changes; end marker at the ends, no wrap, no stacked toasts; deleted / trashed IDs skipped; the Esc return selects the bill currently viewed and scrolls it into view (page memory). (4) Party paging: wire `nextParty` into Customers (selection moves), History for a party (filter switches, list reloads), Items sales panel (selected sale's party moves); History with no party in focus keeps normal PageUp / PageDown paging; each party opens at its remembered position (page memory keyed by page + party ID). (5) Tests: step down / up through a captured list, across date boundaries, skipped deleted bill, ends, guard on unsaved, no action while a cell is edited, no context means grid paging, Ctrl+PageUp / Ctrl+PageDown page the grid in a stepped bill, Esc returns with the viewed bill selected, party paging focus rules and ends. (6) Create (new bill) keeps PageUp / PageDown as grid paging: a test proves it. (7) `KEYBOARD_CELL_RULES.md` section 15 IMPLEMENTED; `PROJECT_STRUCTURE.md`.
**Out of scope:** changing what PageUp / PageDown do in the grid on Create, wrap-around, mouse buttons, stepping through the trash view.
**Key files:** `src/shared/shortcuts.ts`, `src/shared/nav/{billStepping,partyPaging}.ts`, `src/renderer/hooks/{useHotkeys,useAppActions}.ts`, `src/renderer/stores/pageMemoryStore.ts`, `src/renderer/pages/{History,Customers,Items,Create}.tsx` and their components, `src/shared/__tests__/shortcuts.test.ts`, `docs/reference/KEYBOARD_CELL_RULES.md`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY `shortcuts.test.ts`, `routes.test.ts`, the Phase 218 and 219 test files, the new stepping / paging UI tests, the existing component tests of the touched screens, `importBoundaries.test.ts`. NO FULL TEST SUITE. Owner check (real Windows only): open a bill from History, PageDown shows the next bill directly, PageUp the previous, Esc returns to History with the bill you were on highlighted; Create still pages the grid.

## Phase 221 — Milestone 21 QA gate (release gate)
**Goal:** Check Phases 218-220 together, ship 0.1.50 [A] and hand over the owner's checklist.
**Depends on:** 218-220.
**In scope:** the typecheck once; ONLY the named test files of Phases 218-220 plus `routes`, `shortcuts`, `importBoundaries`; reconcile `PHASE_STATUS.md`, `PROJECT_STRUCTURE.md`, `API_CONTRACTS.md`, `KEYBOARD_CELL_RULES.md` (sections 8, 12, 15 agree with the code); write `docs/M21_OWNER_CHECKLIST.md` UNFILLED (a table: the Esc walk-through of every page, History to Customers to Esc, open a bill and return to the same row, PageUp / PageDown on each screen, open a bill from History and press PageDown / PageUp through several bills (across a date change, at the first and last bill, with unsaved edits, while a cell is being edited), Esc back to History with the right bill highlighted, Ctrl+PageUp / Ctrl+PageDown paging that bill's grid, Create unchanged, a remembered item deleted meanwhile, the restart switch); bump 0.1.50 (`package.json` + both spots at the top of `package-lock.json`) and hand back the changed-files zip, the full zip and the push steps with the tag `v0.1.50` [A: the owner may release M21 and M22 together; then no bump here].
**Out of scope:** new features.
**Key files:** docs, `docs/M21_OWNER_CHECKLIST.md`, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.50 (release gate [A]).
**How to verify:** typecheck once + the named test files green, or each failure listed with its cause (compare against the previous zip before calling anything a regression). NO FULL TEST SUITE unless the owner agrees.

---

## MILESTONE 22 — Local AI: item suggestions, party purchase history in the billing screen, plain-sentence search (Phases 222–232)
*Exit criteria: a local embedding model (default `multilingual-e5-small` int8 [A]) runs in an Electron utility process, offline, shipped inside the installer; with `ai.enabled` and `ai.billingPanel` ON, setting a party and typing an item in the Create screen shows that party's earlier same-looking items (name used, GST / non-GST / other format, last rate, last date, times bought, reason) in a panel that never takes focus and that the owner toggles from the billing toolbar or a key; the Items page proposes "Suggested" merges for leftover groups that the owner accepts or dismisses; the command palette and History understand plain sentences ("ruby tomato to Sharma last month") with visible, fixable chips; Settings > AI shows status, indexing, rebuild and delete; with AI off or the model missing the app behaves exactly as 0.1.49; nothing is ever filled, merged or saved by the AI on its own; bills, totals, GST, rounding, print, sync, Supabase and the phone behave exactly as before; one additive migration (the vector cache). Desktop only. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still pending.*

**Planned 2026-11-11 from the owner's request (a local Hugging Face model for item grouping; "if the party name previously purchased same looking items, in what format and in what names"; "we can toggle it from the billing UI"; "search by plain sentence"). Docs only; nothing built or run. Binding design: `docs/MILESTONE22_DESIGN.md` (read it first, then `docs/ITEM_SORTER_SPEC.md`). Hard rules: `CLAUDE_MUST_READ.md` section 10q.**

**Standing rules for every Phase 222-232:** local only, no network at runtime, no key; suggestions only; the AI never touches money; protected tokens (numbers, sizes, units) are never fuzzy-merged; order of trust owner rules, then group / near-text matches, then embeddings; every AI feature default OFF and harmless when off; the model runs only in the utility process (the renderer and `src/pwa` never import the AI packages: `importBoundaries.test.ts` enforces it); tests use the deterministic FAKE embedder, never a real model, never the network; no schema, sync, Supabase, backup-format or phone change except the one additive migration in Phase 224; the Phase 92 selector rule; tokens only; Phosphor only; no emoji in Quot3's own UI; edits to shared files small and additive with their tests updated, never deleted. **The Claude.ai sandbox cannot reach `huggingface.co`: no session downloads the model; the owner (and the GitHub Action) run `tools/fetch-ai-model.mjs`. NO FULL TEST SUITE: do not run `npm test`, a bare `npx vitest run` or the whole `src` folder; run the typecheck once plus the named test files, and list what you ran and what you did NOT run in the phase log. No build, no dev server. Real model quality, speed, memory and the packaged Windows install are never written as "verified"; they go in Standing gaps (`docs/M22_OWNER_CHECKLIST.md`). Say that [A] items are unconfirmed.** Versions: only Phase 231 bumps (0.1.51 [A], or 0.1.50 if the owner releases M21 and M22 together); Phases 222-230 and 232 do not bump or tag. Renumber if Phase 188 ships 0.2.0 first. Phase 223 changes `package.json` / `package-lock.json` (one new dependency, exact pin) without a version bump.

## Phase 222 — Foundations: contract, config, settings, licence audit, owner tools
**Goal:** Everything the later phases stand on, with no model and no runtime code yet.
**Depends on:** Phase 221 (or Phase 216 if the owner ships M22 first). Read `docs/MILESTONE22_DESIGN.md` sections 2-4 first.
**In scope:** (1) Contract first in `API_CONTRACTS.md` (M22-1 settings keys and `ModelConfig`, M22-2 `ai:*` IPC shapes, M22-3 vector cache, M22-4 suggestion and `StructuredQuery` types). (2) `src/shared/ai/modelConfig.ts`: model id, dimension, prefix policy (`query: ` / `passage: ` for e5), pooling, normalisation, thresholds (conservative [A]), file list with SHA-256 placeholders filled by the fetch tool; `src/shared/ai/vectorMath.ts` (dot, cosine, normalise, top-K) with tests. (3) Settings keys (small, additive, defaults + zod schema, existing settings tests updated): `ai.enabled` false, `ai.billingPanel` false, `ai.itemSuggestions` false, `ai.sentenceSearch` false. (4) `tools/fetch-ai-model.mjs` (plain Node: downloads the pinned model revision from Hugging Face into `resources/ai-models/<modelId>/`, checks every SHA-256, refuses on mismatch; run by the owner on Windows and by the Action; never run in the sandbox) + `.gitignore` entry for `resources/ai-models/`. (5) `tools/ai-bakeoff.mjs` (owner runs it on his PC against an exported text list of his real item names, no amounts: prints, for sample names, the top neighbours under each candidate model, so he can pick `multilingual-e5-small`, `all-MiniLM-L6-v2` or the Granite model and so the thresholds can be set) + a tiny fixture test with the fake embedder. (6) Licence audit: new `docs/THIRD_PARTY_AI.md` (model, upstream, licence text link, revision, files, SHA-256, what ships) and `THIRD_PARTY.txt` entry; the model's licence must be a permissive one or the phase stops and asks the owner [A: e5-small upstream is MIT; confirm from the model card]. (7) `CLAUDE_MUST_READ.md` 10q is already written; check it matches what you built. (8) `PROJECT_STRUCTURE.md`, `PHASE_STATUS.md` (and an "Awaiting from owner" row: export of item names for the bake-off).
**Out of scope:** the dependency install, the worker, any UI.
**Key files:** `src/shared/ai/{modelConfig,vectorMath}.ts`, `src/shared/settings.ts` (+ schema), `tools/{fetch-ai-model,ai-bakeoff}.mjs`, `.gitignore`, `docs/THIRD_PARTY_AI.md`, `API_CONTRACTS.md`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new `src/shared/ai/__tests__/vectorMath.test.ts`, the bake-off fixture test, the settings default / schema tests, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 223 — Embedding service: dependency, packaging, utility process, IPC
**Goal:** A real embedder that can run offline inside the packaged app, and a fake one for tests, behind one interface.
**Depends on:** Phase 222. Read `docs/MILESTONE22_DESIGN.md` sections 3 and 5 first.
**In scope:** (1) Look up `@huggingface/transformers` (and its `onnxruntime-node` dependency) on the npm registry, pick the newest stable release OLDER than 14 days, install with `npm i <pkg>@<exact> --save-exact` (install scripts handled the way earlier native packages were: record what ran), record in `DEPENDENCY_VERSIONS.md` and the lockfile. (2) `electron-builder.yml`: `extraResources` for `resources/ai-models`, `asarUnpack` for the onnxruntime native files; confirm electron-builder still skips rebuild (`npmRebuild: false`) and note the Windows x64 binaries [A]. (3) `.github/workflows/release.yml`: a step that runs `node tools/fetch-ai-model.mjs` before the build, cached by revision. (4) `src/main/ai/embedWorker.ts` (utility-process entry, lazy model load, batching, mean pooling + L2 normalise, returns Float32 arrays), `src/main/ai/aiService.ts` (spawns and supervises the worker, queue with back-pressure and cancel, status `notInstalled | loading | ready | error`, restart on crash with a limit, one log line per failure, never throws into callers), `src/main/ai/fakeEmbedder.ts` (deterministic hash vectors; similar strings get similar vectors so tests can assert ranking). (5) `src/main/ipc/ai.ts` (`ai:status`, `ai:embed` for internal use, validated by zod, registered in `register.ts`), preload typing, no renderer import of the package. (6) Tests with the fake embedder only: queue order, cancel, crash-restart limit, status transitions, the IPC validation, and the boundary test.
**Out of scope:** the vector cache, any UI, any real model run (impossible in the sandbox; standing gap).
**Key files:** `package.json` + `package-lock.json`, `electron-builder.yml`, `.github/workflows/release.yml`, `src/main/ai/*`, `src/main/ipc/{ai,register}.ts`, `src/preload/*`, `DEPENDENCY_VERSIONS.md`.
**Version:** no bump (dependency added; say so).
**How to verify:** typecheck once; ONLY `src/main/ai/__tests__/*`, `src/main/ipc/__tests__/ai.test.ts`, `importBoundaries.test.ts`. NO FULL TEST SUITE; no build. Standing gap: real model load in the packaged Windows app.

## Phase 224 — Vector cache and background indexer
**Goal:** Every item name the app has seen gets a vector, kept locally, without ever slowing billing down.
**Depends on:** Phase 223. Read `docs/MILESTONE22_DESIGN.md` section 6 first.
**In scope:** (1) Additive migration `src/main/db/migrations/0010_ai_text_vectors.sql` and the drizzle table in `schema.ts` (design section 6); update the migration meta the way earlier migrations did and the schema tests. (2) `src/main/db/aiVectorRepo.ts` (get many by hash, upsert many, count, delete all, delete by model id). (3) `src/shared/ai/textKey.ts` (normalise + hash, reusing `shared/items/normalise`; tests). (4) `src/main/ai/indexer.ts`: collects distinct normalised item names from the existing repos (all bills at first run, then new / changed bills on save and import), queues the missing ones, embeds in chunks of about 32 per idle tick, pausable and resumable, survives restart, rebuilds when the model id or version changes, progress events. (5) Decide the backup question (default exclude, rebuild after restore [A]) and make the backup / restore code consistent with it; it must not change the backup format for existing files. (6) Not synced: confirm no `shared_sync_records` entry. (7) Tests with the fake embedder and an in-memory database: dedupe by hash, resume, model change reindexes, deleting a bill leaves the cache valid, the cache can be dropped.
**Out of scope:** any suggestion UI, ranking.
**Key files:** `src/main/db/{schema,aiVectorRepo,migrate}.ts`, `src/main/db/migrations/0010_ai_text_vectors.sql`, `src/main/ai/indexer.ts`, `src/shared/ai/textKey.ts`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new repo / indexer / textKey tests, the migration test files that list migrations, the backup tests that touch the changed code, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 225 — Party purchase-history engine (pure)
**Goal:** The brain of the billing-screen help: given a party and typed text, return that party's earlier same-looking items with format, name, rate and date.
**Depends on:** Phase 224. Read `docs/MILESTONE22_DESIGN.md` section 7 and `docs/ITEM_SORTER_SPEC.md` first.
**In scope:** (1) Read how the history and items repos expose a party's lines (`historyRepo`, `itemsRepo`, `shared/items/sales`, `shared/billModel`, `shared/format/registry`) and write down which fields give the name used, qty + unit, rate, date and the bill's format (GST / non-GST / other); if the line-level GST flag exists use it too. (2) `src/shared/ai/partyHistory.ts` as designed: tier 1 owner rules and groups, tier 2 near-text from `shared/items`, tier 3 cosine above the model threshold, protected-token rejection (`parseUnits`, numbers, sizes), duplicate collapse by name + format, sort by tier / score / recency, max 5, a `why` per result, a pure explanation string. (3) `src/main/ai/suggestService.ts` and IPC `ai:suggestForParty` (party ID + typed text in, suggestions out; works with a missing model by returning tier 1 and 2 only, flagged `embeddingsUsed: false`). (4) Tests with the fake embedder on invented fixtures only (never the owner's real data): same group, near text, similar by vector, conflicting numbers rejected ("505" vs "D7" never matches), unit mismatch rejected, GST vs non-GST kept separate, recency order, empty history, model off.
**Out of scope:** UI, Items page suggestions.
**Key files:** `src/shared/ai/partyHistory.ts`, `src/main/ai/suggestService.ts`, `src/main/ipc/ai.ts`, tests.
**Version:** no bump.
**How to verify:** typecheck once; ONLY `src/shared/ai/__tests__/partyHistory.test.ts`, `src/main/ai/__tests__/suggestService.test.ts`, `src/main/ipc/__tests__/ai.test.ts`, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 226 — Billing-screen panel and toggle
**Goal:** The owner sees, while billing, what this party bought before and in which format, and can switch it on and off from the billing UI.
**Depends on:** Phase 225. Read `docs/MILESTONE22_DESIGN.md` section 7 and `docs/reference/KEYBOARD_CELL_RULES.md` first.
**In scope:** (1) `src/renderer/components/create/AiHistoryPanel.tsx` and a small store (Phase 92 rule): shown only when `ai.enabled` and `ai.billingPanel` are on, a party is set and an item cell is active; debounced about 150 ms; up to 5 rows (name this party used, format pill, last rate, last qty + unit, last date, "bought N times", reason chip); never takes focus, never moves the grid cursor, hides when there is nothing; shows a quiet "AI is loading / not installed" state only when the owner turned it on. (2) A visible switch in the Create toolbar and an action `ai.billingPanel.toggle` with a key chosen by the shortcut-conflict test (proposed Alt+H [A]; must not collide with Alt+1/2/3, Alt+C, Alt+Shift+Up/Down); the switch writes `ai.billingPanel`; add to `shortcuts.ts`, the cheat-sheet and the tests (the frozen section-8 map changes only with the owner's approval, recorded). (3) Optional [A]: an accept key copies the highlighted suggestion's NAME into the active item cell, one undo step, never rate or qty; build it only if the owner kept it, else leave a documented extension point. (4) The panel survives party changes and bill switches without stale rows (race test). (5) Everything degrades silently on any AI error. (6) Tests: panel states (off, loading, no party, no match, matches), the toggle key, no focus steal, no cursor move, accept key (if built) is one undo step and writes only the name.
**Out of scope:** Items page, search, Settings > AI, any change to totals or rates.
**Key files:** `src/renderer/components/create/AiHistoryPanel.tsx`, `src/renderer/pages/Create.tsx`, `src/renderer/stores/aiPanelStore.ts`, `src/shared/shortcuts.ts`, tests.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new panel and store tests, `shortcuts.test.ts`, the existing Create component tests touched, `importBoundaries.test.ts`. NO FULL TEST SUITE. Owner check (real Windows only): enable AI, set a known party, type an item the party bought before, the panel lists it with the right format and rate; toggle key hides / shows it; the grid feels exactly as fast.

## Phase 227 — Items page: "Suggested" merges
**Goal:** The Items page proposes merges for the groups the rules left alone, and never merges by itself.
**Depends on:** Phase 225. Read `docs/MILESTONE22_DESIGN.md` section 8 and `docs/ITEM_SORTER_SPEC.md` first.
**In scope:** (1) `src/shared/ai/groupSuggest.ts` (pure): group representation (average of name vectors or the most frequent name), nearest groups above the threshold, protected-token rejection, GST / non-GST never mixed, a `why`; tests with the fake embedder. (2) IPC `ai:suggestGroups` and a store in `src/renderer/stores/itemsStore.ts` (additive). (3) In the spellings / groups windows: a "Suggested" badge and the reason on proposed merges; Accept creates an `item_rule` exactly as the existing merge does (undoable); Dismiss is remembered locally so it is not shown again; shown only when `ai.itemSuggestions` is on. (4) The Items page behaves exactly as before with the setting off. (5) Tests: suggestions appear, Accept uses the existing rule path, Dismiss persists, numbers and units never merged, off means no change.
**Out of scope:** automatic merges, the billing panel, search.
**Key files:** `src/shared/ai/groupSuggest.ts`, `src/renderer/components/items/*`, `src/renderer/stores/itemsStore.ts`, `src/renderer/pages/Items.tsx`, `src/main/ipc/ai.ts`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new `groupSuggest` tests, the existing `itemsPage`, `itemsWindows113`, `itemsSales114` tests, the new component tests, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 228 — Plain-sentence parser (pure)
**Goal:** Turn a typed sentence into a structured, explainable query.
**Depends on:** Phase 225 (for the item text path). Read `docs/MILESTONE22_DESIGN.md` section 9 first.
**In scope:** (1) `src/shared/ai/sentenceQuery.ts`: `parseSentence(text, { today, customers })` returning `StructuredQuery` (`party?`, `dateRange?`, `amount?`, `format?`, `itemText`) and `chips[]` with the source span of each; English date words (today, yesterday, this / last week, this / last month, last N days, month names, dd/mm/yyyy and dd-mm ranges, day-first), amounts (above / over / under / below, k and lakh shorthand), format words (gst, non gst), party matching with the existing fuzzy matcher (ambiguity returns the top choices), the rest is `itemText`. Deterministic, no model, no network. (2) The sentence path never throws: unknown words stay in `itemText`. (3) Tests: a table of at least 40 sentences (invented), day-first dates, month boundaries and leap years with an injected `today`, ambiguous party, no party, only dates, empty text.
**Out of scope:** UI, embeddings re-rank, Hindi / Hinglish words (a later phase if the owner asks) [A].
**Key files:** `src/shared/ai/sentenceQuery.ts`, `src/shared/ai/__tests__/sentenceQuery.test.ts`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY `sentenceQuery.test.ts`, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 229 — Plain-sentence search UI
**Goal:** Type a sentence in Ctrl+K or the History search box and get the right bills, with chips that show how it was understood.
**Depends on:** Phase 228 and Phase 219 (page memory, so opening a result and pressing Esc returns to the same list and position). Read `docs/MILESTONE22_DESIGN.md` section 9 first.
**In scope:** (1) A "Search bills" result group in the command palette and sentence handling in the History search box (`history.search`): parse, show the chips (click to fix, remove or change the party / dates / amount), run the structured query through the existing history repo, rank the item part with the text search and, when the model is ready and `ai.sentenceSearch` is on, re-rank with embeddings (protected tokens enforced). (2) IPC `ai:searchSentence` only for the re-rank; the filtering itself uses existing repos. (3) Results open with `returnToCurrent` so Esc returns to the result list with memory restored, and the result list is captured as the `BillContext` (Phase 219) so PageUp / PageDown step through the found bills directly. (4) With the setting off or the model missing, the chips and structured filtering still work and the item part uses plain text search. (5) The old History search behaviour is unchanged for non-sentence input. (6) Tests: chips shown and editable, structured filter applied, re-rank used only when ready, fallback, Esc returns to the same result.
**Out of scope:** changing the History data model, Hindi words.
**Key files:** `src/renderer/components/history/SearchBox.tsx`, the palette components, `src/main/ipc/{history,ai}.ts`, `src/shared/ai/sentenceQuery.ts`, tests.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new search tests, the existing history search tests, `shortcuts.test.ts`, `importBoundaries.test.ts`. NO FULL TEST SUITE. Owner check (real Windows only): "ruby tomato to <a real party> last month" finds the right bills and the chips look right.

## Phase 230 — Settings > AI
**Goal:** One honest place to see and control the AI.
**Depends on:** Phases 224-229. Read `docs/MILESTONE22_DESIGN.md` section 10 first.
**In scope:** `src/renderer/components/settings/AiSection.tsx` (and the Settings section entry, action `settings.ai` in `shortcuts.ts`, cheat-sheet, tests): status with the plain reason, model name and size, the four switches (`ai.enabled` is the master), indexing progress with Pause / Resume, Rebuild index, Delete AI data (drops the cache, after a confirm), the privacy line ("Runs on this PC. Nothing leaves it."), a diagnostics line (model id, dimension, vector count, last embed ms) that `diagnostics.copy` includes; turning `ai.enabled` off stops the worker and hides every AI surface at once. Tests for each control and the off-state.
**Out of scope:** new AI features.
**Key files:** `src/renderer/components/settings/AiSection.tsx`, `src/renderer/pages/Settings.tsx`, `src/shared/shortcuts.ts`, `src/main/ipc/{ai,diagnostics}.ts`.
**Version:** no bump.
**How to verify:** typecheck once; ONLY the new Settings tests, `shortcuts.test.ts`, the diagnostics tests touched, `importBoundaries.test.ts`. NO FULL TEST SUITE.

## Phase 231 — Milestone 22 QA gate (release gate)
**Goal:** Check Phases 222-230 together, ship the release and hand over the owner's Windows checklist.
**Depends on:** 222-230 (or the subset the owner chose to ship; say so).
**In scope:** the typecheck once; ONLY the named test files of Phases 222-230 plus `shortcuts`, `routes`, `importBoundaries` and the migration / backup tests touched; confirm AI-off equals 0.1.49 behaviour by test (settings default off, no worker spawned, no panel, no Items badges, no chips beyond plain search); reconcile `PHASE_STATUS.md`, `PROJECT_STRUCTURE.md`, `API_CONTRACTS.md`, `THIRD_PARTY_AI.md` and `THIRD_PARTY.txt` (model, revision, licence), `DEPENDENCY_VERSIONS.md`, `GITHUB_UPDATE_PUSH.md` (the Action now fetches the model; say how the owner runs `tools/fetch-ai-model.mjs` for a local build); write `docs/M22_OWNER_CHECKLIST.md` UNFILLED (a table: run the bake-off on real item names and pick the model; fetch the model; install the packaged app on Windows; AI off = nothing changes; enable AI and watch indexing; the billing panel on a known party in GST and non-GST; the toggle key; the grid stays smooth with the panel on; Items "Suggested" accept and dismiss; sentence search; Settings > AI controls; the installer size and update download size; RAM use; offline start; startup time; what to send back if something is wrong: the diagnostics line and the log); bump 0.1.51 [A] (`package.json` + both spots at the top of `package-lock.json`) and hand back the changed-files zip, the full zip and the push steps with the tag `v0.1.51` [A].
**Out of scope:** new features.
**Key files:** docs, `docs/M22_OWNER_CHECKLIST.md`, `package.json` + both spots in `package-lock.json`.
**Version:** 0.1.51 (release gate [A]).
**How to verify:** typecheck once + the named test files green, or each failure listed with its cause (compare against the previous zip before calling anything a regression). NO FULL TEST SUITE unless the owner agrees; the real model, the packaged install and real speed are never written as "verified" from the sandbox.

## Phase 232 — Fix pack from the owner's report (only if needed)
**Goal:** Fix what the owner found on Windows: wrong or missing suggestions, thresholds too loose or too tight, a slow panel, install or model-load problems, a confusing chip.
**Depends on:** Phase 231 and the owner's filled `docs/M22_OWNER_CHECKLIST.md` (the diagnostics line, the log, example names that matched wrongly or were missed). Skip this phase if there is no report.
**In scope:** only what the report lists: retune the thresholds in `modelConfig.ts` from the owner's examples, swap the model id after the bake-off (the cache reindexes by itself), fix a load / packaging problem, tighten a protected-token rule, fix a panel or chip bug. Never loosen rules 2-4 of the design.
**Out of scope:** new features (OCR, smart paste, duplicate parties and voice are in the parking lot, design section 11).
**Key files:** only the listed ones, `PHASE_STATUS.md`.
**Version:** no bump by itself; the owner may ship it with the next release.
**How to verify:** typecheck once; the named tests of the touched code; NO FULL TEST SUITE.

## MILESTONE 23 — Price List, billing auto-rate, seat permissions, activity log, auto red-bold, case button (Phases 233–250)
**Planned 2026-11-12** (docs only). Design: `docs/MILESTONE23_DESIGN.md` (binding); legacy import: `docs/PRICELIST_IMPORT_SPEC.md`; rules: `CLAUDE_MUST_READ.md` section 10r. Renumber if Phase 188 ships 0.2.0 first.
**Exit criteria:** the owner can build a Price List of any shape (categories, tabs, per-tab columns, rows) and edit it with the bill grid's own keyboard feel, on desktop and phone; legacy data imports from `bills_data.db` (inventory tables only); in Create/Edit the rate fills itself on leaving an item cell (or shows only a compact strip, or is off), per format tier, never over a typed rate; seat 1 grants other seats Price List rights, enforced on the server; seat 1 alone can view who changed what; "by hand" turns red + bold by itself (toggle); a button turns item names UPPER/lower; with everything off the app behaves exactly as 0.1.52. Desktop and phone. Phase 188 and Phase 69 remain separate.
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

## Phase 233 — Auto red-bold phrases ("by hand")
**Goal:** Typing or pasting a configured phrase (default "by hand") anywhere in an item name turns exactly that text red + bold by itself. Toggleable, ON by default [A]. Independent of the Price List.
**Depends on:** Phase 232 state (0.1.52 zip). Design 4.6.
**In scope:** `shared/richtext/autoRedBold.ts` (pure; tests: start / middle / end, case-insensitive, whole word only, multiple spaces count as one, paste, idempotent, a manual "Clear formatting" on that range sticks, `when` modes); settings `bill.autoRedBold.{enabled,phrases,when}` (defaults `true`, `['by hand']`, `'word'` [A]) + zod schema + default tests; wiring into the item-name cell edit path as ONE undo step with the typing; Settings > Behaviour controls (editable phrase list). Saved bills are never rewritten on open. Phone wiring is Phase 247.
**Out of scope:** the Price List; any schema, sync, print or backup change; phone UI.
**Key files:** `src/shared/richtext/autoRedBold.ts` (+ test), `src/shared/richtext/runs.ts` (read), `src/shared/settings.ts`, the Create grid edit path, Settings Behaviour section, `API_CONTRACTS.md`, `PHASE_STATUS.md`.
**Version:** release 0.1.53 [A] (`package.json` + both spots in `package-lock.json`; follow `GITHUB_UPDATE_PUSH.md`).
**How to verify:** typecheck once; the new test, the `richtext` tests, settings default/schema tests, `gridEdit` / undo tests that could conflict, `shortcuts`, `importBoundaries`. NO FULL TEST SUITE.

## Phase 234 — Case button (UPPER / lower)
**Goal:** A button in the Create / Edit window turns the item names of the bill UPPER or lower (cycle), preserving bold / red / highlight runs. Independent of the Price List.
**Depends on:** Phase 233. Design 4.7.
**In scope:** `shared/richtext/caseTransform.ts` (run-preserving, Unicode-safe incl. length-changing cases like "ß"; tests); toolbar button in Create / Edit; registered action + shortcut + palette entry (must pass the shortcuts conflict test); scope = item-name column of all rows, selected rows when a range is selected [A]; Hybrid second table rows included [A]; ONE undo step; in History edit it is a normal edit and creates a revision. Other columns are never touched.
**Out of scope:** phone UI (Phases 245-248); Title Case beyond an optional extra mode.
**Key files:** `src/shared/richtext/caseTransform.ts` (+ test), `src/shared/shortcuts.ts`, `src/shared/shortcutList.ts`, Create toolbar, `API_CONTRACTS.md`, `PHASE_STATUS.md`.
**Version:** release 0.1.54 [A].
**How to verify:** typecheck; the new test, `shortcuts`, `hybrid` and the bill-edit tests touched. NO FULL TEST SUITE.

## Phase 235 — Price List foundations: contract, settings keys, shared pure core
**Goal:** All pure logic and contracts for the Price List, before any storage or UI.
**Depends on:** Phases 233-234 (or independent; no code dependency). Design 4.1-4.5, 4.8, 7.
**In scope:** `src/shared/pricelist/*` (`types`, `columns`, `tiers`, `structure`, `rows`, `bulk`, `match`, `autofill` state machine, `perms` diff → required flag, `logEntry`, `csv`), all unit tested with invented names; settings keys + zod schema + defaults (`pricelist.enabled`, `pricelist.billing.*`, `pricelist.log.*`, `pricelist.defaultColumns`); `API_CONTRACTS.md` M23-1..M23-6 finalised; docs tweaks found necessary.
**Out of scope:** storage, IPC, UI, sync.
**Key files:** `src/shared/pricelist/*`, `src/shared/settings.ts`, `API_CONTRACTS.md`, `DATA_MODEL.md`.
**Version:** no bump.
**How to verify:** only the new pure tests + settings tests + `importBoundaries`; typecheck once.

## Phase 236 — Desktop storage
**Goal:** The Price List persists on the desktop and can be read / written through IPC.
**Depends on:** Phase 235. Design 7.1, 7.4.
**In scope:** migration `0011_price_list.sql` (+ journal + Drizzle tables: `price_tiers`, `price_categories`, `price_tabs`, `price_rows`, `price_log`, `price_import_map`); repos (`priceListRepo`, `priceLogRepo`), service, zod IPC (`pricelist:*`), preload `window.quot3.pricelist.*`; trash / restore; the `wipeRules` decision (not cleared by Level 1 [A]; cleared by Level 2; separate "Clear Price List" with typed confirmation); local `price_log` (reuse `auditRepo` conventions); update the migration lists in `db.test.ts`, `itemRules.test.ts`, `syncRecords.test.ts` (they hard-code the migration count).
**Out of scope:** UI, import, sync, seat permissions.
**Key files:** `src/main/db/*`, `src/main/services/priceListService.ts`, `src/main/ipc/pricelist.ts`, preload, `src/shared/wipe/wipeRules.ts`, migrations folder.
**Version:** no bump (the release notes line becomes `schema: 12` at the gate).
**How to verify:** typecheck; the new repo / service tests, `db`, `itemRules`, `syncRecords`, `backupService`, `wipeRules` tests.

## Phase 237 — Legacy importer + preview
**Goal:** Import the legacy inventory (categories, tabs, items) into the Price List safely, with a preview first.
**Depends on:** Phase 236. Design 8; `docs/PRICELIST_IMPORT_SPEC.md`. The owner must attach `bills_data.db` for the real-run check.
**In scope:** importer per the spec with a SYNTHETIC fixture DB (invented names), read-only open, `inv_*` tables only; preview UI in Settings > Price List (writes nothing); `pre-import` backup first, ONE transaction, one log entry, normal write path (feeds the sync outbox later); re-run safety via `price_import_map`; a local optional script for the real-run check (never in tests).
**Out of scope:** the Price List page; phone import (the phone gets data by sync).
**Key files:** `src/main/services/priceListImportService.ts`, Settings Price List section, tests.
**Version:** no bump.
**How to verify:** the new importer tests + typecheck. The real `bills_data.db` is never in tests, logs or commits.

## Phase 238 — Desktop Price List page
**Goal:** The `/pricelist` page: categories, tabs, per-tab columns, rows, edited with the bill grid's own keyboard behaviour.
**Depends on:** Phases 235-236. Design 4.2; read `docs/reference/KEYBOARD_CELL_RULES.md` first.
**In scope:** page, grid reuse (`cellNav`, `gridEdit`, `gridModel`, `gridClip`, `moveRows` / `deleteRows`, `undoStack`, `columnWidths`), category side panel, tab strip (× and "+ Tab"), columns dialog, tiers editor, section rows, filters, autosave, shortcuts (registered; candidate keys pass the conflict test [A]), palette entries, `ROUTES` / `PREVIOUS_PAGES` / page-memory + `routes.test.ts` update quoted, Dashboard tile (stored `dash.tiles` without the key reads as default), Settings section "Price List" + the section-count test (17 → 18, say so), density ≥ 20 rows at 1366x768, theme tokens, Phosphor, no emoji.
**Out of scope:** bulk tools, search, export (239); billing (240).
**Key files:** `src/renderer/pages/PriceList.tsx`, `src/renderer/components/pricelist/*`, `src/renderer/stores/priceListStore.ts`, `src/shared/shortcuts.ts`, routes, `src/shared/dashboard/live.ts`.
**Version:** no bump.
**How to verify:** typecheck; the new page / store tests, `shortcuts`, `routes`, `keyboardAcceptance` (compare to baseline), the settings page test (compare to baseline).

## Phase 239 — Bulk tools, search, export/share
**Goal:** The Price List power tools.
**Depends on:** Phase 238. Design 4.2 operations.
**In scope:** bulk adjust (+%, +amount; column / selection / tab / category) with preview + undo; "fill column from another column by %" (ONE-TIME action, not a live formula); find & replace; name clean-up; global search with jump-to-cell; "no price" and "contains" filters; CSV export; share as image / PDF via the existing pipeline; duplicate warning while typing (safe matcher).
**Out of scope:** live formulas; billing.
**Key files:** `src/shared/pricelist/bulk.ts`, `csv.ts`, page components.
**Version:** no bump.
**How to verify:** the new tests + typecheck.

## Phase 240 — Billing integration
**Goal:** In Create / Edit, the Rate cell fills itself from the Price List (or a compact strip only shows the match, or the feature is off).
**Depends on:** Phases 235-236 (data), 238 recommended. Design 4.3.
**In scope:** the whole of 4.3: `PriceStrip` component + store with debounce and stale-answer guard like `aiPanelStore`; auto-fill on cell-leave via passive listeners like the M22 panel; never on keystrokes, never when opening a saved bill, never over a hand-typed rate; per-row state `{ rateTouched, autoFilledValue, autoFilledForNameKey }`; re-fill rule; 3 modes (Off / Suggest / Auto, default Auto [A]); one fill = ONE undo step; format → tier mapping from the registry (data, never a format name); Hybrid sides each use their own mapping; stock transfer does nothing; no auto-fill for pasted rows [A]; settings UI; free toggle key [A]. Measure grid latency before/after on an 80-row bill (rule 5.6) and record it; never claim the budget without a measurement.
**Out of scope:** customer tier (parked); AI; phone UI (Phases 245-248).
**Key files:** `src/renderer/components/create/PriceStrip.tsx`, `src/renderer/stores/priceStripStore.ts`, `src/shared/pricelist/{match,autofill}.ts`, `src/shared/shortcuts.ts`.
**Version:** no bump.
**How to verify:** typecheck; new tests (invented names only), `gridEdit`, `shortcuts`, `importBoundaries`, the Create component tests touched.

## Phase 241 — Supabase `18_price_list.sql` + desktop sync
**Goal:** The four kinds sync between PCs through the shared notebook.
**Depends on:** Phases 236, 238. Design 7.2-7.3; copy the `item_rule` path.
**In scope:** `supabase/sql/18_price_list.sql` (NEVER RUN from the sandbox): extend the kind CHECKs on `sn_records` / `sn_history`, replace the RPC kind lists (`drop function` first where arguments change); static SQL tests; desktop applier / push / pull for `price_tier`, `price_category`, `price_tab`, `price_row`; aside / `min_reader_ver` behaviour; simulation harness cases; checklist G in `docs/SUPABASE_MIGRATIONS.md`.
**Out of scope:** permissions and log.
**Key files:** `supabase/sql/18_price_list.sql`, `src/main/sync/priceListApplier.ts`, `recordApplierV2.ts`, `pushWorkerV2.ts`, `pullWorkerV2.ts`, `src/__tests__/supabaseSql.test.ts`.
**Version:** no bump.
**How to verify:** `supabaseSql`, `applyV2`, an `itemRuleSync`-style new test, `syncRecords`, `simHarness` users.

## Phase 242 — Seat permissions
**Goal:** Seat 1 decides who may edit the Price List; enforced on the server.
**Depends on:** Phase 241. Design 4.4.
**In scope:** flags `add / edit / overwrite / delete / structure`; server check inside the push RPC; `sn_price_perms`, `qt_price_perms_get / list / set`; error codes `Q3P01 not_allowed`, `Q3P02 seat1_only` with plain-words messages; aside on refusal / revoke; seat-1-only UI "Who can edit"; local read-only states in the Price List UI; no sync = full rights; verify `seat_no` exposure (add as a masked non-secret field if missing).
**Out of scope:** the activity log (243).
**Key files:** `supabase/sql` (new numbered file only if 18 was already run), `src/shared/pricelist/perms.ts`, Settings Price List section.
**Version:** no bump.
**How to verify:** new tests + `supabaseSql` + typecheck.

## Phase 243 — Activity log (seat 1 only)
**Goal:** Seat 1 can see who added / edited what in the Price List, when toggled on.
**Depends on:** Phase 242. Design 4.5.
**In scope:** server-side log written inside the push RPC; `qt_price_log_list` (seat 1 only); Settings > Price List > Activity visible only on seat 1 and only when `pricelist.log.visible` is on; retention (365 days [A]); CSV export [A]; local log for no-sync PCs (that PC counts as main [A]).
**Out of scope:** phone viewing of the log (desktop only in M23 [A]).
**Key files:** `src/main/db/priceLogRepo.ts`, `src/shared/pricelist/logEntry.ts`, Settings.
**Version:** no bump.
**How to verify:** new tests + `supabaseSql`.

## Phase 244 — Phone data layer
**Goal:** The phone stores and syncs the Price List.
**Depends on:** Phase 241. Design 4.9.
**In scope:** a NEW IndexedDB upgrade step (never edit step 1): `price_categories`, `price_tabs`, `price_rows`, `price_tiers`; repo; sync encode / decode / apply / outbox / first-sync for the four kinds; backup `STORE_NAMES` + `newer-backup` handling; tests under `src/pwa/__tests__`. Phone code never imports Electron, better-sqlite3 or main.
**Out of scope:** phone UI (Phases 245-248).
**Key files:** `src/pwa/data/db.ts`, `src/pwa/data/priceListRepo.ts`, `src/pwa/sync/*`.
**Version:** no bump.
**How to verify:** the named pwa tests + `importBoundaries` + `classicParity` (must stay green; snapshot untouched).

## Phase 245 — Phone Price List: browse + search (read-only)
**Goal:** The phone can open the Price List and find a price, in all three new layouts. Nothing can be changed yet.
**Depends on:** Phase 244 (data layer; Phase 245 was split on 2026-11-13 because one phase was too big for one session: 245 browse, 246 editing, 247 bill features, 248 hardening).
**In scope:** Dashboard entry (the bottom nav keeps exactly 5 tabs) to a Price List screen in `tidy` / `guided` / `inbox` via NEW files only: categories, then tabs, then rows with the tab's own columns and tier columns; search box (deterministic matching, not AI: say so in 10r; reuses `shared/pricelist/search.ts` / `match.ts`); a phone read model that turns `priceListRepo` records into the shared grid model (read only); the seat's rights shown with `rightsNotice` (a phone with no rights is "Read only"; reading is always allowed); empty state when nothing has synced yet ("Price List not on this phone yet", with the sync state in plain words); phone settings mirrors in `src/pwa/data/settingsRepo.ts` (the `pricelist.*` keys the phone needs to READ; none written by the phone yet); names / amounts never truncated (M18 rule); tokens only, no emoji, Phosphor icons only.
**Out of scope:** any edit (Phase 246); the bill editor features (Phase 247); first-sync / status polish (Phase 248); Classic layout changes; column design, bulk and paste (desktop-only [A]); AI.
**Key files:** `src/pwa/ui/layouts/*` (new files), `src/pwa/ui/kit/*` (new files), `src/pwa/data/priceListRepo.ts` (read helpers only if needed), `src/pwa/data/settingsRepo.ts`.
**Version:** no bump.
**How to verify:** new pwa tests (read model, search, empty state, three layouts render the same data, no truncation helper used on names / amounts) + `classicParity` (snapshot untouched), `importBoundaries`, `layoutRegistry`; typecheck once.

## Phase 246 — Phone Price List: editing
**Goal:** The phone can change the Price List, only as far as the seat's flags allow.
**Depends on:** Phase 245.
**In scope:** edit a cell (fill an empty price = `edit`, change an existing price = `overwrite`), add an item (`add`), add / rename a tab or category (`structure`), delete an item (`delete`) with the trash rule of the desktop (soft delete, tombstone), all through `savePriceRecord` / `softDeletePrice` with `withPriceOutbox` so every change is queued and pushed; the flags come from the same seat rights as the desktop (`effectiveFlags`, cached last server answer, none cached = no rights until the first answer [A]); controls the seat may not use are disabled with the plain-words reason (`notAllowedText`); the phone keeps its own small kept-list of refused changes (`pricelist.refused` equivalent in `meta` / `sync_state`, ids and missing rights only, never content) and shows the same note as the desktop; push kick after a save; unsaved-edit safety (draft survives a closed tab, one writer tab rule); names / amounts never truncated; Classic untouched.
**Out of scope:** column design, price levels, bulk tools, Excel paste, import, export (desktop-only [A]); bill features (247); sync status polish (248).
**Key files:** new files under `src/pwa/ui/layouts/*` and `src/pwa/ui/kit/*`, `src/pwa/data/priceListRepo.ts`, a small `src/pwa/data/priceRights.ts` (pure, shared rule from `shared/pricelist/perms.ts`).
**Version:** no bump.
**How to verify:** new pwa tests (each flag allowed / refused for each control, edit queues exactly one outbox row, refused push is settled and listed without content, two phones converge with the PC by the Phase 244 harness) + `classicParity`, `importBoundaries`, `priceListData244`; typecheck once.

## Phase 247 — Phone bill features: "by hand", case button, price strip + auto-fill
**Goal:** The three bill features from Phases 233, 234 and 240 work in the phone's new layouts.
**Depends on:** Phases 233, 234, 240, 245 (the strip and auto-fill read the phone Price List; 246 is not needed).
**In scope:** "by hand" auto red-bold in the new layouts' bill editor (shared `autoRedBold` function; Phase 233 wired the desktop only); the UPPER / lower case button (shared function of Phase 234); the price strip and auto-fill in `suggest` / `auto` / `off` modes using the shared deterministic matching and the format-tier rule (GST and non-GST); the phone mirrors of the settings (`bill.autoRedBold.*`, case button, `pricelist.billing.*`) in `src/pwa/data/settingsRepo.ts` and its settings screen rows; an auto-filled value is only written into an empty cell and is shown as a suggestion in `suggest` mode; names / amounts never truncated; Classic untouched.
**Out of scope:** any Price List edit screen (246); Classic bill editor; AI; a rate the person typed is never overwritten.
**Key files:** new files under `src/pwa/ui/layouts/*` and `src/pwa/ui/kit/*`, `src/pwa/data/settingsRepo.ts`, `src/shared/richtext/autoRedBold.ts` and `src/shared/pricelist/billing.ts` (read only; additive changes only if unavoidable).
**Version:** no bump.
**How to verify:** new pwa tests (by hand on type / paste, case button on a selection and on a whole row, strip and auto-fill in each mode and both formats, typed rate never overwritten, settings mirrors) + `classicParity`, `importBoundaries`, the existing editor tests of the three layouts; typecheck once.

## Phase 248 — Phone sync UX and hardening
**Goal:** The phone's Price List sync is understandable and safe on a real phone, and the three layouts behave the same.
**Depends on:** Phases 244-247.
**In scope:** the Price List in the phone's sync status and first-sync screens in plain words (counts, size note, "this server has no Price List yet" when file 18 has not been run); what the phone does when the seat's rights are revoked while offline (the next push is refused, the local change stays and is flagged, no crash, no silent loss); storage size note and backup / restore with the four stores (`format_version` 2; a v1 file still imports); a parity sweep over `tidy`, `guided` and `inbox` (same data, same disabled states, same words, no truncated names / amounts, keyboard-free touch targets per the M18 rules); the Classic decision recorded in `PHASE_STATUS.md` (still untouched unless the owner approved).
**Out of scope:** new features; Classic layout changes unless the owner approved; anything on a real Supabase or real phone (written as NOT verified).
**Key files:** `src/pwa/sync/*`, `src/pwa/ui/*` (new files), `src/pwa/data/backup.ts` (only if a gap shows).
**Version:** no bump.
**How to verify:** new pwa tests for the cases above + `classicParity`, `importBoundaries`, `syncPushPull`, `priceListData244`; typecheck once.

## Phase 249 — Milestone 23 QA gate (release gate)
**Goal:** Close M23: reconcile docs, write the owner checklist, release.
**Depends on:** Phases 233-248.
**In scope:** typecheck once + the named test files of 233-248; reconcile `PHASE_STATUS.md`, `PROJECT_STRUCTURE.md`, `API_CONTRACTS.md`, `DATA_MODEL.md`, `GITHUB_UPDATE_PUSH.md` (schema 12, Supabase file 18); write `docs/M23_OWNER_CHECKLIST.md` UNFILLED (desktop import, page feel, auto-fill in GST and non-GST, strip mode, off mode, permissions with two seats incl. a phone, log visible only on seat 1, offline revoke, "by hand", case button, grid smoothness measured on a real PC, Supabase checklist G, real Android); bump to 0.1.55 [A] in `package.json` + both spots in `package-lock.json`; hand back changed-files zip + full zip + push steps with the tag. AI-off / Price-List-off = 0.1.52 behaviour, by test.
**Out of scope:** new features.
**Key files:** the docs above, `package.json`, `package-lock.json`.
**Version:** 0.1.55 (release gate [A]).
**How to verify:** typecheck once + the named test files green, or each failure listed with its cause (compare against the previous zip). NO FULL TEST SUITE unless the owner agrees; real Windows / Android / Supabase never written as "verified".

## Phase 250 — Fix pack from the owner's report (only if needed)
**Goal:** Fix what the owner found when testing M23.
**Depends on:** Phase 249 and the owner's filled `docs/M23_OWNER_CHECKLIST.md`. Skip this phase if there is no report.
**In scope:** only what the report lists. Never loosen the rules of section 10r.
**Out of scope:** new features.
**Key files:** only the listed ones, `PHASE_STATUS.md`.
**Version:** no bump by itself; the owner may ship it with the next release.
**How to verify:** typecheck once; the named tests of the touched code; NO FULL TEST SUITE.



## MILESTONE 24 — Master Supabase, one-code onboarding, Seat-1 admin, company profile, quick fixes (Phases 251–274)
**Planned 2026-11-13** (docs only). Design: `docs/MILESTONE24_DESIGN.md` (binding); rules: `CLAUDE_MUST_READ.md` section 10s and the "ONE PHASE PER SESSION" block at its top. Phase 188 and Phase 69 remain separate.
**Exit criteria:** (1) the Dashboard, Price List page, phone Price List and AI-off behaviour are fixed as listed; (2) a seat other than seat 1 can edit the Price List when seat 1 grants it, and changes reach live devices; (3) a master Supabase project holds the company registry; (4) a new phone/PC needs ONE code and then syncs everything; (5) seat 1, from the desktop, creates up to 15 seats and deletes / resets / renames them and regenerates codes with no hand-run SQL; (6) devices already logged in keep working and adopt the master silently; (7) every device inherits the company logo, name, contact number and address from seat 1 and may override them; (8) with the master unused the app behaves exactly as 0.1.55.
**Standing rules for every Phase 251-274:** section 10s; **ONE PHASE = ONE FREE SESSION** (read only the listed files, touch only the listed files, stop at a step boundary if the session runs short); edits to shared files small and additive, tests updated not deleted; contract first in `API_CONTRACTS.md`; NO FULL TEST SUITE; list what you ran and did NOT run; [A] items stated; Phase 92 selector rule; tokens only; Phosphor only; no emoji; real Windows / Android / Supabase never "verified". Types: **[E]** code, **[D]** decision/spec (docs only, no code, no typecheck), **[G]** release gate.

| # | Type | Title | Version |
|---|---|---|---|
| 251 | E | Desktop Dashboard: five tiles in one row, Today+This month combined, second (monthly) graph | no bump |
| 252 | E | Desktop Price List page: remove the tab filter box, one overall search in its place, fix the focus-jump bug | no bump |
| 253 | E | Phone Price List: price columns stacked one under another (all three layouts) | no bump |
| 254 | E | AI default OFF everywhere; hide the Create-page AI switch (and the billing price strip [A]) while AI is off | no bump |
| 255 | E | Price rights A: find the real cause, show the rights state, refresh on start / sync / refusal (client only) | no bump |
| 256 | E | Price rights B: server doorbell on rights save (new SQL file 21), clear refusal wording, RELEASE A | release 0.1.56 [A] |
| 257 | D | Master contract freeze (docs only): tables, function shapes, errors, compatibility matrix | no bump |
| 258 | E | Master SQL: `supabase/master/M01..` tables, RLS, static test | no bump |
| 259 | E | Master shared pure core: seat code + check char, bundle and request schemas, sealing helpers, redaction | no bump |
| 260 | E | Master Edge Functions A (client): redeem, adopt, refresh, heartbeat, profile-get | no bump |
| 261 | E | Master Edge Functions B (admin, seat 1 only): seat-list, seat-create, seat-reset, seat-revoke, seat-rename, seat-regen, profile-set | no bump |
| 262 | E | Owner tooling: onboard / enrol-token / export / keep-alive CLI + `docs/MASTER_OWNER_SETUP.md` | no bump |
| 263 | E | Desktop master client service + IPC + secret-store keys (no UI) | no bump |
| 264 | E | Desktop "Link to master" wizard + silent adopt of this PC | no bump |
| 265 | E | Desktop Settings > Company seats A: list, create (max 15), show / copy code | no bump |
| 266 | E | Desktop Company seats B: reset, delete, regenerate code, rename label, inline Price List rights | no bump |
| 267 | E | Desktop silent re-credential (auth_failed -> master refresh -> sign in again) | no bump |
| 268 | E | Phone master client + redeem + vault write (no UI) | no bump |
| 269 | E | Phone one-field first-launch screen + silent re-credential + "Advanced" old form | no bump |
| 270 | E | Company profile A: pure model, local override rules, desktop settings sync (seat 1 edits, others inherit) | no bump |
| 271 | E | Company profile B: desktop print / bill header / image use the effective profile | no bump |
| 272 | E | Company profile C: phone fetch + use | no bump |
| 273 | G | Milestone 24 QA gate (release gate) + `docs/M24_OWNER_CHECKLIST.md` | 0.1.57 [A] |
| 274 | E | Fix pack from the owner's report (only if needed) | no bump |

**Order:** 251-254 any order and any time (independent). 255 → 256. 257 → 258 → 259 → 260 → 261 → 262 (260-261 need 258 and 259). 263 needs 259 and 257 (not the live server). 264 → 265 → 266 → 267 need 263. 268 → 269 need 259 and 263's shapes. 270 → 271 → 272 need 260-261 shapes (profile) and 265. 273 last. A phase that finds its dependency missing STOPS and says so.

## Phase 251 — Desktop Dashboard: five tiles in one row [E]
**Goal:** The Dashboard stats are compact: ONE row of five tiles, no dead space.
**Depends on:** 0.1.55 zip. Design 1 item 6.
**In scope:** (a) tile row: [Today + This month in ONE tile (two figures, bill counts)] [Last 7 days graph + a second small monthly graph in the same tile (last 6 or 12 months, reuse the existing stats source; if no monthly series exists add the smallest pure function in `shared/dashboard`)] [Recent bills] [Top customers] [Last backup + sync status]; (b) CSS in the existing dashboard styles: equal-height tiles in one row, wraps below ~1100 px only, tile height follows content (no big empty areas), tokens only, text never truncates ugly (rule 5.7); (c) keep the four quick-entry cards, Enter-opens-bill and Tab order (cards, Recent bills, Top customers), focus-refresh and all existing test ids. Update the existing dashboard tests, never delete.
**Out of scope:** any data/sync/IPC change except the one pure monthly series if missing; other pages.
**Key files (read only these):** `src/renderer/pages/Dashboard.tsx`, `components/dashboard/{TodayTiles,StatTile,Sparkline,DashList}.tsx`, dashboard CSS, `shared/dashboard/dashboardStats.ts`, `stores/dashboardStore.ts`, the dashboard tests.
**Version:** no bump. **How to verify:** typecheck once; the dashboard store / stats / page tests; `shortcuts`; `importBoundaries`. NO FULL SUITE. Layout on a real window is an owner check.

## Phase 252 — Desktop Price List page: one search [E]
**Goal:** Remove the per-tab filter box; the page's search is the overall ("Search all") search, and typing never loses focus.
**Depends on:** 0.1.55 zip.
**In scope:** (a) reproduce the bug in a test first: after one typed letter the box loses focus and the first grid row becomes active (look at `ports.focusGrid`, `focusTick` and what `setFilter` triggers in `priceListStore.ts` / `PriceList.tsx` lines ~40-115); (b) remove the "Filter this tab" input safely: keep `filter` state only if other code needs it, remove its shortcut / palette entry cleanly (`shared/shortcuts.ts` + `FILTER_OK`), leave nothing dangling; (c) put the overall search input in the same toolbar spot (inline box, results list under it or reuse `SearchDialog`'s engine `shared/pricelist/search.ts`), Enter/ArrowDown moves into results, Esc clears, Ctrl+K-style key stays what `pricelist.search` already is; (d) the focus fix is covered by a test that types several letters and keeps focus.
**Out of scope:** Price List data, sync, rights, bulk tools, billing strip.
**Key files:** `src/renderer/pages/PriceList.tsx`, `stores/priceListStore.ts`, `components/pricelist/{ToolsDialogs,PriceGrid}.tsx`, `shared/pricelist/search.ts`, `shared/shortcuts.ts`, the price list store / tools tests.
**Version:** no bump. **How to verify:** typecheck once; `priceListStore238`, `priceListTools239`, `search239`, `shortcuts`, `keyboardAcceptance` (only compare to the 2 known failures), `importBoundaries`.

## Phase 253 — Phone Price List: stacked price columns [E]
**Goal:** In the phone Price List each item shows its prices one under another (label: value per line), not side by side.
**Depends on:** 0.1.55 zip. The classic layout and its pinned files are NOT touched (10r).
**In scope:** (a) find where an item's tier/price cells are laid out in the shared kit (`src/pwa/ui/kit/PriceListParts.tsx`, `PriceEditParts.tsx`, model `priceListModel.ts`) and in the three layouts' own CSS; (b) change to a compact vertical list, label left / amount right, same Indian grouping, no truncation helper, touch targets >= `--touch-min`; (c) the edit controls follow the same stacking; (d) update the existing parity tests (three layouts still show the same names and amounts).
**Out of scope:** data, sync, rights, classic layout.
**Key files:** the kit files above, `src/pwa/ui/layouts/{tidy,guided,inbox}/*PriceList*`, `src/pwa/__tests__/{priceListScreens245,priceSync248,priceListEditUi246}.test.ts`.
**Version:** no bump. **How to verify:** typecheck once; those three tests + `classicParity`. Real phone look is an owner check.

## Phase 254 — AI default OFF and hidden when off [E]
**Goal:** AI is OFF for every app by default; while it is off the Create-page AI switch (and the billing price strip [A]) are not shown.
**Depends on:** 0.1.55 zip. Design 1 item 6, open question 5.
**In scope:** (a) confirm by test that `AI_DEFAULTS` keep every key false and a fresh settings store gives AI off (they already do: only add the missing assertion); (b) `AiPanelSwitch` and the AI history panel render nothing when `ai.enabled` is false (the Phase 226 note "switch always visible" is superseded here; turning the panel on while the master is off no longer auto-enables the master); (c) the price strip in billing (`priceStripStore`, Create bottom area) is hidden while AI is off [A, owner to confirm: if he says the strip is independent of AI, skip this step and say so]; (d) existing installs keep whatever they set; nothing is force-reset; (e) update `aiOffGate231`-style tests to the new rule.
**Out of scope:** the AI engine, model, indexer, Settings > AI layout.
**Key files:** `src/shared/ai/aiSettings.ts`, `renderer/stores/{aiPanelStore,priceStripStore}.ts`, `components/create/{AiHistoryPanel,AiPanelSwitch?}.tsx` (find the switch with grep), `components/settings/AiSection.tsx`, the two `aiOffGate231` tests, `aiHistoryPanel226` test.
**Version:** no bump. **How to verify:** typecheck once; `aiSettings`, `aiPanelStore226`, `aiHistoryPanel226`, both `aiOffGate231`, `priceStripStore240`, `billing240`, `importBoundaries`.

## Phase 255 — Price rights A: find, show, refresh (client only) [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md). Next: Phase 256.**
**Goal:** Find why another seat cannot edit although seat 1 shows "granted", make the seat's real state visible, and make the client re-read its rights at the right moments.
**Depends on:** 0.1.55 zip. Design section 2 (price rights).
**In scope:** (a) **Diagnose first** (write the finding at the top of the phase log): trace a seat-2 edit end to end in the existing in-memory sim (`src/main/sync/__tests__/sharedSim.ts`): `setPricePerms` -> cache -> `own()` -> `priceListService` guard -> push `refused`; and the phone path (`runtime.refreshPriceRights`, `pwa/data/priceRights.ts`). Check specifically: refresh is never called on start / sync; `own()` returns none when `cached.seatNo !== seat`; errors swallowed; the `overwrite` vs `edit` flag mapping; whether `connect()` can return a transport without `pricePermsGet`. Add a failing test for what you find. (b) a "Rights" status block in Settings > Price List (desktop) and the phone sync status: seat number, flags cached, when last checked, last error in plain words, a "Check again" button (desktop already has one: extend). (c) refresh triggers: app start (after sync is active), after each sync cycle (throttled 60 s), after any `refused` push outcome, when the Price List page opens (existing). (d) a failed refresh keeps the last good flags and RECORDS the error (no more silent info log). (e) never grant locally; the server stays the gate.
**Out of scope:** SQL (Phase 256), the master, UI redesign.
**Key files:** `src/main/services/priceRightsService.ts`, `main/index.ts` (the wiring near line 463), `main/sync/{pushWorkerV2,sharedSyncService}.ts` (only the hook points), `renderer/stores/priceRightsStore.ts`, `components/settings/{PriceRightsSettings,PriceListSection}.tsx`, `src/pwa/sync/runtime.ts`, `pwa/data/priceRights.ts`, `pwa/ui/priceSyncStatus.ts`, `shared/pricelist/perms.ts`, `sharedSim.ts`, tests `priceRights242` (both), `priceRightsStore242`, `priceSync248`.
**Version:** no bump. **How to verify:** typecheck once; the named tests; NO FULL SUITE. If the cause turns out to be SQL-side, write it down and let 256 fix it.

## Phase 256 — Price rights B: doorbell + wording + RELEASE A [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md). Release A = 0.1.56 [A], to be pushed and tagged by the owner. Next: Phase 257 [D].**
**Goal:** Changing a seat's rights reaches live devices at once, and a refusal says exactly what is missing. Then release.
**Depends on:** 255 (its finding).
**In scope:** (a) NEW `supabase/sql/21_price_perms_bell.sql` (never edit 19/20): `qt_price_perms_set` additionally touches `sn_ping` for the organisation exactly like `sn_push` does (read how at `15_rpcs.sql` near the end of `sn_push`), safe to re-run, header says "NEVER RUN from the sandbox", add it to `docs/SUPABASE_MIGRATIONS.md` and to the static test `src/__tests__/supabaseSql.test.ts`; (b) the desktop and phone doorbell handlers re-read rights when a ring arrives (reuse the Phase 255 refresh); (c) refusal text names the flag: "needs Overwrite", "needs Add", "needs Edit", "needs Delete", "needs Structure" (pure words in `shared/pricelist/perms.ts`, used by desktop and phone); (d) any extra fix found in 255; (e) **Release A:** bump to 0.1.56 [A] in `package.json` + both spots of `package-lock.json`, update `GITHUB_UPDATE_PUSH.md` (new section 11a: Supabase file 21 first, then push + tag `v0.1.56`), hand back changed-files zip + full zip + push steps.
**Out of scope:** the master.
**Key files:** `supabase/sql/{15,19}*.sql` (read), NEW `21_*.sql`, `docs/SUPABASE_MIGRATIONS.md`, `src/__tests__/supabaseSql.test.ts`, `shared/pricelist/perms.ts`, desktop doorbell consumer in `main/sync/` (`doorbell.ts`), `pwa/sync/doorbell.ts`, `package.json`, `package-lock.json`.
**Version:** release 0.1.56 [A]. **How to verify:** typecheck once; `supabaseSql`, `perms242`, both `priceRights242`, `priceSync248`; real Supabase = owner checklist, not claimed.

## Phase 257 — Master contract freeze [D]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; the frozen block is `API_CONTRACTS.md` M24-0). Next: Phase 258.**
**Goal:** Turn `docs/MILESTONE24_DESIGN.md` into frozen exact shapes so no later phase has to decide anything. **DOCS ONLY: no code, no typecheck, no tests.**
**Depends on:** the owner's answers to design section 11 if he gave them (otherwise the bracketed defaults are adopted and logged as [A]).
**In scope:** (a) write the "Milestone 24 — master contract" section in `API_CONTRACTS.md`: every Edge Function (URL path, headers, request JSON, response JSON, error codes `Q3M*` list with plain-words messages, idempotency, rate limits) for redeem, adopt, refresh, heartbeat, profile-get, profile-set, seat-list, seat-create, seat-reset, seat-revoke, seat-rename, seat-regen, enrol; (b) the exact table DDL (columns, types, checks) as a spec block for 258; (c) the seat code format + check-character algorithm as a worked example with 5 sample codes (invented); (d) the bundle JSON and the vault / secret-store field mapping for desktop and phone; (e) the compatibility matrix of design section 7 as numbered test cases T1..Tn that the later phases must automate; (f) the exact desktop IPC channels and phone runtime methods (names only) for 263 / 268 / 269; (g) list for each later phase which contract lines it implements.
**Out of scope:** everything that is code.
**Key files:** `docs/MILESTONE24_DESIGN.md`, `API_CONTRACTS.md` (append), `PHASE_STATUS.md`.
**Version:** no bump. **How to verify:** re-read: every function used in design section 6 has a frozen shape; every error has words; every later phase lists its contract lines.

## Phase 258 — Master SQL [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md). Next: Phase 259.**
**Goal:** The master's database, as numbered SQL files in a separate folder.
**Depends on:** 257.
**In scope:** `supabase/master/M01_tables.sql` (the tables of design 4 exactly as frozen in 257), `M02_rls.sql` (RLS on, no policies, revoke), `M03_helpers.sql` (attempt counter, token hashing is done in functions so keep SQL minimal), safe to re-run, header "NEVER RUN from the sandbox"; a static test `src/__tests__/masterSql258.test.ts` in the style of `supabaseSql.test.ts` (every table has RLS and a `revoke`, no policy, no `grant ... to anon`, seat check 1..15, `max_seats` check). `docs/SUPABASE_MIGRATIONS.md` gets a short "Master project" section.
**Out of scope:** functions, clients.
**Key files:** `src/__tests__/supabaseSql.test.ts` (style only), `docs/SUPABASE_MIGRATIONS.md`, `API_CONTRACTS.md` (the spec block).
**Version:** no bump. **How to verify:** typecheck once; `masterSql258` + `supabaseSql`.

## Phase 259 — Master shared pure core [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md). Next: Phase 260.**
**Goal:** All master logic that has no I/O, shared by desktop, phone and the Edge Functions, fully tested.
**Depends on:** 257.
**In scope:** NEW `src/shared/master/` : `seatCode.ts` (generate from random bytes passed in, normalise, validate, check character), `schemas.ts` (zod schemas for every request / response / bundle / profile from 257), `errors.ts` (`Q3M*` codes -> plain words), `redact.ts` (strip codes, passwords, tokens, `*_enc` from any object / string for logs and diagnostics), `seal.ts` (AES-GCM seal / open using WebCrypto `crypto.subtle`, key passed in; works in Node 22, browsers and Deno), `profile.ts` is Phase 270 (not here). Tests for each: the 5 worked sample codes of 257, typo detection, wrong-version bundle refused, redaction of nested data, seal round trip + tamper fails. No Electron / Node-only import (it runs in the PWA and Deno).
**Out of scope:** network calls, UI.
**Key files:** `API_CONTRACTS.md` (the master section), `src/shared/sync/license.ts` (style), `src/__tests__/importBoundaries.test.ts`.
**Version:** no bump. **How to verify:** typecheck once; the new tests; `importBoundaries`.

## Phase 260 — Master Edge Functions A (client side) [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md). Next: Phase 261.**
**Goal:** The functions every device uses: redeem, adopt, refresh, heartbeat, profile-get.
**Depends on:** 258, 259.
**In scope:** `supabase/master/functions/{redeem,adopt,refresh,heartbeat,profile-get}/index.ts` (Deno) + `_shared/` (db client with the master service role, `MASTER_KEK` loader, rate limit, device-token check, CORS for the PWA origin from an env value, logging through `redact`). Logic per design 6: redeem (code -> bundle + new device row), adopt (verify the device's company session against the company project, map to seat, issue token, never changes a password), refresh (device token -> current credentials of THAT seat), heartbeat (device token -> `profile_version`, status of seat / company, `last_seen_at`), profile-get. Unit tests run the handlers (plain exported functions taking `Request` + injected deps) against an in-memory fake master and a fake company project (`src/__tests__/master/` or `supabase/master/functions/__tests__/`, runnable by vitest); cover test cases T1..T8 of 257.
**Out of scope:** admin functions, clients, deploy.
**Key files:** `supabase/master/M0*.sql`, `src/shared/master/*`, `API_CONTRACTS.md`.
**Version:** no bump. **How to verify:** typecheck once; the new handler tests; nothing deployed or run on real Supabase.

## Phase 261 — Master Edge Functions B (seat admin) [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; contract block M24-G in `API_CONTRACTS.md`). Next: Phase 262.**
**Goal:** Seat 1's admin actions, enforced on the master.
**Depends on:** 260.
**In scope:** `functions/{seat-list,seat-create,seat-reset,seat-revoke,seat-rename,seat-regen,profile-set,enrol}/index.ts`: each requires a valid device token with `seat_no = 1` of an `active` company (else `Q3M05 admin_only`); drives the company through its owner functions by PostgREST with the sealed service_role key (`qt_add_seats`, `qt_reset_seat`, `qt_revoke_seat`); enforces `max_seats` (15) before creating; seals returned passwords; marks `legacy=false` on first reset; seat 1 can never be revoked or reset through the app (it is only reset by the owner CLI); `profile-set` validates sizes / logo <= 150 KB and bumps `profile_version`; `enrol` (owner-minted token + seat 1 session + service_role key + label -> register company, all legacy seats recorded). Tests with the same fakes; cover T9..T20 of 257 (cap 15, not seat 1 -> refused, reset ends old password, revoke, regen kills old code, profile version bump, enrol token one-use).
**Out of scope:** clients, CLI, deploy.
**Key files:** `functions/_shared/*`, `src/shared/master/*`, `supabase/sql/14_license_admin.sql` (read the signatures only).
**Version:** no bump. **How to verify:** typecheck once; the new tests.

## Phase 262 — Owner tooling [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; contract block M24-H in `API_CONTRACTS.md`). Next: Phase 263.**
**Goal:** The owner can stand up the master and onboard / link companies without writing SQL.
**Depends on:** 258-261.
**In scope:** `tools/master-cli.mjs` (+ `.d.mts`): `init` (prints the exact deploy steps and the secrets to set: `MASTER_KEK` generation), `enrol-token <label>`, `onboard <label> <seats> --url --anon --service-role` (stores the company, runs `supabase/sql/11..21` via the Supabase Management / SQL endpoint if a token is given, otherwise prints "paste these files in order" with the file list, calls `qt_create_org`, prints the Seat-1 code), `export` (companies + seats minus secrets to a JSON the owner backs up), `keepalive` (one harmless request; docs show a free GitHub Actions cron that calls it daily; add `.github/workflows/master-keepalive.yml`). NEW `docs/MASTER_OWNER_SETUP.md` (step by step, 2FA on the Supabase account, "sign-ups OFF", deploy functions, set secrets, first company, link an existing company, backups, what to do if the master is paused). Tests only for the pure helpers (argument parsing, file ordering, secret redaction in CLI output).
**Out of scope:** running anything against a real Supabase.
**Key files:** `tools/` (style from `tools/fetch-ai-model.mjs`), `.github/workflows/` (style), `docs/SUPABASE_MIGRATIONS.md`.
**Version:** no bump. **How to verify:** typecheck once (tools have `.d.mts`); the helper tests.

## Phase 263 — Desktop master client service (no UI) [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; contract block M24-I in `API_CONTRACTS.md`). Next: Phase 264.**
**Goal:** Main-process code that talks to the master, with IPC, storage and tests; no screens.
**Depends on:** 257, 259 (shapes). The live server is not needed.
**In scope:** NEW `src/main/sync/master/{masterClient,masterStore,masterService}.ts`: client for every call of 257 (fetch, one retry, timeout 10 s, errors -> plain words, all logging through `redact`), `masterStore` keeps in the existing OS secret store: master URL + anon key (baked in as constants from build config, `MASTER_URL` / `MASTER_ANON` in `src/shared/appInfo.ts` or a new `shared/master/config.ts`), device token, linked company id, seat label; `masterService` = `link(enrol...)`, `adopt()`, `refreshCredentials()`, `seatList/create/reset/revoke/rename/regen()`, `profileGet/Set()`, `status()`; IPC channels `master:*` (zod, `src/main/ipc/master.ts`, registered in `register.ts`) and bridge typings in `src/shared/ipc.ts` + preload. Tests against a fake fetch: every call shape, retry, offline = "Master unreachable", nothing secret reaches the log or `diagnostics`. NO UI.
**Out of scope:** any renderer screen, any change to the existing shared-sync code.
**Key files:** `src/main/sync/electronSecretStore.ts`, `secretStore.ts`, `src/main/ipc/{sync,license,register}.ts` (pattern), `src/shared/ipc.ts`, `src/preload/*`, `src/shared/master/*`, `API_CONTRACTS.md`.
**Version:** no bump. **How to verify:** typecheck once; the new tests + `importBoundaries` + `ipc` registration tests that list channels.

## Phase 264 — Desktop "Link to master" wizard + silent adopt [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; contract block M24-J in `API_CONTRACTS.md`). Next: Phase 265.**
**Goal:** Seat 1 links the company in one wizard; every updated PC adopts silently.
**Depends on:** 263.
**In scope:** (a) silent adopt: on app start, when shared sync is active, a master is configured and this PC has no device token: `masterService.adopt()` in the background (never blocks start, never throws, retries later, only logs a redacted line); (b) Settings > "Company seats" section (new file, section registered like the others; action key + palette entry; shows "Not linked to master / Linked as seat N") with the seat-1-only "Link to master" wizard: enrol token, company label, service_role key (password-style field, cleared immediately after the call, never stored), plain-words result; non-seat-1 PCs see only the status line; (c) tests for the store and wizard logic (the key is never kept: assert it is absent from state after success AND failure).
**Out of scope:** seat list / actions (265-266).
**Key files:** `renderer/components/settings/` (pattern: `SharedSyncSection.tsx`), `renderer/stores/sharedSyncStore.ts` (pattern), `renderer/stores/settingsStore.ts`, `shared/shortcuts.ts` (action key), `main/index.ts` (adopt hook).
**Version:** no bump. **How to verify:** typecheck once; the new tests; `shortcuts`; `importBoundaries`; settings section-count test updated (known `settingsPage` failures are pre-existing).

## Phase 265 — Desktop Company seats A: list + create [E]
**STATUS: ✅ DONE 2026-11-13 (see PHASE_STATUS.md; contract block M24-K in `API_CONTRACTS.md`). Next: Phase 266.**
**Goal:** Seat 1 sees every seat and creates new ones (max 15), and can show / copy a seat's code.
**Depends on:** 264.
**In scope:** `renderer/stores/masterSeatsStore.ts` + the "Company seats" panel: table (seat no, label, status, legacy badge "existing login", last seen, code hint), "Add seat" (label), shows the new code once in a copy box with a plain "Give this code to the person" line, "Show code" for non-legacy seats, cap message at 15, all strings plain words; seat 1 only (others see nothing but the status line). Fake-bridge store tests (list, create, cap, error words).
**Out of scope:** reset / delete / regenerate (266).
**Key files:** `components/settings/CompanySeatsSection.tsx` (from 264), `stores/masterSeatsStore.ts`, `shared/master/errors.ts`.
**Version:** no bump. **How to verify:** typecheck once; the store test; `importBoundaries`.

## Phase 266 — Desktop Company seats B: seat actions [E]
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-L in `API_CONTRACTS.md`; typecheck / vitest not run, see log). Next: Phase 267.**
**Goal:** Reset, delete, regenerate code, rename label; Price List rights inline.
**Depends on:** 265.
**In scope:** per-seat actions with typed confirmations (reset: "Everyone on this seat will reconnect by themselves"; delete: type `DELETE`; seat 1 has no reset/delete buttons), regenerate code (old code stops working at once, linked devices unaffected), rename label; an inline "Price List rights" button per seat that opens the existing `PriceRightsSettings` editor for that seat (reuse, do not duplicate); legacy seat: "Reset to enable a code" explanation; tests for the store actions and the confirmation rules.
**Out of scope:** device-side re-credential (267).
**Key files:** `CompanySeatsSection.tsx`, `masterSeatsStore.ts`, `components/settings/PriceRightsSettings.tsx`.
**Version:** no bump. **How to verify:** typecheck once; the store tests.

## Phase 267 — Desktop silent re-credential [E]
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-M in `API_CONTRACTS.md`; typecheck / vitest not run, see log). Next: Phase 268.**
**Goal:** After a seat reset, active desktops keep working without anyone typing.
**Depends on:** 263.
**In scope:** where the shared-sync connect path gets `auth_failed` (`activationV2.connect`, push / pull workers): if a master device token exists, call `masterService.refreshCredentials()` ONCE, store the new password in the secret store exactly where the old one lives, retry; if the master says seat removed -> existing "sync stopped" state with the plain words "This seat was removed. Ask the admin for a new code."; if the master is unreachable keep the current "paused, will retry" behaviour; no loops (one attempt per 60 s). Tests with the sim: reset mid-run, offline reset, removed seat, master down, no device token (unchanged behaviour).
**Out of scope:** the phone.
**Key files:** `src/main/sync/activationV2.ts`, `pushWorkerV2.ts`, `pullWorkerV2.ts` (hook points only), `masterService.ts`, `sharedSim.ts`.
**Version:** no bump. **How to verify:** typecheck once; the new test + `activationV2`, `sharedSync*` named tests that exist for the touched files; no full suite.

## Phase 268 — Phone master client + redeem (no UI) [E]
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-N in `API_CONTRACTS.md`; typecheck / vitest not run, see log). Next: Phase 269.**
**Goal:** The PWA can redeem a code and write the bundle into its existing vault.
**Depends on:** 259, 257.
**In scope:** NEW `src/pwa/sync/master.ts` (fetch client for redeem / adopt / refresh / heartbeat / profile-get; plain-words errors; `redact`), `redeemCode(code)` = validate check character locally -> call -> write bundle to the vault (`VaultData` keys, no schema change) + `meta` (branch setup stays the existing step) -> return the existing "linked" state so the existing first-sync flow runs; `adoptIfPossible()` for old phones (valid session + registered company -> device token; silent); device token stored in the vault blob (extend `VaultData` with an OPTIONAL `deviceToken`, version-tolerant: old blobs still open). Tests with a fake fetch + fake vault.
**Out of scope:** screens.
**Key files:** `src/pwa/sync/{session,connect,runtime,branch}.ts`, `src/pwa/__tests__/syncLogin.test.ts` (pattern), `src/shared/master/*`.
**Version:** no bump. **How to verify:** typecheck once; the new test + `syncLogin`, `phoneRuntime`, `syncPushPull`.

## Phase 269 — Phone one-field first-launch + silent re-credential [E]
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-O in `API_CONTRACTS.md`; typecheck (pwa project) and the named tests ran, see log). Next: Phase 270.**
**Goal:** An unlinked PWA asks for ONE code; a reset seat reconnects by itself.
**Depends on:** 268.
**In scope:** the first-launch screen (when no company is linked): one input, paste-friendly, check-character feedback as you type, "Connect", plain error words, progress then straight into the existing first-sync; a small "Advanced: enter details by hand" link that opens the existing old form [A]; `auth_failed` path in `createPhoneConnect`: one `refresh` attempt with the device token before falling back to "Sign in again"; "seat removed" screen. In the NEW layouts' shared shell if possible; the classic layout is not touched without the owner's approval (10r) - if the first-launch gate lives in shared bootstrap code, add it there as a screen that all layouts show. Tests: redeem happy path, bad code, revoked, offline, reset recovery, removed seat, advanced form still reachable.
**Out of scope:** profile (272), classic layout restyle.
**Key files:** `src/pwa/ui/bootstrap.ts`, `src/pwa/App.tsx`, `src/pwa/ui/SettingsSync.tsx` (old form, reuse), `src/pwa/sync/connect.ts`, a NEW `src/pwa/ui/ConnectCode.tsx`.
**Version:** no bump. **How to verify:** typecheck once; the new test + `syncLogin`, `phoneRuntime`, `classicParity`.

## Phase 270 — Company profile A: model + desktop settings [E]
**Goal:** Name / contact number / address / logo come from seat 1 by default; each device can override a field.
**Depends on:** 260, 261 shapes, 265. FIRST read how `company.*` settings and the logo are stored and used today (grep `company.`, `assets\` logo path) and write that in the phase log.
**In scope:** NEW `src/shared/master/profile.ts` (pure): `effectiveProfile(master, local, overrides)`, `diffProfile`, size limits, logo rules (PNG, <= 150 KB after resize); desktop: seat 1's Settings > Company edits the master profile (calls `profileSet`), other PCs: on start and on each heartbeat if `profile_version` moved, download and store as the DEFAULT; a local edit of a field sets that field's override flag (`company.override.<field>`), "Use company default" button clears it; when not linked to the master the behaviour is exactly as now. Tests: precedence, override survives a master update for other fields only, clear override, size limits, offline keeps last.
**Out of scope:** print / bill header / images (271), phone (272).
**Key files:** `src/shared/settings.ts` (company keys), the Company settings section, `masterService.ts`, `shared/master/schemas.ts`.
**Version:** no bump. **How to verify:** typecheck once; the new test + settings default / schema tests.
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-P in `API_CONTRACTS.md`; typecheck and the named tests ran, see log). Next: Phase 271.**

## Phase 271 — Company profile B: desktop print / header / image [E]
**Goal:** Everything printed or shared uses the effective profile.
**Depends on:** 270.
**In scope:** find every reader of the company name / phone / address / logo (print layouts, image export, share, PO header, About) and switch them to the single effective-profile getter; no layout change; tests with a master profile + override.
**Out of scope:** new layouts; phone.
**Key files:** grep results of `company.`; `src/main/print/*`, `shared/print/*` (only the readers), their tests.
**Version:** no bump. **How to verify:** typecheck once; the named print / image tests of the touched code; page-feel on a real printer is an owner check.
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-Q in `API_CONTRACTS.md`; typecheck and the named tests ran, see log). Next: Phase 272.**

## Phase 272 — Company profile C: phone [E]
**Goal:** The phone shows and uses the same effective profile (bill view / share / about).
**Depends on:** 268, 270.
**In scope:** heartbeat on start and each sync cycle (throttled) -> download profile when the version moved -> store in `settings` (IndexedDB, no schema change) -> use in bill view / share image / About; phone override fields optional [A: the phone only DISPLAYS the company default, no override editor]; tests.
**Out of scope:** classic layout restyle; override editor.
**Key files:** `src/pwa/sync/master.ts`, `pwa/data/settingsRepo`, `pwa/ui/{BillView,SharePanel,AboutPage}.tsx`.
**Version:** no bump. **How to verify:** typecheck once; the new test + `phoneRuntime`, `classicParity`.
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; contract block M24-R in `API_CONTRACTS.md`; typecheck (pwa project) and the named tests ran, see log). Next: Phase 273.**

## Phase 273 — Milestone 24 QA gate (release gate) [G]
**Goal:** Close M24: reconcile docs, write the owner checklist, release.
**Depends on:** 251-272.
**In scope:** typecheck once + the named test files of 251-272 (each phase's log lists them); reconcile `PHASE_STATUS.md`, `PROJECT_STRUCTURE.md`, `API_CONTRACTS.md`, `GITHUB_UPDATE_PUSH.md` (section 11: master deploy order, release 0.1.57); write `docs/M24_OWNER_CHECKLIST.md` UNFILLED (master project setup, deploy functions, link the first company, an existing phone keeps working after update, adopt, new phone one code, create / reset / delete seats while a phone is open, 15-seat cap, price rights live change, profile inherit / override, master paused behaviour, backup export, the Dashboard / Price List / PWA price columns / AI-off checks on real devices); bump 0.1.57 [A]; hand back changed-files zip + full zip + push steps with the tag. Master unused = 0.1.55 behaviour is checked by test.
**Out of scope:** new features.
**Version:** 0.1.57 (release gate [A]). **How to verify:** typecheck once + the named tests green or each failure listed with its cause (compare against the previous zip). NO FULL SUITE; real Supabase / Windows / Android never written as "verified".
**STATUS: ✅ DONE 2026-11-14 (see PHASE_STATUS.md; version 0.1.57 [A], NOT yet pushed or tagged by the owner; `docs/M24_OWNER_CHECKLIST.md` written UNFILLED). Next: owner checklist, then Phase 274 only if it reports problems.**

## Phase 274 — Fix pack from the owner's report (only if needed) [E]
**Goal:** Fix what the owner found when testing M24.
**Depends on:** 273 and the owner's filled `docs/M24_OWNER_CHECKLIST.md`. Skip if there is no report.
**In scope:** only what the report lists; if the list is long, do the first items that fit one free session and log the rest as the next fix pack. Never loosen the security rules of design section 8.
**Version:** no bump by itself. **How to verify:** typecheck once; the named tests of the touched code; NO FULL SUITE.
