# CLAUDE MUST READ — Start Here, Every Session, No Exceptions

---

## NEVER REWRITE FILES — Read this before touching anything

**Do not rewrite any existing file in full. Ever. Unless a prior `PHASE_STATUS.md` entry explicitly says a full rewrite was anticipated and necessary.**

This means: no `cat > file.md << 'EOF' ... EOF`. No writing the whole file from memory. Not for `PHASE_STATUS.md`, not for `API_CONTRACTS.md`, not for `PROJECT_STRUCTURE.md`, not for any source file that already exists.

**Why:** Rewriting consumes the entire file's worth of tokens in one tool call. `str_replace` sends only the changed lines. Across 69 phases that is a large chunk of session budget burned on nothing.

**The correct pattern for every doc update:**
1. `unzip -p archive.zip path/to/file` — read it (or read the section you need with `grep -n` + `sed -n`)
2. `str_replace` — change only the specific lines that need changing
3. Append-only additions (new log entries, new phase rows) go at the bottom via `str_replace` on the last unique line

**The only exceptions:**
- Creating a brand new file that does not exist yet → `create_file` is fine
- A source file so fundamentally broken that a prior `PHASE_STATUS.md` entry explicitly anticipated a full rewrite → justify it in `PHASE_STATUS.md` before doing it

If you feel the urge to `cat >` an existing file, that urge is wrong. Stop. Use `str_replace`.

---

## RELEASES AND GITHUB UPDATES — read `GITHUB_UPDATE_PUSH.md`

If the owner's request changes the app (anything that must reach the installed copies), also read `GITHUB_UPDATE_PUSH.md` at the repo root. It says how updates ship (GitHub tag -> GitHub Action builds and publishes), the version bump you MUST make (`package.json` and both spots at the top of `package-lock.json`), and what to hand back: a changed-files zip, the full zip, and the push steps with the real version number filled in. Do not build the exe locally; GitHub does it.

---

## SESSION EFFICIENCY PROTOCOL — Read this before anything else

You are operating under a **5-hour rolling session limit**. Every minute spent extracting files you don't need, running installs unnecessarily, or reading docs cover-to-cover is a minute not spent building. Follow these rules without exception:

### Extraction — extract only what you need, nothing more
- **Do not unzip the entire archive.** Use targeted extraction: `unzip archive.zip "path/to/file"` or `unzip -p archive.zip "path/to/file"`.
- **Do not `unzip -l`** the full archive unless you genuinely don't know the structure. It is documented in `PROJECT_STRUCTURE.md`.
- Extract source files only for the specific phase you're executing, plus the docs. Exception: from Phase 1 onward you need a runnable tree, so extract `package.json`, `package-lock.json`, config files, and the folders your phase touches.
- **Never extract `node_modules`** — it is never in the zip.

