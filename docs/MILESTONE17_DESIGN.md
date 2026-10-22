# Milestone 17 — Phone version (Android PWA on Vercel) (Phases 173–188)

Planned 2026-10-21 from the owner's request, after release 0.1.14. **Docs only: nothing was built, run or tested when this was written.** Ships as `0.1.15` ... `0.1.28` (invisible groundwork) and `0.2.0` (first public phone release). Version numbers are placeholders; renumber if phase 140b / 142 take patch numbers first.

**Items marked [A] are assumptions the owner has not confirmed. Items marked [CHECK] are facts nobody has verified; Phase 173 must check them on the owner's real phone.** Say "[A] unconfirmed" in every phase log.

**Testing rule (owner, repeated):** do NOT run the full test suite in any Milestone 17 phase except the final gate, and only if the owner agrees. Run `npm run typecheck` once plus the files you wrote or changed, plus the few existing files that could plausibly conflict. Name them in the phase log. No desktop build, no dev server.

---

## 1. What the owner wants (firm decisions)

1. Same repo, same folder. No new project, no fork, no new workflow. Upgrade the current directory and change the version.
2. Android through a **PWA only**, hosted on **Vercel**. No TWA, Capacitor, Play Store or native wrapper.
3. The phone keeps its data in **IndexedDB with persistent storage**. (No SQLite-wasm, no OPFS.)
4. The phone screen is **super compact and simple**. No AI features anywhere.
5. The phone can **create, edit and view bills**.
6. Output on the phone is **share image or share PDF only**. No print. Everything that only makes sense on a PC is dropped.
7. The desktop app is finished. Its behaviour must not change.

The owner's own words are in `docs/reference/REQUIREMENTS_ORIGINAL.md` ("Part A addendum 6").

---

## 2. What exists today (facts from the zip)

- Version 0.1.14. Electron + React 19 + TypeScript + Vite (electron-vite) + Tailwind v3 + Zustand + SQLite (better-sqlite3 + Drizzle). Phases 1–172 built. Phase 69 (release gate) still pending.
- The renderer talks only to `window.quot3`. SQLite repos (`src/main/db/*`) are synchronous. Services, sync and print/image live in `src/main/*`.
- `src/shared/*` is pure TypeScript (money, calc, units, paper rules, format registry, bill model, print model, sync codec/diff/pull, rich-text runs). No Node, no Electron, no DOM. This is what the phone reuses.
- Money is decimal strings (decimal.js). Formats are registry entries.
- Sync v2 (shared notebook): Supabase Auth email + password per seat, RLS, RPC-only writes, versioned records, latest `edited_at` wins and the loser is kept, `min_reader_ver` aside rule, Realtime doorbell + 60 s poll. Spec: `docs/SYNC_SHARED_STORE_SPEC.md`.
- **Prerequisite (Stage 0):** as of `PHASE_STATUS.md` at 0.1.14 the v2 engine is NOT wired into `main/index.ts` (phase "140b" pending), Phase 142 (retire v1) is partial, and the Supabase SQL (`11`–`17`) was never run on a real project. The phone needs working sync. Re-read `PHASE_STATUS.md` before starting: it may have been done since.
- Print / PDF / image copy are Electron-only. The print model and HTML builders are pure and reusable (`src/shared/print/*`, `paper/paperRules.ts`, `imageTrim.ts`).
- The desktop grid is built for a hardware keyboard (`KEYBOARD_CELL_RULES.md`). It does not suit a phone.

---

## 3. Design decisions

### 3.1 One repo, one version, two build targets
- Desktop build: unchanged (`electron-vite`, GitHub tag, Windows release).
- Phone build: a second Vite build, entry in `src/pwa/`, static output hosted by Vercel. No server functions for the core app.
- The phone has its **own small UI**. It reuses `src/shared/*`. It does NOT reuse desktop screens or Electron services.
- A tiny platform flag keeps shared code from importing Electron or IndexedDB. Desktop code paths do not change.

