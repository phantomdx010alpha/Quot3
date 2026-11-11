# MILESTONE 21 — Page memory and PageUp / PageDown party paging (Phases 218–221)

Planned 2026-11-11 from the owner's request (chat after the Phase 216 gate, version 0.1.49). Docs only; nothing built or run. Desktop only: `src/pwa` is untouched. Read `docs/reference/KEYBOARD_CELL_RULES.md` sections 6, 8 and 12 first; they are binding and this milestone changes three things in them with the owner's approval recorded here.

## 1. What the owner asked for (verbatim intent)

1. "Correct page navigation": the app must remember which page you were on before (the previous page) and your position on it, so going back puts you exactly where you were.
2. "Page Up / Page Down in History, party bills or anywhere other than new party bill creation": the owner can step through the parties up and down with PageUp / PageDown.
3. Inside a bill that was OPENED from the History panel (or another list): PageUp / PageDown show the previous / next bill of that list directly, without going back to History first (owner's correction, 2026-11-11).

The new-bill (Create) screen is excluded on purpose: there PageUp / PageDown keeps its grid meaning (move one visible page, `KEYBOARD_CELL_RULES.md` section 4).

## 2. What exists today (read from the code, 2026-11-11)

- `src/shared/routes.ts`: `NavState.stack` (oldest first, entry 0 is always the Dashboard), `NAV_STACK_MAX = 3`, `navPush`, `navBack`. `navPush` resets the stack to `[dashboard, page]` except for a drill-down (`returnToCurrent`) from History / Customers / Items, which keeps `[dashboard, page, bill]`.
- `src/renderer/router/routerStore.ts`: in-memory router, `setLeaveGuard` (the Create Save / Discard / Cancel guard), `back()`.
- Esc is the global `nav.back` shortcut (`src/shared/shortcuts.ts`). Section 12 of the keyboard rules: Dashboard is the root, Esc on History / Customers / Settings goes to the Dashboard.
- Nothing remembers scroll, selection, filters or the active cell when a page is left. Components are remounted from scratch.
- PageUp / PageDown exist only inside the grid (one visible page).
- History components: `src/renderer/components/history/*` (BillList, DatesPanel, SearchBox, ...); Customers: `components/customers/CustomerList.tsx`; Items: `components/items/*`, `stores/itemsStore.ts`.

## 3. The page memory model (pure core first)

A `PageMemory` record per page path, kept in a renderer store (`pageMemoryStore`, in memory):

- `path`, `savedAt`
- `scrollTop` of each scrollable region of that page (a map region name -> number; History has a dates list and a bills list, Items has three windows)
- `selection`: what was selected, by ID, never by row number: `{ kind: 'bill' | 'party' | 'itemGroup' | 'date', id }`
- `filters`: the search text, date range, source filter and sort of that page
- `panels`: which side panels / sections are open (for example the revisions panel, the sales panel, the Settings section)
- for a bill that was open: nothing about the bill content (the bill itself is not stored here; the unsaved guard and drafts already exist)

Rules (all pure, tested in `src/shared/nav/__tests__/`):

1. IDs, not indexes. When restoring, if the remembered item no longer exists (deleted, trashed, synced away, filter changed) land on the nearest surviving neighbour by order, else the first item. Never throw, never show an empty selection if the list is not empty.
2. A memory is saved when a page is left (route change, Esc, opening a bill) and also on a short debounce while scrolling / selecting, so a crash loses little.
3. A memory is restored when the page is entered by Esc / back, by opening and returning from a bill, and by the Go-to shortcuts (Ctrl+0..4, Items, Games, Settings). Entering a page from the Dashboard tiles also restores unless the tile passes an explicit target.
4. Create is never restored by memory: Create always opens a clean bill (D-K15, hard rule). Memory for Create stores nothing.
5. The memory holds no bill data, no amounts, no party text beyond IDs and the user's own filter text. It is UI state: not synced, not backed up, no schema, no migration.
6. [A] In memory only (cleared when the app closes) in v1. A setting `nav.rememberAcrossRestart` (default false) may persist it into the local settings table; Phase 218 checks how the settings table is synced and keeps this key local-only. If a key would sync, the persistence is dropped.

## 4. The previous-page rule (supersedes part of section 12) [A]

Today `navPush` always resets to `[dashboard, page]`. New rule:

- The stack keeps ONE previous page: `[dashboard, previous, current]` (the existing `NAV_STACK_MAX = 3` already allows it). Going from History to Customers with Ctrl+3 gives `[dashboard, history, customers]`; Esc on Customers returns to History (with its memory restored); Esc on History goes to the Dashboard. The Dashboard is still the root and Esc never goes behind it; Esc on the Dashboard does nothing.
- Going to the Dashboard (Ctrl+0 or a Dashboard Esc) resets the stack to `[dashboard]`.
- Navigating to the page that is already the previous page just pops back to it (no `[dashboard, a, b, a]` growth).
- The Create leave guard and the drill-down `returnToCurrent` behaviour stay exactly as they are. A bill opened from History / Customers / Items still returns to that page first.
- This changes the Phase 94 rule "Esc on History / Customers / Settings: Dashboard" to "Esc returns to the previous page if there is one, otherwise the Dashboard". It needs the owner's word and the frozen test `src/shared/__tests__/routes.test.ts` is updated with that approval recorded in the Phase 219 log. The owner's request ("remembers which was the previous page") is read as that approval [A: unconfirmed until the owner says so].

## 5. PageUp / PageDown party paging

Where it works: every screen that is about parties or lists parties' bills, EXCEPT the Create screen. Until the owner says otherwise [A] that means:

| Screen | "Party in focus" | PageDown / PageUp |
|---|---|---|
| Customers list | the selected customer | next / previous customer in the list as sorted and filtered on screen |
| History with a party search or a party filter, or a party's bills view | the party being shown | switch the filter to the next / previous party in the Customers order; the bills list reloads for that party |
| Items page sales panel (who bought it) | the party of the selected sale | next / previous party in that sales list |
| History with no party in focus (the plain by-date list) | none | PageUp / PageDown keep their normal "scroll one page" meaning |
| Create (new bill) | n/a | unchanged: grid page up / down |
| A saved bill opened from a list (History first; also Customers' or Items' bill lists and sentence-search results) | the list it was opened from | **PageDown = the next bill of that list, PageUp = the previous bill, shown directly in place, without going back to the list** (owner's word, 2026-11-11). This is stepping through BILLS, not parties. Grid page-up / page-down inside such a bill moves to **Ctrl+PageUp / Ctrl+PageDown** [A]; Ctrl+Home / Ctrl+End and Ctrl+Up / Ctrl+Down still jump to the edges |

Order and edges:
- The order is the order the owner is looking at (current sort and filter of the Customers list). No wrap-around: at the first / last party the key does nothing and a quiet end marker shows (no stacked toasts).
- The party order is computed by a pure function (`shared/nav/partyPaging.ts`: `nextParty(list, currentId, dir)`), tested for: first, last, one party, empty list, current party missing from the list (nearest), filtered list.
- Each party opens at the position it was last left in (page memory, keyed by page + party ID).
- Unsaved edits: PageUp / PageDown in an opened saved bill with unsaved changes goes through the same Save / Discard / Cancel guard as Esc (D-K9). Plain paging screens have nothing unsaved, so no prompt. In an opened bill the keys act only while NO cell is being text-edited (Free or Append mode: Esc first), so a stray key never leaves a bill the owner is typing in [A].

### 5.1 Bill stepping (the opened-bill behaviour)

- When a bill is opened from a list, the app captures a `BillContext` for that session: `{ sourcePath, orderedBillIds }`, the FULL ordered, filtered list the owner was looking at (not only the rows rendered by the virtual list), plus the current bill ID. IDs only, no bill content.
- The order is the order on screen, flattened. In History that means the dates list and the bills inside each date in their on-screen sort, so PageDown at the last bill of a date continues with the first bill of the next date shown [A: Phase 220 first reads how History is organised and records it]. The active search, date range and source filter apply because the list is the filtered one. The Recently-deleted (trash) view is not stepped through [A].
- PageDown opens the next bill, PageUp the previous one, in the same bill view (the stack stays `[dashboard, history, bill]`; it does not grow). The bill opens at its top / first cell like any bill opened from History.
- No wrap-around: at the first / last bill the key does nothing and a quiet end marker shows ("last bill in this list").
- If a bill in the captured list was deleted, trashed or no longer exists, it is skipped. If the list is empty or the current bill is missing, the nearest surviving neighbour is used.
- Esc returns to the source list with page memory restored and the bill the owner is CURRENTLY viewing selected and scrolled into view (so after PageDown x5 and Esc, History highlights bill number 5 from where he started).
- A bill opened without a list (a Dashboard shortcut, a draft, a freshly saved bill) has no `BillContext`: PageUp / PageDown then keep the grid meaning. Create (new bill) never has a context.
- Pure function `shared/nav/billStepping.ts`: `stepBill(orderedIds, currentId, 'prev' | 'next')` returning `{ id, atEnd }`; tested for first, last, one bill, empty list, current missing (nearest), skipped missing IDs.

Focus and layers:
- The keys act only when focus is in the list or on the page body, never while typing in a text input, a dropdown, a dialog or a menu (the "close one layer first" rule of section 6 stays).
- `PageUp` / `PageDown` are registered as global actions `party.prev` / `party.next` (scope per screen) in `shortcuts.ts`; the conflict test, the cheat-sheet (F1) and the frozen section-8 test `shortcuts.test.ts` are updated in Phase 220. The frozen test changes only with the owner's approval, which this milestone records.
- Phase 220 FIRST reads how History and Customers show a party's bills today (the planning session did not trace the UI) and writes that finding into the phase log; if the real screens differ from the table above, it follows the owner's intent (step through parties) and lists the difference as [A].

## 6. Out of scope

Any change to bills, parties, items, print, sync, backup, the schema or Supabase. No phone changes. No new pages. No mouse back / forward buttons (a later idea).

## 7. [A] unconfirmed list (say so in every phase log)

- A1 Esc returns to the previous page (one level), Dashboard stays the root (section 4).
- A2 Memory is in memory only; restart persistence is an opt-in setting, default off.
- A3 The screen table in section 5, in particular History with no party in focus keeps normal PageUp / PageDown.
- A4 Inside a bill opened from a list, PageUp / PageDown step through the BILLS of that list (owner's word, 2026-11-11), in the on-screen order flattened across dates; the grid's own page-up / page-down there moves to Ctrl+PageUp / Ctrl+PageDown; the keys are inactive while a cell is being text-edited; no wrap; trash view is not stepped through.
- A5 No wrap-around at the ends of the party list.
- A6 Entering a page from a Dashboard tile restores its memory.

## 8. Test strategy

Pure logic first (`pageMemory`, `partyPaging`, the new `navPush` rule) with Vitest. UI wiring gets jsdom tests with the Phase 92 selector rule. No full suite: typecheck once plus the named files. Real keyboard feel (PageUp / PageDown repeat speed, focus after switching, scroll restore in a real window) is owed to the owner in `docs/M21_OWNER_CHECKLIST.md` (written in Phase 221) and is never written as verified from the sandbox.

## 9. Phases

218 contract and pure core · 219 page memory wired in and the previous-page rule · 220 PageUp / PageDown party paging · 221 QA gate (release gate, 0.1.50 [A]).