### Reading docs — read the minimum, write from understanding
- Mandatory minimum: `CLAUDE_MUST_READ.md` (this file), `PHASE_STATUS.md` (the "Current state" block and your phase's row/entry only — it grows large over time, never read it cover to cover), and your specific phase entry in `PHASES.md`.
- Read `MASTERPLAN.md`, `PROJECT_STRUCTURE.md`, and `API_CONTRACTS.md` **only the sections relevant to your phase** — use `grep -n '^#'` to find them.
- Read the `docs/reference/*` rule files **only when your phase's entry names them** (e.g. Phase 10-11 → `KEYBOARD_CELL_RULES.md`). Those are the owner's behavioural rules and are binding.
- **Do not read any skill `.md` files** (file-reading, docx, pptx skills, etc.) — they are not relevant to this project.

### Installs — do it once, don't repeat
- Run `npm install` exactly once after extracting. Do not re-run it "to make sure." Add a single package with `npm install <package>@<exact version>` directly.
- Do not run `npm run build` / `npm run dist` unless your phase explicitly requires it. `npm run typecheck` plus the phase's own tests is the default proof.
- Do not run audits or lint sweeps unless the phase says to.

### Verification — verify the minimum that proves it works
- Each phase has a **How to verify** step. Do exactly that. Do not verify things outside that step.
- If something doesn't work after two attempts, record it in `PHASE_STATUS.md` as a known issue and move on. A partial phase that re-zips cleanly beats an exhausted session that never re-zips.

### Precedence — when instructions conflict
Sections 6, 10 and 12 below (the "required every phase" language) are the *default*. If the phase entry you're executing states its own narrower verification scope, **the phase-level instruction wins.** Do not layer the full default checklist on top of a phase that asked for one targeted check.

### Re-zipping — do it early if unsure of time
- If you think you might be running low on session time, **re-zip immediately** even if the phase is only 80% done. Mark it 🟨 in `PHASE_STATUS.md` with exact notes on what's left.
- Run the re-zip command, confirm the output file exists, then present it. Don't leave re-zipping to the last second.

### The prompt to give the next Claude session
When handing off the zip, the owner uses exactly this prompt (replace NN with the next phase number):

> Read `CLAUDE_MUST_READ.md` inside the zip first, then `DEPENDENCY_VERSIONS.md`, then commence Phase NN. Don't extract the entire zip — extract only what's required for this phase. Don't list the archive. Read the minimum to understand, write everything from that understanding, extract only what's needed to verify. Skip anything you can skip. Deliver the output zip in this session without exhausting the 5-hour limit. Do not read any skill .md files.

---

You are working inside **Quot3** — a Windows-only, local-first, keyboard-first desktop quotation application, built incrementally across 188 phases (Milestones 14-16 = Phases 145-172, built; Milestone 17 = the phone PWA, Phases 173-188, PLANNED 2026-10-21, see section 10l; Milestone 18 = the phone UI layouts, Phases 189-196, PLANNED 2026-10-22, see section 10m) (Phases 70–91 = Milestone 8, 92–106 = Milestone 9, 107–115 = Milestone 10, 116–127 = Milestone 11, 128–143 = Milestone 12 and 144 = Milestone 13, executed before the release gate Phase 69), each completed in a separate Claude.ai session. You are *one* of those sessions. This document is the contract for how you behave. Read it fully before opening any other file.

---

## 0. Who you are in this session

You were handed a zip file. It contains the entire project as it stands right now — docs, code, status, everything. Your job is to:
1. Figure out exactly which phase comes next.
2. Do **only** that phase.
3. Leave the project in a clean, runnable, type-checking state.
4. Update the status doc.
5. Re-zip everything so it can be handed to the *next* session.

You have no memory of any other session. Everything you need is in this zip. If something you need isn't in the zip, **stop and say so** — do not guess, do not invent, do not assume. Some phases need input only the owner can provide (the app icon, the party-import Excel format, Supabase credentials, sample bills). Those are listed in `PHASE_STATUS.md` → "Awaiting from owner". If your phase needs one and it is not there, ask for it plainly and stop that part of the phase.

---

## 1. Mandatory reading order (do this before writing or editing anything)

1. **`CLAUDE_MUST_READ.md`** (this file).
2. **`PHASE_STATUS.md`** — ground truth for what has actually been done. If it disagrees with `PHASES.md`, flag the disagreement, don't silently pick one.
3. **`PHASES.md`** — find the next incomplete phase. Read its full entry: goal, depends-on, in-scope, out-of-scope, key files, how-to-verify.
4. **`DEPENDENCY_VERSIONS.md`** — exact package versions. Check before installing anything.
5. **`MASTERPLAN.md`** — relevant sections only: architecture, data model, security, UI system.
6. **`PROJECT_STRUCTURE.md`** — where new files belong and what already exists.
7. **`API_CONTRACTS.md`** — the frozen contract for every shared pure function, IPC channel and bridge method. Do not invent a different shape. Extend the doc first if a genuine gap is found, then implement to match.
8. **`docs/reference/*`** — only the rule files your phase names. They are the owner's behavioural spec:
   - `REQUIREMENTS_ORIGINAL.md` — the owner's requirements, verbatim, plus confirmed assumptions. Final authority when anything is ambiguous.
   - `KEYBOARD_CELL_RULES.md` — cell navigation and editing state machine.
   - `PAPER_ENGINE_RULES.md` — A5/A4 decision table.
   - `EXTRA_COLS_UNITS_RULES.md` — extra-column unit parsing and Mark feature.
   - `legacy_app/*.png` — screenshots of the owner's current app (layout reference for Create and History pages).
9. Any other phase-specific doc named in your `PHASES.md` entry.

**Do not skip steps.** A wrong assumption made because a doc wasn't read costs far more rework later.

---

## 2. Architecture you must understand before touching any code

Quot3 is **local-first, Windows-only, desktop-only**. There is no server of ours. Supabase is an optional encrypted **postbox** between branches, never a database of bills.

```
Renderer (React + TS UI, sandboxed, no Node)
   │  window.quot3.*  (typed contextBridge API — the ONLY door)
   ▼
Preload (contextIsolation: true)
   │  ipcRenderer.invoke('ns:method', zod-validated payload)
   ▼
Main process (Node)
   ├─ src/main/db/*        SQLite (better-sqlite3) + Drizzle — the only code that touches the DB file
   ├─ src/main/services/*  bills, parties, print, image, clipboard, backup, themes, settings
   └─ src/main/sync/*      Supabase postbox client — the only code that touches Supabase
Shared (pure TypeScript, no Electron, no Node, no DOM)
   └─ src/shared/*         money, calc, units, paper rules, format registry, rich-text runs, cell-nav reducer, shortcuts
```

**Hard rules of the layering:**
- The renderer never imports `electron`, `fs`, `better-sqlite3`, `@supabase/supabase-js`, or anything from `src/main`. It talks to the world only through `window.quot3.*`.
- `src/shared/*` is pure: it imports nothing from Electron, Node built-ins, or the DOM, so it runs identically in the renderer, in main, and in Vitest. All money logic, paper rules, unit parsing and navigation logic live here and are unit tested.
- `src/main/sync/*` is the only code that may import the Supabase client. `src/main/db/*` is the only code that may touch SQLite. Services call db; IPC handlers call services.
- Every IPC payload (both directions) is validated with Zod at the main-process boundary. Never trust the renderer.
- **App data lives in `%LOCALAPPDATA%\Quot3\`** — Electron's default `userData` is `%APPDATA%` (Roaming), so `app.setPath('userData', ...)` must run before `app.whenReady()`. Never write bill data anywhere else.

Data folder layout (created on first run):
```
%LOCALAPPDATA%\Quot3\
  quot3.db            SQLite database (WAL mode)
  backups\            automatic + manual backups (.db copies via SQLite backup API)
  themes\             drop-in custom theme JSON files
  logs\               rolling logs
  assets\             uploaded company logo etc.
  drafts are rows in the DB, not files
```

---

## 3. Sync model — optional, encrypted postbox, no service key on the client

> **Phase 142 status (2026-10-13): PARTIAL.** v1 code is still present but goes dormant per computer when the cutover finishes; it is deleted only after the owner confirms the real-Supabase checklist and the v2 engine is wired (see the Phase 142 log in `PHASE_STATUS.md`).
>
> **Milestone 12 (Phases 128–143) REPLACES the model below** with a shared, versioned Supabase notebook (Supabase Auth email + password, no passphrase, readable data protected by RLS). Until Phase 140 the code still implements the postbox; Phase 142 removes it. For any Phase 128+ read `docs/SYNC_SHARED_STORE_SPEC.md` and section 10g. Everything below this note describes the v1 behaviour that exists today.

Sync is **optional** (off by default) and **local-first**: the app always writes SQLite first; sync is a background outbox.

- Bills are **encrypted on the device (AES-256-GCM)** before leaving it. Supabase only ever holds ciphertext rows in a transient `postbox` table. It never stores readable bill data and never becomes the source of truth.
- A branch pulls rows addressed to it, applies them locally, then **acknowledges**; acknowledged rows are deleted server-side (plus a TTL sweep for rows no one ever acknowledged).
- A **license key** ties branches to one organisation. Access is through Postgres RPC functions that validate the license — the client holds only the public anon key. **No `service_role` key ever ships in the app.**
- Conflict rule: last-write-wins on `updated_at`, with soft-delete tombstones; per-bill `revision` is the tiebreaker.
- A branch that joins later cannot pull history from the postbox (rows are transient). It bootstraps from a backup import (Phase 58).
- Full design: `docs/SYNC_POSTBOX_SPEC.md`. Do not start any sync phase (51+) without reading it.

---

## 4. The non-negotiable build rules

### 4.1 Edit and upsert first
- If a file already exists and works, **modify it in place** with the smallest correct change.
- Never delete and recreate a file. That destroys comments and decisions made by earlier sessions.
- "Necessary rewrite" means the existing structure is fundamentally incompatible **and** a prior `PHASE_STATUS.md` entry explicitly anticipated it. If unsure — extend, don't rewrite, and leave a note.

### 4.2 Scope discipline
- Do **only** the phase that's next. Do not "helpfully" start the next phase's work.
- If you find a bug from a previous phase: note it in `PHASE_STATUS.md` under "Known issues / carried forward." Fix it only if it's a hard blocker for *your* phase, and say so explicitly.

### 4.3 Money is never floating point
- All amounts, quantities, rates and percentages are handled with **`decimal.js`** inside `src/shared/money.ts`. Never use JS `number` arithmetic on a monetary or quantity value anywhere (`+`, `*`, `reduce` on numbers is a bug).
- Values are stored and passed as **canonical decimal strings** (`"90"`, `"1250.50"`), never as JS numbers, in the DB, over IPC and in state.
- Rounding policy is defined once in `MASTERPLAN.md` §8 and implemented once in `src/shared/money.ts`. Do not re-implement it elsewhere.

### 4.4 Formats are data, not code paths
The Golden Rule of this project: **never branch on a format's name** (`if (format === 'gst')`). Behaviour comes from the **format registry** (`src/shared/format/registry.ts`): each format declares its columns, formulas, paper rules (`a5ExtraColLimit`), and print layout. A new format must be addable by adding one registry entry, with no change to the grid, calc, paper engine or print code. Likewise, paper thresholds (40/30/80/70) live in **one** constants file and nowhere else.

### 4.5 Rows are a superset; formats are views
Every bill row stores one superset of fields (name runs, qty, rate, total override, GST %, extra cells). Switching format only changes which columns are visible and how derived values are computed. **Switching formats must never lose or reset any entered data.**

### 4.6 Security
- BrowserWindow: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no `remote`, strict CSP, navigation and `window.open` denied except to approved internal print/image windows.
- The bridge exposes a small typed API, never raw `ipcRenderer`.
- No `service_role` key, no secrets in source. The encryption key lives in Electron `safeStorage` (Windows DPAPI), never in plaintext on disk.

### 4.7 Keyboard-first is a feature requirement, not a nicety
Every action in the app must be reachable with the keyboard alone. Every action has an entry in the single shortcut registry (`src/shared/shortcuts.ts`) which feeds the command palette (Ctrl+K), tooltips and the shortcut cheat-sheet. A feature without a registered shortcut and palette entry is incomplete.

---

## 5. UI/UX rules — read these carefully

### 5.1 Neumorphic chrome, flat grid
Default theme: **deep navy base with light-red accent**, neumorphic (soft dual shadows) for *chrome* — panels, buttons, inset input wells, the dashboard cards. The **grid itself is flat, high-contrast and dense** (neumorphism hurts legibility and density in a data table). All visual properties flow from CSS custom properties in `src/renderer/styles/tokens.css`. No hardcoded colors, shadows, radii, fonts or durations in component files.

### 5.2 Density — "compact but spacious, like Excel or Tally"
- At 1366×768 the Create page must show **at least 20 item rows** before scrolling. Default grid row height is 26px; the party/detail bar is at most ~72px tall; the bottom action bar is at most ~44px.
- No big padded cards on the Create or History pages. The address field is collapsed behind a pull-down.
- The dashboard may be more spacious; the work screens may not.

### 5.3 Navigation
Dashboard is the landing screen (cards: Create, History, Customers, Settings, plus stats). A permanent left side rail is always visible on work screens. No burger menus. Esc steps back (with the unsaved-changes guard on Create). Every page reachable by keyboard.

### 5.4 Icons — Phosphor only
`@phosphor-icons/react` exclusively; weights `light` (nav), `bold` (active/primary), `duotone` (empty states). **No emoji anywhere in the UI.** No other icon library. Size and color come from tokens.

### 5.5 Hot-swappable theming
Everything a theme can change lives in token variables. Custom themes are JSON files dropped into `%LOCALAPPDATA%\Quot3\themes\` and picked up without a rebuild (schema in `docs/design/DESIGN_TOKENS.md`). Dark navy/red is the default; at least one light theme ships.

### 5.6 Performance budget — the "240 FPS" goal
The goal is **input-to-paint under one 240 Hz frame (~4 ms) for keystrokes, arrow navigation and cell commits on an 80-row bill** on a mid-range office PC. This is achieved by: no whole-grid re-renders (memoized rows, per-cell subscriptions), incremental recalculation (only the edited row plus footer totals), no synchronous IPC or DB work on the keystroke path (persist debounced and off the render path), and no layout thrash. Phase 24 builds a measurement harness; any phase that touches the grid must not regress its numbers. Never claim the budget is met without a measurement.

### 5.7 Text overflow — never ugly
Grid cells are single-line with ellipsis and expand on focus. Print wraps long item names and headers and grows the row height. Nothing may overlap, clip silently, or push the layout sideways. This applies to UI **and** to print/PDF/image output.

---

## 6. Verification — what "working" means here *(default — a phase entry may narrow this)*

This is a desktop Electron app, and the Claude.ai sandbox usually has **no display**. Be honest about what you can and cannot prove:

- **Pure logic (calc, units, paper rules, nav reducer, runs, format registry):** must have Vitest tests; `npm test` passing is the proof.
- **Type safety:** `npm run typecheck` must pass at the end of every phase.
- **UI phases:** prove what you can without a display — `npm run typecheck`, `npm test`, and (when a phase says so) `electron-vite build`. If `xvfb-run` is available, a Playwright-Electron smoke test may launch the real window headlessly; try it once, and if it doesn't work after two attempts, stop and log it.
- **Anything you could not actually run or see** (real rendering, real printing, clipboard image paste into WhatsApp, real Supabase) goes into `PHASE_STATUS.md` → "STANDING GAPS (not confirmed)" in plain words. **Never write "verified" for something you did not run.** The owner runs `npm install && npm run dev` locally and checks visually; gaps are theirs to confirm.
- If data looks stale or wrong while testing locally, delete `%LOCALAPPDATA%\Quot3\quot3.db` (or use the in-app "Reset local data" once Phase 50 exists) and re-run.

Every phase must leave `npm install && npm run dev` starting the Electron app with whatever that phase built reachable from the UI (or from the design-preview / dev routes).

---

## 7. If you run out of session before finishing

This is allowed and expected for complex phases. It is better to stop cleanly than to rush.

- Mark the phase 🟨 **in progress** in `PHASE_STATUS.md`.
- Write exactly what's done and what's left — which files are touched, which are half-done, the next concrete step.
- Leave the repo type-checking and `npm run dev` starting, even if the new feature is partial or behind a flag.
- Do not advance the "Next phase to execute" pointer.
- Re-zip as normal, with the `NN-partial` name.

---

## 8. Re-zipping — exact command

From the project's parent directory:

```bash
zip -r quot3_phaseNN.zip quot3 \
  -x "quot3/node_modules/*" \
  -x "quot3/out/*" \
  -x "quot3/dist/*" \
  -x "quot3/release/*" \
  -x "quot3/coverage/*" \
  -x "quot3/test-results/*" \
  -x "quot3/playwright-report/*" \
  -x "quot3/.git/*"
```

Replace `NN` with the phase number just completed (or `NN-partial`). Never zip `node_modules` or build output. Always zip `package-lock.json`. Put the zip in `/mnt/user-data/outputs/` and present it.

---

## 9. Dependency versions — always check `DEPENDENCY_VERSIONS.md` first

**Before installing any package, read `DEPENDENCY_VERSIONS.md`.** It holds the exact pinned versions. Key rules (the reasons are in that file):
- **Node 22**, npm 10+. `.nvmrc` says 22.
- **Tailwind v3.4.x, not v4.**
- **Vite 7, not 8** (electron-vite 5 supports Vite ≤7).
- **TypeScript 5.9.x, not 7.**
- **`better-sqlite3` is a native module** — it must be rebuilt against Electron's ABI (`@electron/rebuild`); Phase 1 proves this works before anything else depends on it.
- **Phosphor Icons only.**

Always commit `package-lock.json`. Never delete it to "fix" an install issue. If `npm install` wants to change the lockfile unexpectedly, stop and flag it in `PHASE_STATUS.md`. **The pinned versions were looked up on the npm registry on 2026-10-07 but were not install-tested together** — Phase 1's first job is to run the real install and record any adjustment in both `DEPENDENCY_VERSIONS.md` and `PHASE_STATUS.md`.

---

## 10. Documentation duties every phase

- `PHASE_STATUS.md`: mark the phase done with the date; record deviations, decisions, known issues, standing gaps; confirm the next phase.
- `PROJECT_STRUCTURE.md`: if you introduced new structure, update it in place.
- `API_CONTRACTS.md`: any new or changed shared function, IPC channel, bridge method, or DB table must be reflected in place **before** you implement it (contract first, code second).
- `docs/reference/*`: if the owner changes a behavioural rule mid-project, edit the rule file in place and log the change in `PHASE_STATUS.md` (never silently).

---

## 10c. Milestone 8 supersessions (post-Phase-68)

Read `docs/MILESTONE8_DESIGN.md` before any Phase 70–91. Order is 70→91, then Phase 69 (release gate). Where this section conflicts with older docs, this section wins **only for the named phase and only when the stated setting is on**:
- Smooth arrows (`nav.smoothArrows`, default ON) amend D-K1 / D-K3 in `KEYBOARD_CELL_RULES.md` §11; OFF keeps the old behaviour exactly.
- Round-off: read the setting ONLY through the one shared bill-options read; never in a caller directly. Money stays decimal strings.
- Extra free cells and tail rows change `computeBill` (`tailRowCount`) and `sameContent`/`diffBills`; paper limits stay only in `paperConstants.ts`.
- Legacy import follows `docs/LEGACY_IMPORT_SPEC.md`. `docs/reference/legacy_import/Bills_JSON.zip` is private business data: never log, upload or embed its contents.
- Sync work follows `SYNC_POSTBOX_SPEC.md` §10. Never run against a real Supabase.
- Items marked [A] in `MILESTONE8_DESIGN.md` are unconfirmed assumptions; say so in your phase log.

## 10d. Milestone 9 supersessions (post-Phase-91)

Read `docs/MILESTONE9_DESIGN.md` before any Phase 92–106. Order is 92→106, then Phase 69 (release gate).
- Phase 92 first: store selectors must never return a fresh array/object (select the raw value, derive with `useMemo`, or use a shallow comparison). Treat any new selector that filters/maps inside `useXStore((s) => ...)` as a bug.
- Navigation: Dashboard is the root; Esc never goes behind it (`KEYBOARD_CELL_RULES.md` §12). Update the frozen shortcut tests only with this approval.
- Themes: every theme defines every token (parity test). Scrollbars and the title bar strip come from tokens. Glass/blur never on the grid. Print is never themed. Never hard-code a colour outside tokens.
- Extra-column Down key adds a tail row only in extra columns (D-K10); smooth arrows ON/OFF both tested.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.
- The owner's diagnostics (screenshots/logs) are evidence of what ran on a real Windows PC; your sandbox is not. Never write "verified" for what you did not run.

## 10e. Milestone 10 supersessions (item sorter)

Read `docs/ITEM_SORTER_SPEC.md` before any Phase 107–115. Order is 107→115, then Phase 69.
- Matching is pure `shared/items/*`, deterministic, explainable; numbers, sizes and units are protected tokens and are NEVER fuzzy-merged. Fuzzy matches are suggestions. No AI model in v1.
- The Items page never mutates bills; a merge only groups. Owner rules (`item_rules`) always win and are undoable.
- GST and non-GST sales are always shown separately (by the bill's format / line GST).
- Never put the owner's corpus contents into code, tests or logs beyond small invented examples; the real-corpus run is an optional local script.
- Apply the Phase 92 selector rule (no fresh arrays/objects from store selectors) to every new store.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.

## 10f. Milestone 11 supersessions (post-Phase-115)

Read `docs/MILESTONE11_DESIGN.md` before any Phase 116–127. Order is 116→127, then Phase 69.
- Bugs 116–121 are REPRODUCE-FIRST: write down what you could and could not reproduce; never write "fixed" or "verified" for clipboard, round-off, HD image or live APIs unless it ran on a real Windows window - say "needs the owner's PC".
- Create ALWAYS opens a clean bill (hard rule). This supersedes the Phase 70 resume/New-button assumption.
- Delete row and row reorder: extra-column cells stay on their row positions; one undo step; do not change the meaning of Delete on a single cell (D-K4).
- Dashboard live data: all network calls from the main process only; only the city and currency codes may leave the PC; never bills; cache and show 'offline'; no network in tests.
- Toasts: never stack identical messages; clear on page change.
- Apply the Phase 92 selector rule to every new store/selector.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.

## 10g. Milestone 12 supersessions (post-Phase-127): shared-notebook sync

Read `docs/MILESTONE12_DESIGN.md` and `docs/SYNC_SHARED_STORE_SPEC.md` before any Phase 128–143. Order is 128→143, then Phase 69 (release gate). Where this section conflicts with sections 2, 3, 4.6 or `SYNC_POSTBOX_SPEC.md`, this section wins **from the phase that builds the new behaviour** (Phase 140 cutover; v1 code is removed in Phase 142).
- All branches are equal. There is NO Main / Branch role and no read-only branch. The latest version wins whichever branch it came from (later skew-corrected `edited_at`); the losing version is always kept (server history + local revision). Never invent a hierarchy.
- No passphrase and no client-side encryption in the new engine. Readable bill/customer data lives on Supabase, protected by Supabase Auth, RLS (own organisation, select only), RPC-only writes, sign-ups disabled and TLS. The renderer still has no network and no secrets; the session and seat password are wrapped by `safeStorage`; logs and audit rows never contain keys, passwords or tokens. `service_role` never ships.
- The license key and the email/password logins are made by ONE SQL query (`qt_create_org`); the key is stored hashed only; results are shown once. Never commit or paste a real license key, password or anon key into the repo, tests, logs or chat summaries.
- Server phases (128–131) write SQL and static tests only. **Never run anything against a real Supabase from the sandbox.** "Works on Supabase" is a standing gap until the owner runs the checklist in `docs/SUPABASE_MIGRATIONS.md`; never write "verified" for it. Free-plan facts (Realtime limits, 7-day pause, no backups) must be re-read from Supabase's own page, or recorded as "not checked".
- Never edit a SQL file that has already been run (`01`–`06`, `90` and, once the owner has run them, `11`+); add a new numbered file. Functions whose argument list changes need `drop function` first.
- A reader older than a record's `min_reader_ver` sets the record aside ("Update the app to see N bills"); it never strips, overwrites or deletes it. Unknown optional fields are preserved.
- Customers: exact same normalised name = one customer automatically; similar names are NEVER merged automatically (Possible duplicates + Merge, with undo). No real customer names in code, tests or logs (counts only).
- Imported legacy bills reach other branches through normal sync (they are "only on this computer"); the backup-file "Join an existing branch" import stays a manual tool only.
- Apply the Phase 92 selector rule to every new store/selector.
- Items marked [A] are unconfirmed assumptions (`MILESTONE12_DESIGN.md` section 4); say so in your phase log.

## 10h. Milestone 13 supersession (Phase 144): print position

Phase 144 is REPRODUCE-FIRST. It may run before Phase 128. Measure the template's first-ink Y in headless-Chromium PDFs before changing anything; never write "fixed" or "verified" for real printer output (only the owner's paper test proves it); never log bill content. The template must stay top-aligned (page margin only, no vertical centring); Save PDF and Print must agree. Any Settings nudge is [A], default 0.

## 10i. Milestone 14 supersessions (Phases 145-153, release 0.1.7)

Read `docs/MILESTONE14_DESIGN.md` before any Phase 145-153. Order is flexible; Phase 69 runs AFTER Phase 153.
- Print fit-to-page (148) NEVER changes the paper thresholds (`paperConstants.ts`); it only scales within a cap, default ON, Off = today's output exactly; top-aligned rule of 10h stays.
- Stock transfer (149): free-text qty is allowed for THAT format only; no money maths; no party; picks a branch. Added via the format registry (rule 4.4), no format-name branches.
- Hybrid (150-152) deliberately EXTENDS rule 4.5: a bill may carry a second row set. Contract first (`API_CONTRACTS.md`), never lose data when switching, extra columns are shared, adjustments are separate per side, print/image/copy ask which side and output only that side. A migration, if any, is a new numbered file and the release notes' `schema: N` line covers it (`GITHUB_UPDATE_PUSH.md`).
- Toolbar names (147) hide on small screens; the 20-row density rule still wins.
- Some grid / paste / print / settings-page tests were already failing before this milestone (see the 0.1.5 entry in `PHASE_STATUS.md`); do not mistake them for your regressions without comparing against the previous zip.
- **TESTING RULE (owner, explicit): do NOT run the full test suite (`npm test` / bare `npx vitest run`) in any Phase 145-153 except the Phase 153 gate, and then only if the owner agrees.** Run `npm run typecheck` plus ONLY the test files you wrote or changed and the files that could plausibly conflict with your change (the same folder / the modules you import or edit, e.g. the print model tests for a print change, the format registry and grid tests for a format change, the settings page test for a Settings change). Name the files you ran in the phase log; anything you did not run is listed as not run. Never spend session time re-checking things twice.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.

## 10j. Milestone 15 supersessions (Phases 158-164, release 0.1.12): legacy watch

Read `docs/MILESTONE15_DESIGN.md` before any Phase 158-164. Phase 69 still runs after the last feature phase.
- The legacy importer gets a SECOND, content-based fingerprint (ignores the PO number); the old import fingerprint stays unchanged.
- Automatic import writes only through the normal bill write path (so the sync outbox is fed), one transaction per file, one `pre-import` backup per batch. No second sync path.
- Newest file mtime wins; an edited legacy copy updates the bill as a NEW REVISION (never a silent overwrite); a bill edited inside Quot3 after import is never overwritten (goes to Needs review). Nothing is auto-deleted; every automatic action is undoable.
- Background mode (login item, tray, close-to-tray) is OFF by default and controlled in Settings; `window-all-closed` / close guards must respect it; explicit Quit and update install still quit.
- Legacy JSON files are private customer data: never commit, never print contents; tests use synthetic fixtures. `docs/reference/legacy_import/Bills_JSON.zip` stays in `.gitignore`.
- A new migration (Phase 159) is a new numbered file; the release notes' `schema: N` line covers it.
- **TESTING RULE (owner, explicit): do NOT run the full test suite in any Phase 158-164 except the Phase 164 gate, and then only if the owner agrees.** Run `npm run typecheck` plus ONLY the test files you wrote/changed and those that could plausibly conflict (legacyImport, settings schema, ipc, outbox/sync, bill save). Name them in the phase log; list what you did not run. No repeated checking.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.

## 10k. Milestone 16 supersessions (Phases 165-172, release 0.1.14): Themes 2.0

Read `docs/MILESTONE16_DESIGN.md` before any Phase 165-172. Phase 69 still runs after the last feature phase.
- A theme is DATA, never code: no JavaScript, shader source, HTML or CSS text from a theme file may execute. Scenes (Three.js), shaders and animation presets live in the app; a theme only picks one by name with validated parameters. Hostile-value rules of `validateTheme` stay (no `url()`, caps, clamps); a v1 theme must keep validating unchanged.
- Every new token has a default in `tokens.css` and the parity test (every theme defines every token) stays green. Grid and print are never themed with blur / gradients / animation; effects pause when the window is hidden, honour reduce-motion and the master "Visual effects" switch; nothing on the keystroke path. Never claim a frame rate without a measurement on a real PC.
- Three.js is one pinned dependency (`DEPENDENCY_VERSIONS.md` first), lazy-loaded, no network / remote assets / `eval`; WebGL failure falls back to no background. Phase 169 adds the dependency but does NOT bump the version.
- Theme sharing (170-171) rides the Milestone 12 shared-notebook Supabase: new numbered SQL file only (never edit one that was run), RLS select-own-organisation, RPC-only writes, no `service_role`, never run against a real Supabase from the sandbox ("works on Supabase" is a standing gap). A received theme is validated like a local one; newest `edited_at` wins and the older version is kept; nothing is silently deleted; Sharing is OFF by default. No theme contents in logs.
- Apply the Phase 92 selector rule to every new store/selector.
- **TESTING RULE (owner, explicit, repeated on purpose): DO NOT RUN THE FULL TEST SUITE. Never `npm test`, never a bare `npx vitest run`, never the whole `src` folder: run ONLY the required tests. Do NOT run the full test suite in any Phase 165-172 except the Phase 172 gate, and then only if the owner agrees.** Run `npm run typecheck` plus ONLY the test files you wrote/changed and those that could plausibly conflict (theme validate / tokens / starter / themeService, settings schema, ipc, ThemesSection). No build, no dev server. Name them in the phase log; list what you did not run. No repeated checking.
- Theme authoring: `docs/THEME_CREATION_GUIDE.md` (+ `tools/check-theme.mjs`, `docs/themes/`) lets a Claude session turn the owner's description into theme JSON files. Keep it in step with the code: Phase 165 rewrites its section 8, Phases 167 and 169 extend it, Phase 172 confirms it.
- Items marked [A] are unconfirmed assumptions; say so in your phase log.

## 10l. Milestone 17 supersessions (Phases 173-188, releases 0.1.15-0.1.28 and 0.2.0): phone PWA

Read `docs/MILESTONE17_DESIGN.md` before any Phase 173-188. Phase 69 still runs after the last feature phase. Sections 2 and 3 above describe the DESKTOP app; the phone is an additive second target and does not change them (the words "Windows-only, desktop-only" stay true for the desktop app).
- Milestone 17 is additive. No desktop behaviour, schema, file or release step changes. Any change in shared code must keep every desktop test green (run the specific files that could conflict).
- The phone app never imports `electron`, `better-sqlite3` or anything from `src/main`. Phone code lives in `src/pwa/*` and `src/shared/*` only. Shared code stays pure.
- Phone data is IndexedDB only. No SQLite-wasm, no OPFS, no localStorage for bill data.
- Money is decimal strings via `src/shared/money.ts`; totals via `src/shared/calc`; paper thresholds only in `paperConstants.ts`; formats only through the registry (no format-name branching).
- No print, no clipboard image, no TSV copy, no AI features on the phone.
- Real Android behaviour is never "verified" from the sandbox. Everything about the real phone, the share sheet to WhatsApp, persistent storage, installability and Vercel deploys goes in Standing gaps until the owner confirms.
- Sync follows `docs/SYNC_SHARED_STORE_SPEC.md` unchanged (latest wins, loser kept, aside rule, no `service_role`, readable data protected by Supabase Auth + RLS). Never run against a real Supabase from the sandbox. Never commit keys, passwords or the anon key.
- Phone UI: compact first. No large padded cards. Use tokens, not hard-coded colours. Apply the Phase 92 selector rule to every store.
- **TESTING RULE (owner's standing rule, repeated): do NOT run the full test suite in any Phase 173-188 except the Phase 188 gate, and then only if the owner agrees.** Run `npm run typecheck` once plus only the files written or changed plus those that could plausibly conflict. Name them in the phase log. No desktop build, no dev server.
- Docs-only changes need no version bump and no tag. Each code phase bumps the version in `package.json` and both spots in `package-lock.json` as listed in `PHASES.md`.
- Items marked [A] are unconfirmed assumptions; say so in every phase log.

## 10m. Milestone 18 supersessions (Phases 189-196, releases 0.1.32-0.1.39): phone UI layouts

Read `docs/MILESTONE18_DESIGN.md` before any Phase 189-196. Phase 188 (M17 gate) and Phase 69 (release gate) are separate and still run. Sections 2 and 3 above describe the DESKTOP app; the desktop is not touched by this milestone.
- Three NEW phone layouts (`tidy`, `guided`, `inbox`) are switched by the phone setting `ui.layout` (default `classic`). **Classic is the current UI and must not change**: no edit to `src/pwa/ui/ui.css`, `tokens.css`, `themes.css`, `src/pwa/styles/pwa.css`; no change to classic screens. New code goes in NEW files only (`src/pwa/ui/layouts/*`, `src/pwa/ui/kit/*`). `classicParity.test.ts` (DOM snapshot + SHA-256 of the four CSS files) is created first in Phase 189 and runs in every later phase; never edit its snapshot or pins without the owner's approval.
- The layouts are views over the SAME data, sync, share, `*Model.ts` and `src/shared/*` code. Do not edit `src/shared/*` (in particular never change `shared/calc/billTotals.ts` output or the format registry labels: desktop grid, print and snapshots use them). Money is shown through `kit/display.ts` (Indian format over shared `fmtMoney`), never `toFixed`, never raw "12988.00", never number maths (rule 4.3). No format-name branching; plain-word renames are a phone display map keyed by column key.
- Switching layouts never loses or changes bill data and writes nothing to bills, parties, drafts or the outbox. `ui.layout` is a per-phone setting like `theme.name`: not synced, kept in the backup file, unknown value = `classic`.
- Phone only. Names and amounts are never truncated (no ellipsis, no nowrap) in the new layouts; names wrap, the editor name box grows while typing. Whether classic gets the same is an [A] opt-in (`ui.wrapNames`).
- Keep the owner rules in every layout: Create always opens a clean bill (A31), unsaved-changes guard (all guards stay in `App.tsx` above the layout choice), name required, drafts and recovery, share image / PDF only (no print), "Edit on PC" for hybrid and stock transfer, version gate and read-only shown (status pill in new layouts, never hidden).
- Tokens only, no raw colours; Phosphor icons only, no emoji; the larger tokens (16-17 px text, 17-18 px amounts, 48 px touch) are scoped to the new layouts only (`:root[data-layout=...]`). Apply the Phase 92 selector rule to every store / selector.
- Real Android behaviour (look, keyboard, text selection in the growing name box, the docked toolbar, share to WhatsApp, speed) is never "verified" from the sandbox; it goes in Standing gaps until the owner confirms (`docs/M18_DEVICE_CHECKLIST.md`).
- **TESTING RULE (owner's standing rule, repeated on purpose): DO NOT RUN THE FULL TEST SUITE. Never `npm test`, never a bare `npx vitest run`, never the whole `src` folder: run ONLY the required tests. Do NOT run the full test suite in any Phase 189-196 except the Phase 196 gate, and then only if the owner agrees.** Run `npm run typecheck` once plus ONLY the files you wrote or changed and those that could plausibly conflict (the files named in the phase entry and `src/__tests__/importBoundaries.test.ts`). No desktop build, no dev server. Name them in the phase log; list what you did not run. No repeated checking.
- Docs-only changes need no version bump and no tag. Each code phase bumps the version in `package.json` and both spots in `package-lock.json` as listed in `PHASES.md`.
- Items marked [A] are unconfirmed assumptions (`MILESTONE18_DESIGN.md` section 8); say so in every phase log.

## 11. Before you finish — checklist

- [ ] Only this phase's scope was touched
- [ ] Existing files edited in place wherever possible; any full rewrite is justified in `PHASE_STATUS.md`
- [ ] `npm run typecheck` passes and the phase's own tests / verify step actually ran (and anything not run is listed as a standing gap)
- [ ] No floating-point money math; no format-name branching; no hardcoded thresholds outside the constants file
- [ ] Renderer imports nothing from `electron`, Node built-ins, or `src/main`
- [ ] New shortcuts registered in `src/shared/shortcuts.ts` and visible in the command palette
- [ ] No emoji in any UI; no hardcoded colors, shadows or radii in components — tokens only
- [ ] `PHASE_STATUS.md` updated (done/partial, date, decisions, known issues, next phase)
- [ ] `PROJECT_STRUCTURE.md` and `API_CONTRACTS.md` updated in place if structure or contracts changed
- [ ] The whole project re-zipped per Section 8 and presented

Then hand the zip back. That's the end of your session's job.