### 3.2 Data on the phone: IndexedDB
- One database (suggested name `quot3-phone`), versioned by IndexedDB's own upgrade step. Stores are in `docs/DATA_MODEL.md` ("Milestone 17 phone store", PLANNED).
- Ask for persistent storage (`navigator.storage.persist()`). Show a quiet storage note in Settings (persisted yes/no, usage). [CHECK] on the owner's Android Chrome, installed vs browser tab.
- Same data rules as desktop: money as decimal strings, UUID ids, soft delete, `revision` counter, `po_number` immutable once created, party snapshot on each bill.
- The whole data layer is NEW async code. Desktop repos are not reused. Port the rules (PO numbering, revisions, soft delete, drafts, totals cache), not the SQL.
- An IndexedDB helper library is optional. Decide in the phase that needs it; look the version up first (`DEPENDENCY_VERSIONS.md` rules). Tests may use an in-memory IndexedDB fake.
- Only one tab may write at a time (Web Locks or BroadcastChannel). [CHECK]
- Safety nets: sync is the real backup. Also a manual Export backup / Import backup file, and a reminder when the last export is old. No automatic folder backup (not possible on Android).

### 3.3 Phone scope: KEEP vs DROP

**KEEP (compact versions):**

| Feature | Phone treatment |
|---|---|
| Create / Edit / View bill | New compact editor (3.4). Same save rules: PO number from the phone's branch prefix, revision +1, party snapshot, new party auto-created for a new name. |
| Formats GST / non-GST | Simple toggle. Data is never lost when switching (rows are a superset). |
| Adjustments | Name + total, no qty/rate. Footer order: items total, adjustments, adjustments total, final total. |
| Total override, round-off flag | Supported. Round-off follows the per-bill flag and the shared bill-options read (never read the setting directly). |
| Extra columns (unit codes), units summary, Mark | Supported in a compact way. Rules: `EXTRA_COLS_UNITS_RULES.md`. |
| Rich text in item names (bold, red+bold) | Keep the data (runs) intact. B and R+B on selected text. Hardest touch feature; see Q4. |
| History | Date-grouped list, search (party, PO number, item text, amount), open read-only, edit, delete to trash, restore from Recently deleted. |
| Customers | List with bill counts, phone, search, tap to see bills, add/edit. Call / WhatsApp link allowed [A]. |
| Dashboard | Compact: today and month totals, recent bills, sync status, last export. No live tiles. |
| Sync (shared notebook) | The phone is its **own seat and own branch** [A] with its own branch name and PO prefix (unique per organisation). Same rules as desktop. |
| Settings (phone subset) | Company profile for professional output (name, phone, address, logo) — [CHECK] whether company settings sync today; if not, the phone has its own. Branch name + PO prefix, share defaults, sync login, storage/backup, app lock, About + version. |
| Share image / Share PDF | The only output (3.5). |
| Drafts / crash recovery | Autosave the open bill to IndexedDB; offer recovery on next open. Create always opens a clean bill (hard rule A31 stays). |
| Unsaved-changes guard | On Back/leave: Save / Discard. Name required before save. |
| Stock transfer and hybrid bills | **[A] View read-only on the phone, "Edit on PC" message.** The phone creates only GST and non-GST. |

**DROP (PC only, not built on the phone):** printing and the print dialog; Rough/Professional print buttons; save-PDF-to-disk dialog; copy image to clipboard; TSV copy and range copy/paste; the Excel-like grid and its keyboard model; shortcut sheet, command palette, keyboard shortcuts; calculator drawer; Items page (item sorter); party Excel import; customer duplicates / merge tools; legacy JSON import and legacy folder watch; background mode, tray, start at sign-in; automatic folder backups, restore-from-folder, Start fresh / wipe tools [A: keep only a simple "Reset phone data" with a double confirm]; auto-updater and "choose app version"; audit log viewer; diagnostics / crash files; Dashboard live tiles (weather, forex, metals, clock, holidays) and their network calls; Three.js scenes, effects, glass / animations, theme editor, theme sharing; hybrid and stock-transfer editing; revision compare screen [A]; multi-window.

### 3.4 The compact bill screen
Goals: very small, fast, thumb-friendly, no big padded cards, no AI.
- One screen for create / edit / view. One-line party bar at the top (name with autocomplete, phone, transport; address behind a small pull-down). Compact item list. Sticky totals strip at the bottom. One Save button. View mode is the same screen, read-only.
- Items are **compact rows**, not a spreadsheet: `# | name | qty | rate | total` on one line where the screen allows (long names wrap or ellipsis). Tap a row to expand a small editor with the same fields plus total override, GST %, and extra-column text. Numeric fields open the number keypad.
- "Add row" at the end, always visible. The keyboard Next/Done action moves name -> qty -> rate -> next row.
- Adjustments: a small "Add adjustment" action (name + amount, negative allowed).
- Extra columns: small text fields inside the expanded row; header names editable in a small "Columns" sheet; a "Units summary" button shows per-column unit totals and marked totals.
- GST / non-GST toggle in the top bar. GST columns show only for GST.
- Rich text: B and R+B on selected text in the name field. If the owner picks the simpler option (Q4), names are plain text on the phone and existing runs stay untouched unless the name text is edited.
- Density: as many rows as fit; no large headers; use the existing token system for colours (default navy/red + one light theme); touch targets at least 40 px without big padding.
- Totals use `src/shared/calc` (never floating point), identical to desktop.
- Android-keyboard safe: do not depend on `keydown` key names; use `input` / `beforeinput` and plain inputs. [CHECK] on a real phone (Phase 173).

