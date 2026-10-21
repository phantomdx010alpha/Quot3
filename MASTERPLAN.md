# MASTERPLAN — Quot3

**Edit in place; never regenerate.** This is the architecture and decisions document. `PHASES.md` is the build order, `PHASE_STATUS.md` is ground truth for progress, `docs/reference/*` are the owner's behavioural rules.

---

## 1. What Quot3 is
A **Windows desktop quotation application** for a trading business: free-entry quotations (no item catalogue) in an Excel-like grid with auto-calculation, two switchable formats (GST / non-GST) plus future formats, rough and professional printing on A5/A4, one-key **copy as image** for pasting into WhatsApp, a party database with fuzzy autocomplete, history and customers pages, optional multi-branch sync through an encrypted Supabase postbox, undo/redo and recovery features, and a fully keyboard-driven workflow. It must feel instantaneous ("240 FPS smoothness") and compact (≥ 20 rows visible, Excel/Tally density).

Single-user per installation, offline-first, no server of ours, data in `%LOCALAPPDATA%\Quot3\`.

## 2. What already exists (not being rebuilt as code, but used as reference)
The owner's current app **"Meenakshi Buttons"** (a Python-era tool, screenshots in `docs/reference/legacy_app/`). Quot3 re-implements and extends it. Carry over concepts and the screen layouts, **not** code, and not the old shortcut mapping. What the screenshots establish:
- Create screen: toolbar of actions (Red+Bold, Clear Format, Highlight Cell, +Col, −Col, Mark, Show Mkd, Excel Import, Print Options), a one-line party bar (Party Name, Phone, Transport), then the grid (Sl.No, Item Name, Quantity, Rate, Amount, extra columns "ruby", "tomato").
- A "Marked" popup listing per-column unit sums.
- History screen: left panel **Dates** (date + bill count), right panel bill list (Bill No, Date, Party, Total), bottom action bar (Open PDF, Edit/Open in Billing, Print, Delete Bill, Back), search, branch/backup selector.
Quot3 improves: density, keyboard model, formats, adjustments, paper engine, image copy, undo/redo, sync.

## 3. Architecture
See `CLAUDE_MUST_READ.md` §2 (diagram and hard layering rules). Summary:
- **Renderer** (React/TS, sandboxed) ⇄ **preload bridge `window.quot3`** ⇄ **main** (Node: SQLite, services, print/image windows, clipboard, sync) with **`src/shared`** pure logic imported by both sides.
- All persistence in main; renderer holds the *open bill* in a Zustand store and persists via debounced IPC (drafts) and explicit Save.

## 4. Process model and security
- One BrowserWindow for the app; short-lived **hidden BrowserWindows** (offscreen, same sandbox rules) for print preview rendering, PDF and image capture, loading the same print template HTML.
- `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`), deny `will-navigate` and `setWindowOpenHandler`.
- Single-instance lock (second launch focuses the first).
- IPC: `ipcMain.handle('ns:method')` with Zod validation of input and output; a typed result envelope `{ ok: true, data } | { ok: false, error: { code, message } }`; no thrown exceptions across the boundary.
- Secrets (license key, derived encryption key) only via `safeStorage`. No `service_role` key anywhere.
- Logs rotate in `%LOCALAPPDATA%\Quot3\logs\`; no bill content in logs.

## 5. Source-of-truth documents
| Doc | Role |
|---|---|
| `docs/reference/REQUIREMENTS_ORIGINAL.md` | Owner's words + confirmed assumptions — final authority |
| `docs/reference/KEYBOARD_CELL_RULES.md` | Cell navigation/editing state machine |
| `docs/reference/UNDO_REDO_RULES.md` | Undo/redo, trash, revisions |
| `docs/reference/PAPER_ENGINE_RULES.md` | A5/A4 decision table |
| `docs/reference/EXTRA_COLS_UNITS_RULES.md` | Extra columns, units parsing, Mark |
| `docs/DATA_MODEL.md` | SQLite schema |
| `docs/SYNC_POSTBOX_SPEC.md` | Supabase postbox design (v1; replaced by M12 once Phase 140-142 are done) |
| `docs/SYNC_SHARED_STORE_SPEC.md` | Shared-notebook sync (Milestone 12, binding for Phases 128–143) |
| `docs/design/DESIGN_TOKENS.md` | Theme tokens and theme files |
| `API_CONTRACTS.md` | Shared function signatures, IPC channels, bridge API |
| `PROJECT_STRUCTURE.md` | Folder layout |
| `DEPENDENCY_VERSIONS.md` | Locked packages |

## 6. Tech stack (decided with the owner)
Electron · electron-vite (Vite 7) · React 19 + TypeScript 5.9 · Tailwind v3 + CSS custom properties · **custom DOM grid** (no grid library) · Zustand + Immer patches · decimal.js · SQLite via better-sqlite3 + Drizzle · Zod · Fuse.js · ExcelJS · Supabase JS (sync only) · electron-builder + electron-updater · Vitest + Playwright.
**Rejected, with reasons:** Tauri (owner unfamiliar; needs Rust), Python wrapper EXE (second runtime, slower start, AV false positives), Glide Data Grid (canvas — cannot style individual words red/bold), AG Grid (heavy, DOM-bound, fights the custom cell rules), HyperFormula (formulas are fixed per format; may be added later behind the format registry if the owner wants user-typed formulas).

## 7. Layering (see CLAUDE_MUST_READ §2 for the rules)
- `src/shared/*` pure TS — money, calc, units, paper, formats, runs, nav reducer, diff, shortcuts.
- `src/main/db/*` — only SQLite access. `src/main/services/*` — business operations. `src/main/ipc/*` — handlers (validate → service → envelope). `src/main/sync/*` — only Supabase access.
- `src/preload/*` — the typed bridge.
- `src/renderer/*` — UI. Pages call `window.quot3.*`; grid/stores call `src/shared/*`.

## 8. Numbers: storage, math, rounding, display (decisions D-M*)
- **D-M1** All numeric values are decimal strings; math only via `src/shared/money.ts` (decimal.js, precision 28, rounding `ROUND_HALF_UP`).
- **D-M2** Row `total` = `qty × rate`, rounded to **2 dp** (unless `total_override` is set, in which case the override is used as typed, rounded to 2 dp). Blank qty or blank rate: if only one of them is present the computed total is blank (nothing to multiply) unless an override exists.
- **D-M3** `gst_amt` = `total × gst_rate / 100`, rounded to 2 dp; `amount` = `total + gst_amt`. GST is computed from the **effective total** (including an override).
- **D-M4** Items subtotal = sum of effective totals (non-GST) or sum of `amount` (GST — with the sum of `total` and `gst_amt` also shown). Sums are of already-rounded row values (no re-rounding of a sum of unrounded values).
- **D-M5 (amended by Milestone 8 / Phase 76)** The per-bill flag `bills.round_off` now rounds the grand total to the nearest rupee with NO displayed line (`computeBill` option `roundGrand`, set only via `getBillOptions`); the explicit-line `roundOff` option below remains in the engine but nothing in the app turns it on. Original text: No automatic round-off to the nearest rupee by default; Settings has an optional "Round off final total" (off by default) that adds an explicit "Round off" line to the footer and the printout.
- **D-M6** Display: qty and rate are shown trimmed (`10`, `90`, `12.5`), not `10.0`; money columns always show 2 dp; ₹ symbol and Indian digit grouping (`₹1,07,500.00`) in History/Customers/Dashboard and the printed grand total; grid money cells show plain numbers with tabular alignment. Font used in print/PDF/image **must contain the ₹ glyph** (bundle a font; do not rely on a base-14 PDF font).
- **D-M7** Negative values allowed in the Total column (discount adjustments); qty and rate reject negatives.

## 9. The grid (Phases 9–24) — custom DOM grid, not a library
Why: per-word rich text inside cells, the append-caret rule, F2/free mode, one-key Red+Bold, per-cell override markers, and print parity all need full control of the cell DOM.
- **Model:** the grid renders **derived display rows** from the bill: item rows, then (when present) the items-subtotal row, adjustment rows, adjustments-total row, final-total row — plus trailing blank entry rows. Footer rows are display-only (not stored).
- **Cells:** each cell is a lightweight component subscribed to *only its own slice* (Zustand selector keyed by row id + column key). Name cells use an uncontrolled `contenteditable` (avoids React caret jumps) serialised to runs; numeric cells are `<input>`s (or contenteditable with filtering) with the same key pipeline.
- **Rendering budget:** ≤ ~80 rows × ≤ ~12 columns ≈ 1000 cells — a plain DOM table of memoised cells is within budget; **no virtualisation in the bill grid** (it would complicate print parity and keyboard jumps). Virtualisation (`@tanstack/react-virtual`) is for History and Customers only.
- **Layout:** CSS grid with fixed row height (`--row-height`), `contain: layout style paint` per row, `content-visibility` not used (we want instant scroll-jump). Sticky header row.
- **Key pipeline:** one `keydown` handler on the grid root → `cellNavReducer(state, key)` → effects (move active cell, set caret, begin edit) applied directly to the DOM without going through React state for the caret.
- **Input latency path:** keydown → reducer → DOM mutation → paint. Bill-store commit and recompute run in a microtask/rAF after the DOM is already updated; persistence is debounced (draft) and never inside this path.
- **Measurement:** Phase 24 adds a dev-only perf harness (synthetic key events at 240 Hz against an 80-row bill, recording `performance.now()` deltas and long frames) and records the numbers in `PHASE_STATUS.md`. The budget is described in `CLAUDE_MUST_READ.md` §5.6.

## 10. Formats (Golden Rule: formats are data)
A **format definition** (registry entry) declares: `id`, `label`, shortcut (`Alt+1` GST, `Alt+2` non-GST default), ordered **columns** (key, label, kind, editable, derived formula id, width hints, print width), `footer` behaviour, `a5ExtraColLimit`, and print layout hints. Shipped formats:
- `non_gst` (default): `Sl.No · Item Name · Qty · Rate · Total`. (Owner changed this on 2026-10-13: it was Rate before Qty; now matches the GST format.) Total is derived, overridable.
- `gst`: `Sl.No · Item Name · Qty · Rate · Total · GST % · GST Amt · Amount`. (A1: item name included. Qty-before-Rate order per owner.)
Extra columns (free text, unit-bearing) are **appended after the format's columns** and belong to the bill. New formats = new registry entry only.
Switching format changes column visibility and derived columns; the **row superset is untouched** (§ requirements 4.5).

## 11. Calculation engine — row classification and footer (Phase 6, 19)
`classifyRow(row)` is pure and derived (never stored):
| Kind | Condition |
|---|---|
| `blank` | no name, no qty, no rate, no total override |
| `item` | has qty or rate (either or both) |
| `adjustment` | name present, **qty and rate both empty**, total override present (owner's rule) |
| `partial` | anything else (e.g. name only; or a total with no name) — shown, flagged, **not totalled** except a nameless row with qty/rate which is an `item` flagged "missing name" (D-C1) |
**Sl.No** is assigned (1,2,3…) to `item` rows that have a name and at least one of qty/rate (owner's rule); it renumbers automatically; adjustments, partial rows and blanks get none.
**Footer order (owner's rule):** items → **Items total** → adjustment rows → **Adjustments total** → **Final total** (= items total + adjustments total). With zero adjustments the footer is just the single total (labelled "Total"). Adjustments are **not taxed** (no GST) and in GST format they add to the Amount column's total only. A row that *becomes* an adjustment (user fills name + total only) moves automatically into the adjustment block; the active cell follows it.
**Decisions:** D-C1 nameless row with qty/rate counts as an item and is flagged; D-C2 adjustments never carry GST; D-C3 adjustment rows count toward the paper-engine row count (owner: "inclusive the adjustment rows"); footer rows do not.

## 12. Print, PDF and image pipeline (Phases 33–39)
- **One template** (`src/main/print/template/*.html/css` + a TS renderer that produces HTML from a `PrintModel`) serves **preview, print, PDF and image**, so they cannot drift.
- `PrintModel` is built by a pure function from a bill + mode (`rough`/`professional`) + settings; it contains the exact rows, columns, widths, header block, footer rows and `PaperDecision`.
- **Rough** header: party name, phone, transport only. **Professional** header: our company logo, name, phone, address (from Settings) + party name, address, transport, phone + **PO number**. (Rough carries no company block, no party address; PO number is professional-only per owner.)
- **Print:** hidden window loads the template, `webContents.print({ silent:false, pageSize })` for the system dialog or silent to the configured printer; **PDF:** `printToPDF({ pageSize, preferCSSPageSize })`.
- **Image:** hidden window with the same template at A5/A4 logical size, `capturePage()` of the **content bounding box only** (white margins cropped by measuring the content's bounding rect, plus a small uniform padding), device scale factor 2–3, converted to `nativeImage`, `clipboard.writeImage()`. Verified by also writing a PNG to a temp path in dev for inspection. The owner says "strictly no compromises": image must be crisp, include the full table (even when taller than the screen — capture is done off-screen at full content height) and the ₹ glyph.
- **Overflow:** long item names and headers wrap inside their cell; row height grows; no horizontal clipping; table header repeats per page; totals stay together on the last page.
- **Paper:** A5 default; decided by `decidePaper()` (see `PAPER_ENGINE_RULES.md`); user can force.
- Fonts bundled in `resources/fonts/` (a Unicode font with ₹ — e.g. Noto Sans, regular+bold) and loaded by `@font-face` in the template.

## 13. Pages
| Page | Route | Purpose |
|---|---|---|
| Dashboard (landing) | `/` | 4 big entry cards (Create, History, Customers, Settings), today/month totals, recent bills, recoverable drafts, sync status, last backup |
| Create | `/create` (+ `?bill=<id>` for edit) | party bar + grid + bottom action bar |
| History | `/history` | dates list (left) + bills (right), search, branch filter, trash, revisions |
| Customers | `/customers` | party list with bill count, phone, details; search; open party → their bills |
| Settings | `/settings/*` | Company & logo, PO prefix/branches, Print defaults, Party import, Themes, Shortcuts, Backup/restore, Sync/license |
| Dev (dev builds only) | `/dev/*` | design-preview, perf harness, seed data |
Routing: a tiny in-memory router (no URL bar in Electron); history stack supports Esc/back. Side rail on all pages except Dashboard cards can double as nav.

## 14. Party model and autocomplete
Parties come from: the **Excel import** (Settings), automatic creation when a bill is saved with a **new** party name, and manual add/edit on the Customers page. The party-name field uses **Fuse.js** (threshold ~0.35, keys: name, phone) over the in-memory party list; typing shows a dropdown; selecting auto-fills phone/transport/address. Bills store a `party_snapshot` so past bills never change when a party is edited. Customers page = parties + `COUNT(bills)` + last bill date.

## 15. UI/UX system (see `CLAUDE_MUST_READ.md` §5 and `docs/design/DESIGN_TOKENS.md`)
Neumorphic navy/red chrome, flat dense grid, 26px rows, ≥ 20 rows at 1366×768, compact party bar with an address pull-down, bottom action bar with Rough Print, Professional Print, Rough Image, Professional Image, TSV Copy, Undo, Redo, Save. Phosphor icons, no emoji. Everything keyboard-reachable; Ctrl+K command palette; F1 shortcut sheet.

## 16. Features — core (from the owner) and suggested extras
**Core:** formats Alt+1/Alt+2 · free-entry grid · auto-calc + override · adjustments · extra columns + units + Mark · rich text (bold, red+bold, colours) · Excel-style navigation with append-caret rule · print rough/professional A5/A4 · copy as image · TSV copy · party autocomplete + import · Esc-save prompts · History · Customers · Dashboard · themes · PO prefix · branch sync · **undo/redo + trash + revisions**.
**Suggested extras (build only when the owner approves; some are already in phases):** auto-backup + restore (Phase 50) · command palette (Phase 4) · audit log (Phase 61) · "duplicate bill" (copy a bill as a new draft) · bill notes/terms footer line on professional print · quick "repeat last bill for this party" · per-party default transport · per-branch letterhead · export History to Excel · keyboard cheat-sheet overlay · low-disk / DB-integrity check on startup · crash log viewer.

## 17. Deliberately deferred (do not build unless a phase says so)
Item catalogue/price list · invoices/e-way bills/Tally integration · mobile/web builds (the phone PWA is the exception: Milestone 17 builds it, see section 27; no native, TWA or Capacitor builds) · multi-user permissions on one machine · live co-editing · cloud storage of readable bills · user-typed Excel formulas in cells (HyperFormula) · barcode/inventory.

## 18. Open items (resolve when reached; record the answer in `PHASE_STATUS.md`)
See `PHASE_STATUS.md` → "Open questions" and "Awaiting from owner". Key ones: party-import Excel format; app icon; confirm D-K3 (Left at start edge), D-X1 (marked-cell number), A6 (undo scope); exact professional-print layout (owner to review a rendered sample in Phase 34); default printer/paper-tray behaviour on the owner's machine.

## 19. Testing strategy
- **Vitest** for everything in `src/shared` (calc, money, units, paper, runs, nav reducer, diff, format registry) and `src/main` services against an in-memory SQLite (`:memory:` / temp file) and `InMemoryTransport` for sync.
- **Fixtures:** `src/shared/__fixtures__/` — the legacy ruby/tomato bill, 40/41/80/81-row bills, a GST bill with extras, long-name bills, adjustment bills.
- **Property tests** for undo/redo (random edit sequences) and for calc (sum of rows equals footer).
- **Playwright-Electron** smoke/e2e (Phase 66) for the keyboard flows and print-to-PDF/image output sanity.
- **Manual owner checks** are listed as standing gaps whenever the sandbox could not run the real thing (printing, clipboard image paste, real Supabase).

## 20. Milestones (build order — details in `PHASES.md`)
| M | Phases | Theme |
|---|---|---|
| 1 | 1–8 | Foundation: scaffold, secure shell, tokens, app shell, SQLite, calc engine, units engine, format registry |
| 2 | 9–24 | The grid: render, navigation, editing modes, rich text, clipboard, undo/redo, adjustments, formats, extra columns, overflow, perf gate |
| 3 | 25–32 | Create page: party bar, autocomplete, save/PO, Esc guard, drafts, bottom bar, TSV copy |
| 4 | 33–40 | Print/PDF/image: templates, paper engine, print flow, image copy, QA gate |
| 5 | 41–50 | History, trash, revisions, Customers, Dashboard, party import, Settings, backups |
| 6 | 51–60 | Sync: spec/SQL, license, crypto, outbox, push, pull, conflicts, bootstrap, UI, hardening |
| 7 | 61–69 | Audit/logs, updater, icon, installer, signing, e2e, keyboard + perf acceptance, final QA |
| 8 | 70–91 | Milestone 8 (post-Phase-68 owner feedback); Phase 69 runs after 91 |
| 9 | 92–106 | Milestone 9 (post-Phase-91 owner feedback: crash fix, History, navigation, themed chrome, four themes, extra-column Down, HD image); Phase 69 runs after 106 |
| 10 | 107–115 | Milestone 10 (item sorter: grouped similar item names, GST / non-GST sales, who-paid-what, open the bill); Phase 69 runs after 115 |
| 11 | 116–127 | Milestone 11 (post-Phase-115 owner feedback: notification discipline, Items display fix, Create always blank, clipboard, round-off, HD image, delete row, row reorder, Dashboard live tiles); Phase 69 runs after 127 |
| 12 | 128–143 | Milestone 12 (shared-notebook sync: Supabase email/password logins, one-query license + login generator, versioned records, diff matcher, latest version wins, customers unify, Realtime doorbell, cutover, retire the encrypted postbox); Phase 69 runs after 143 |
| 13 | 144 | Milestone 13 (print position: A4/A5 printout starts at the top margin; reproduce-first); Phase 69 runs after 144 |
| 17 | 173–188 | Milestone 17 (phone version: Android PWA on Vercel, IndexedDB, compact create / edit / view bills, share image / PDF only; desktop unchanged; ships 0.1.15 ... 0.1.28 then 0.2.0); Phase 69 runs after 188 |
**Hard gates:** Phase 24 (grid feels right and perf numbers recorded), Phase 40 (print/image correctness), Phase 69 (release). No phase after a gate starts until the gate checklist in its `PHASES.md` entry passes.

## 21. Milestone 8 (added after Phase 68)
Owner feedback after Phase 68 became Phases 70–91 (instant HD image copy, instant top-aligned print, smooth arrows, round-off, extra free cells, calculator drawer, active-row highlight, legacy JSON import, sync fixes with progress, About publisher, Start fresh wipe). Design: `docs/MILESTONE8_DESIGN.md`. The release gate (Phase 69) now follows Phase 91.

## 22. Milestone 9 (added after Phase 91)
Owner feedback on the running app became Phases 92–106 (Settings Sync/License fix, History layout, Dashboard-rooted navigation and Esc, themed scrollbars and title bar, four new themes with a picker, Down-key row extension in extra columns, HD image scale). Design: `docs/MILESTONE9_DESIGN.md`. The release gate (Phase 69) now follows Phase 106.

## 23. Milestone 10 (added after Milestone 9 planning)
Item sorter: a new Items page (three windows) that groups similar item names across all bills, shows sales per group split GST / non-GST with party, date and who-paid-what, remembers the owner's merges/splits (synced), and opens the party's bill directly. Spec: `docs/ITEM_SORTER_SPEC.md`. The release gate (Phase 69) now follows Phase 115.

## 24. Milestone 11 (added after Phase 115)
Owner feedback on the Phase 115 app became Phases 116–127: six bug-fix phases (notifications, Items page display, Create always blank, grid clipboard, round-off, HD image), then delete row, row reorder, and Dashboard live tiles (weather, forex, metals, clock, holidays) in a symmetric grid. Design: `docs/MILESTONE11_DESIGN.md`. The release gate (Phase 69) now follows Phase 127.

## 25. Milestone 12 (added after Phase 127)
After a two-computer sync failure (`Sync pull paused: decrypt`) the encrypted-postbox sync is replaced by a shared Supabase notebook: durable versioned records, Supabase Auth email + password per computer, a license made by one SQL query that also creates the logins, a diff matcher (skip / upload / download / latest wins), customers unified by exact name with a Possible-duplicates list, a Realtime doorbell with a 60 s poll fallback, and a guided cutover. Spec: `docs/SYNC_SHARED_STORE_SPEC.md`; design: `docs/MILESTONE12_DESIGN.md`. The release gate (Phase 69) now follows Phase 143.

## 26. Milestone 13 (added 2026-10-12)
One phase: Phase 144 verifies and fixes the owner's report that an A4 printout starts about 65-70 mm down the sheet instead of at the top margin. Independent of Milestone 12. The release gate (Phase 69) now follows Phase 144.

## 27. Milestone 17 (added 2026-10-21)
A phone version of Quot3 as an Android PWA hosted on Vercel, built from the same repo and folder (a second Vite build, entry `src/pwa/`). The phone keeps its data in IndexedDB with persistent storage, has its own small compact UI for creating, editing and viewing bills, syncs through the same shared-notebook Supabase (its own seat and branch), and outputs only by share image / share PDF. No print, no AI, no PC-only features. Phases 173-188, versions 0.1.15 ... 0.1.28 then 0.2.0. Design: `docs/MILESTONE17_DESIGN.md`. **Rule: desktop code paths, schema, files and release steps do not change.** Prerequisite (Stage 0): the v2 sync engine wiring (140b), the owner's real-Supabase checklist and Phase 142 - re-check `PHASE_STATUS.md`. Phase 69 (release gate) still runs after the last feature phase.
