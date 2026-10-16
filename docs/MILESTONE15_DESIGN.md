# Milestone 15 — Legacy watch: background app + automatic legacy import (Phases 158–164)

Planned 2026-10-16 from the owner's request and a read-only study of a sample legacy JSON folder (779 files; private customer data, never committed or printed). Ships as version **0.1.12** (Phase 164). Anything the owner did not state is marked **[A]** (unconfirmed assumption: say so in the phase log). Phase 69 (RELEASE GATE) still runs AFTER the last feature phase. Independent of Milestone 14; needs the existing legacy importer (Phases 56-60 area, `docs/LEGACY_IMPORT_SPEC.md`) and the shared-notebook sync (Milestone 12).

**Testing rule (owner, explicit):** no full test-suite runs in this milestone (see `CLAUDE_MUST_READ.md` 10j). `npm run typecheck` plus ONLY the test files you wrote/changed and the ones likely to conflict. Name them in the phase log; list everything not run. No "double or triple checks".

## 1. What the owner wants

The other branch keeps using the legacy software, which writes one JSON file per bill into a folder. Quot3 must (a) start with Windows and keep running in the background, (b) watch the chosen legacy folder, (c) add new bills to its OWN SQLite first, then (d) let the normal sync push them in the background so the bills appear on the owner's other PCs. Everything is controlled from Settings.

Owner decisions: the newest file time wins among copies of one bill; when a legacy edit is detected the Quot3 bill is updated in place; uncertain matches go to a "Needs review" list in Settings; nothing is ever auto-deleted and every automatic action is undoable.

## 2. The legacy software's bugs we must handle (measured on the sample)

- Same bill saved again under a different PO number (usually the next one, gap 0-1): 64 exact-duplicate groups covering 142 files.
- The copy is then edited (items added/removed/renamed, qty/rate changes, adjustments-only, phone/transport-only): 183 same-party same-day related pairs, about half identical and half edited.
- 19 bill numbers are used by more than one file (the existing same-number clash rules still apply to new bills).
- Same party + same day can still be DIFFERENT bills (5 groups): matching must use item lines, not only party + date.
- No near-duplicates for the same party on different dates.

## 3. Design rules

1. **New content fingerprint** (does not replace the existing import fingerprint, which includes `bill_no`): SHA-256 of normalised party + ISO date + sorted item lines (normalised name, qty, rate) + adjustments. The PO number is NOT part of it.
2. **Classification** of an incoming file against existing bills, in this order: exact duplicate (same content fingerprint) -> skip + log; same bill edited (same normalised party AND same date AND at least 50% of item lines shared by normalised name) -> update path; uncertain (same party + date but under 50% shared, or two candidate bills) -> Needs review; otherwise new bill. The 50% threshold is a constant [A].
3. **Update path:** the newest file mtime wins. Incoming newer than the stored legacy source -> update the existing Quot3 bill in place as a new revision (old version stays in history; the bill keeps its own number). Incoming older -> ignore + log. If the Quot3 bill was edited inside Quot3 after import -> never overwrite; send to Needs review [A: detect with the bill's revision author/time or a "locally edited" marker, decided in Phase 159].
4. **Order:** apply files oldest-mtime first so results never depend on scan order.
5. **Writes** go through the normal bill write path (so the sync outbox gets them) inside one transaction per file, with ONE `pre-import` safety backup per batch. If sync is not active the import still works and the status says "sync is off". No second sync path.
6. **Watcher:** `fs.watch` for speed AND a timed rescan (default 2 min [A]) AND a scan on wake, because `fs.watch` is unreliable on shared/synced folders on Windows. Skip files that are still changing (size/mtime unstable) or do not parse yet; retry next scan. A state table remembers file name, size, mtime, content hash, last result and mapped bill id, so unchanged files are never re-read.
7. **Background mode:** Settings toggles "Start Quot3 when I sign in to Windows" (`app.setLoginItemSettings`, started hidden) and "Keep running in the background when the window is closed" (tray icon: Open / Pause watching / Quit; closing hides the window). Single-instance lock stays; a second launch shows the window. `powerMonitor` resume/unlock triggers a rescan. All OFF by default for existing installs. The app only runs while someone is signed in to Windows.
8. **Needs review + Activity:** a Settings list (legacy file, party, date, total, candidate Quot3 bill(s), reason) with "Import as new bill", "Replace existing bill with this", "Ignore"; an Activity log (last 200 events) with Undo for automatic imports/updates. Nothing deleted, every action reversible.
9. **Privacy:** the legacy folder is private customer data. Tests use small synthetic fixtures only (counts-only checks against the real sample if the owner attaches it). `docs/reference/legacy_import/Bills_JSON.zip` stays in `.gitignore`.
10. **Rules kept:** format registry (no `if (format === ...)`), Phase 92 selector rule, money as decimal strings, Zod-validated IPC through `window.quot3`, renderer imports nothing from Electron/Node/main, Windows-only, tokens only in UI.

## 4. Standing gaps (only a real PC can show these)

Start at Windows sign-in, tray and close-to-tray, watching the real shared folder, and sync against the real Supabase (sync has never been exercised against a real project from the build sandbox: treat "bills arrive on the other PCs" as the first thing to verify on 0.1.12).

## 5. Order

158 -> 159 -> 160 -> 161 (can run any time after 158) -> 162 -> 163 -> 164. Each phase is small enough for one session.