### 3.5 Share output (replaces print and clipboard)
- Two actions on a saved or open bill: **Share image** and **Share PDF**. Each asks (or uses the saved default) for **Rough / Professional**. Professional includes the company block and PO number, as on desktop. Paper size comes from the existing paper rules (A5 default, A4 by the thresholds in `paperConstants.ts`). No new thresholds.
- Use the browser share sheet with a file (Web Share with files) so the owner can send straight to WhatsApp. Fall back to a normal download if sharing is unavailable. [CHECK] on the owner's phone.
- Image: render from the pure print model (cropped to content, crisp, table and rupee sign, bundled font). Method chosen in Phase 173 (canvas or SVG from the model). Do not depend on Electron capture.
- PDF: build from the same model. Method chosen in Phase 173 (PDF from the rendered page image, or a real text PDF with an embedded font that has the rupee sign). Page size from the paper decision.
- No print dialog, no clipboard image, no TSV copy on the phone.
- Share never changes the bill.

### 3.6 Sync on the phone
- Reuse the pure code in `src/shared/sync/*` and `SupabaseSharedTransport`. The push/pull workers, outbox, record state and aside storage are **re-implemented against IndexedDB** (the desktop ones are tied to SQLite).
- Login: seat email + password (as desktop); session kept in IndexedDB. Desktop uses OS secret storage; the phone has no equivalent, so use browser crypto with a non-extractable key and an **optional app lock** (PIN or device biometric). [CHECK] Do not claim it is as strong as desktop.
- The websocket (doorbell) sleeps in the background. Also pull when the app becomes visible, on network regain, after Save, at start, and every 60 s while open. Do not promise background sync.
- First sync downloads the whole notebook. The owner's data is large (about 1.9k legacy bills, about 12.9k customers per the docs). It needs a progress screen, a size check, and a decision (Q6): keep everything, or recent bills plus all customers. Never break `base_version` / aside rules.
- A free Supabase project pauses after inactivity: show "sync server paused or unreachable", not "no internet" (same as desktop).

### 3.7 Hosting on Vercel
- Static output, SPA fallback rewrite, correct headers for the service worker and manifest (service worker never long-cached), security headers and a CSP for the phone app. The Supabase URL is typed in Settings, so the CSP needs a safe way to allow it (e.g. a documented `*.supabase.co` wildcard, https and wss only). [CHECK]
- No secrets in Vercel. The anon key and URL are entered by the owner in the app, as on desktop.
- Production branch: see Q8 (default: a separate `pwa` branch until 0.2.0, so unfinished phone work cannot reach the live link). Other branches get preview URLs (optionally pointed at a scratch Supabase project).
- Installable: web manifest, icons (reuse the app icon), standalone display, offline shell via service worker. Update flow: "New version, reload" prompt; never swap code while a bill is unsaved.

### 3.8 Versions
- `0.1.15`, `0.1.16`, ... : invisible groundwork patches (phone code in new folders; desktop behaviour identical). Tag a desktop release only when the desktop actually changes. Docs-only changes: no tag.
- `0.2.0`: first public phone release (after the phone QA gate). `0.2.x`: phone improvements.
- One version number for both platforms (shown in phone About; used to name the service-worker cache).
- The desktop `schema: N` line counts `src/main/db/migrations/*.sql`; the phone has its own IndexedDB version and is NOT counted. If a future phase changes the synced record format, the existing `schema_ver` / `min_reader_ver` rules apply to the phone too.

---

## 4. Phases (summary; full entries in `PHASES.md`)

Stage 0 (prerequisite, not Milestone 17 work): finish 140b (wire the v2 sync engine), the owner's real-Supabase checklist (`docs/SUPABASE_MIGRATIONS.md`), Phase 142. Phone sync cannot be tested for real until then.

| # | Phase | Version |
|---|---|---|
| 173 | Contract + spikes on the owner's real phone (reproduce-first) | none |
| 174 | PWA shell + Vercel | 0.1.15 |
| 175 | Phone data layer 1 (IndexedDB, settings, persistence, backup file) | 0.1.16 |
| 176 | Phone data layer 2 (bills, PO number, revisions, drafts) | 0.1.17 |
| 177 | Phone parties | 0.1.18 |
| 178 | Phone sync 1: login and branch | 0.1.19 |
| 179 | Phone sync 2: push and pull | 0.1.20 |
| 180 | Mobile shell + Dashboard | 0.1.21 |
| 181 | History + view bill | 0.1.22 |
| 182 | Compact bill editor 1 | 0.1.23 |
| 183 | Compact bill editor 2 | 0.1.24 |
| 184 | Share image / PDF | 0.1.25 |
| 185 | Customers + Settings (phone subset) | 0.1.26 |
| 186 | Offline, install and update flow | 0.1.27 |
| 187 | Hardening | 0.1.28 |
| 188 | Milestone 17 QA gate + docs sweep | **0.2.0** |

Optional rollout [A]: release a "view, search, share" phone build after Phase 184 and editing after. Keep or drop.

---

## 5. [A] list (unconfirmed assumptions; owner may flip any)

1. The phone is its own seat and own branch with its own PO prefix.
2. The phone creates only GST and non-GST bills. Stock transfer and hybrid bills open read-only ("Edit on PC").
3. Extra columns: full support, compact.
4. Rich text: B and R+B on selection; fall back to plain text with preserved runs if Phase 173 shows it is unreliable on Android.
5. Revisions: a small cap of 5 per bill on the phone, no compare screen.
6. First sync: store everything if the measured size is fine; else recent-first.
7. App lock (PIN / biometric): optional, off by default.
8. Vercel production comes from a separate `pwa` branch until 0.2.0.
9. Share defaults: remember the last choice (rough / professional, image / PDF).
10. Company settings may or may not sync today ([CHECK] in code); if not, the phone enters its own.
11. "Reset phone data" tool allowed, with a double confirm.
12. Call / WhatsApp links from Customers allowed.
13. Optional staged rollout (view/search/share first).

## 6. [CHECK] list for Phase 173 (nobody has verified these)

- IndexedDB persistent storage grant on the owner's Chrome/Android (installed vs browser tab); eviction behaviour.
- Web Share with files to WhatsApp (image and PDF) on the owner's phone.
- Single-writer lock across tabs/windows (Web Locks or fallback).
- Which method renders the print model to a crisp image with the rupee sign on Android; which PDF method keeps text sharp and the file small.
- Android on-screen keyboard in the compact editor (Next/Done, number keypad, selection for B / R+B).
- Vercel CSP and headers that allow the user-entered Supabase URL and websocket.
- Size and speed of the first sync with the real corpus (counts only, no private contents).
- Whether `supabase-js` (with Realtime) fits the phone bundle budget.
- Whether company settings (name, address, logo) are synced between computers today.

## 7. Hard rules

See `CLAUDE_MUST_READ.md` section 10l. In short: additive only; phone code in `src/pwa/*` and `src/shared/*` only; IndexedDB only; no print / clipboard image / TSV / AI on the phone; money, calc, paper thresholds and formats only through the shared modules; real Android behaviour is never "verified" from the sandbox; sync follows `docs/SYNC_SHARED_STORE_SPEC.md` unchanged; never run against a real Supabase from the sandbox; never commit keys or passwords.

---

## 8. Spike results and decisions (Phase 173, written 2026-10-21)

**Status: spike page BUILT and run in the sandbox's headless Chromium only. The owner has NOT yet run it on the real phone, so every phone result below is OPEN.** Page: `docs/design/m17_spikes/index.html` (+ `README.md`). It must be opened over https (see its README).

### 8.1 Decided now (from the code, no phone needed)
- **Q10 answered: company settings are NOT synced.** The company block comes from the local setting `company.profile`, read by `resolvePrintSettings`; sync carries only the record kinds `bill`, `party`, `party_merge`, `item_rule` (`RECORD_KINDS` in `src/shared/sync/codecV2.ts`) plus themes. So the phone has its **own company profile entry** (name, phone, address, logo) and it does not match the desktop automatically. Phase 185 builds the phone entry. Syncing it would be a new record kind (separate decision, out of Milestone 17).
- **Print model is reusable as is.** `buildPrintModel(bill, mode, settings, decision)` and `decidePaper` are pure. `renderPrintHtml` returns one HTML string. Bundled font files exist in `resources/fonts` (Noto Sans latin / latin-ext, 400 and 700; latin-ext covers the rupee sign U+20B9).

### 8.2 Provisional choices (to be confirmed by the owner's spike report)
| Topic | Provisional choice | Why | Confirm on phone |
|---|---|---|---|
| Share image | Draw the `PrintModel` straight onto a canvas (no Electron, no DOM-to-image trick), bundled Noto Sans, 2x scale, crop with the existing `imageTrim` rule, export PNG | no dependency, rupee sign comes from our own font, same numbers as desktop | rupee sign, sharpness, WhatsApp receives a file |
| Share PDF | A one-page PDF holding the same high-resolution image, written by a tiny built-in PDF writer (spike measured about 56 KB for a 1000 px sample, valid in `pdfinfo`) | no library, guaranteed rupee sign, small | text is not selectable; owner decides if that matters. A real text PDF (embedded font) stays an option only if it does |
| Single writer | `navigator.locks` (Web Locks); `BroadcastChannel` fallback | simple, supported by Chrome Android | lock waits in the second tab |
| Keyboard | Plain inputs with `enterkeyhint="next"` and `inputmode="decimal"`; move focus on Enter keydown | the spike logs the actual `key` values so we can see if Android sends them | Next key works, number pad shows |
| Rich text | `contenteditable` name field with B and R+B buttons using the Selection API | Q4 default | selection survives the button tap, keyboard stays open |

### 8.3 Proposed Vercel headers / CSP for the phone app (UNTESTED on Vercel)
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Also `Cache-Control: no-cache` for `sw.js` and the manifest, long cache only for hashed assets, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Limits: a Supabase **custom domain** would be blocked (the owner uses the normal `*.supabase.co` URL today); `'unsafe-inline'` for styles is needed for React inline styles. Phase 174 writes `vercel.json` from this and the owner confirms the live page can sign in (step 7 of the spike page checks reachability).

### 8.4 Not measured (still open)
persistent storage grant and eviction (installed vs tab); share to WhatsApp (image and PDF); two-tab lock on the phone; Android keyboard events and selection; image look on a real Android screen; Supabase reachability from the phone and websocket; offline start; `supabase-js` bundle size (not measured: no install in this session); first-sync size and speed (Q6, needs counts from the real data); Q4 and Q9 stay on their defaults until the owner reports.

### 8.5 Sandbox-only numbers (NOT the real phone)
Headless Chromium (desktop): page ran with no script errors; IndexedDB wrote and read back 5 MB; `persist()` was denied (normal for headless); canvas draw showed the rupee sign, bold and red correctly (system fallback font, not Noto); the built-in PDF writer produced a valid 1-page PDF (419.5 x 260.1 pt, 55 691 bytes). None of this says anything about Android.

---

## 9. Hardening results (Phase 187, 2026-10-21)

**Sandbox numbers only (Node + jsdom + fake IndexedDB, synthetic names, counts from the docs: 1,900 bills of 3 rows, 12,900 customers). NOT a phone; a mid-range Android is several times slower. Test: `src/pwa/__tests__/hardening.test.ts`.**

| Step | ms |
|---|---|
| seed 12,900 customers / 1,900 bills (setup, not a user step) | about 500 / about 2,800 |
| History: read every bill + item text | about 55 |
| History search by party / PO / item / amount | 98 / 47 / 23 / 28 |
| Default History view (30 days) | about 6 |
| Customer directory load (12.9k) | about 96 |
| Autocomplete: first query (builds the Fuse index once) / later typed query / by phone digits | about 270 / about 60 / about 1 |
| Customers list with bill counts / filter | about 95 / about 20 |
| Dashboard | about 30 |

Findings: no slow path in the sandbox, so no speed code was changed. History and Customers draw one page (200 and 100 rows) of a huge list, so the DOM stays small. The first autocomplete query pays the one-time index build (about 0.3 s here, so likely 1 s or more on a phone): a later phase could build the index right after start [not done]. A bare number in the History search also matches the PO sequence (score 900 beats a party word), by design from Phase 42.

Accessibility and touch: `.q3-chip` was 32 px high, below the 40 px rule; now `var(--touch-min)`. A test now fails if any tappable class declares a `min-height` under 40 px, and scans Dashboard, History, Customers and Settings for buttons and inputs without a name. Not done: TalkBack, colour contrast measurement, focus order on a real phone.

Not done: Playwright mobile emulation (no browser binaries in the sandbox; the desktop e2e uses Electron only). The owner's checklist is `docs/M17_DEVICE_CHECKLIST.md`, unfilled.

