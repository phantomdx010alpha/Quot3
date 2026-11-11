# Milestone 21 — Owner's Windows checklist (page memory, Esc, PageUp / PageDown)

Handed over UNFILLED by Phase 221 (2026-11-11), release 0.1.50 [A]. Nothing below was run in a real Electron window: the sandbox ran one typecheck and named test files only. Real keyboard feel, focus and scroll restore are NEVER "verified" from the sandbox. Tick each line on a real Windows PC with the installed app and write what you see next to anything that is wrong.

Date checked: ____________  App version shown in Settings: ____________  Windows version: ____________  Screen size(s): ____________

## 1. What was built (from the code, not from a screen)

- Esc returns to the previous page (one level), then the Dashboard; it never goes behind the Dashboard [A, `docs/MILESTONE21_DESIGN.md` A1].
- History, Customers, Items, Settings and Games remember scroll, selection by ID, search text and open panels in memory only (lost on restart). Dashboard and Create store nothing.
- In a bill opened from History, a customer's bills or an item's sales: PageUp / PageDown show the previous / next bill of that list in place; Ctrl+PageUp / Ctrl+PageDown page that bill's grid. Create (new bill) is unchanged.
- On Customers, History with one party typed in the search box, and the Items sales window: PageUp / PageDown step through the parties (no wrap).
- Not built: the "remember across restart" switch (`nav.rememberAcrossRestart`); see row 25.
- No schema, sync, backup, print or bill-data change.

## 2. Page memory and Esc

| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | Dashboard, then Esc: nothing happens (Dashboard is the root) | [ ] | |
| 2 | Dashboard > History > Esc: back on the Dashboard | [ ] | |
| 3 | Dashboard > Customers > Esc: Dashboard. Same for Items, Settings, Games | [ ] | |
| 4 | Esc walk-through of every page: each Esc goes exactly one step back and never behind the Dashboard | [ ] | |
| 5 | History: scroll down, open a bill, Esc: History is at the same scroll with that bill highlighted | [ ] | |
| 6 | History > Customers > Esc: back on History (not the Dashboard) | [ ] | |
| 7 | History: type a search, set From / To, pick a source; go to Customers and Esc: all of them are still there | [ ] | |
| 8 | Customers: select a customer, scroll, go to Items and Esc: same customer, same scroll | [ ] | |
| 9 | Customers: open a customer's bills page, open a bill, Esc: back on that customer's bills page with the bill highlighted | [ ] | |
| 10 | Items: scroll each window, select a group and a sale, go away and Esc: same place | [ ] | |
| 11 | Settings: open a section, go away and Esc: the same section is open | [ ] | |
| 12 | Create (new bill) never restores anything: Dashboard > Create always starts a clean bill | [ ] | |
| 13 | Ctrl+0..4 and the Dashboard tiles open the page at its remembered place [A, A6] | [ ] | |
| 14 | A remembered item deleted meanwhile (delete a bill / customer after leaving the page, then return): lands on the nearest neighbour, no error | [ ] | |
| 15 | Esc from a bill never goes to another bill (only PageUp / PageDown move between bills) | [ ] | |
| 16 | Unsaved edits in Create: leaving still asks Save / Discard / Cancel as before | [ ] | |

## 3. Bill stepping (open a bill from History)

| # | Check | OK | What I saw |
|---|---|---|---|
| 17 | PageDown shows the next bill of the History list directly (no trip back to History); PageUp the previous | [ ] | |
| 18 | Stepping across a date change (last bill of one day to the first of the next) works | [ ] | |
| 19 | At the first and the last bill: one quiet end note, no wrap, no stacked notes when the key is held | [ ] | |
| 20 | With unsaved edits in the bill: PageDown asks Save / Discard / Cancel; Cancel keeps the same bill | [ ] | |
| 21 | While a cell is being edited (typing in a cell): PageUp / PageDown do not step the bill [A: "edited" = Free mode] | [ ] | |
| 22 | Ctrl+PageUp / Ctrl+PageDown page that bill's grid; plain PageUp / PageDown do not page it | [ ] | |
| 23 | Esc returns to History with the bill you are currently on highlighted and scrolled into view | [ ] | |
| 24 | A bill deleted meanwhile is skipped; the grid cursor and scroll look right after a step (not verified in code) | [ ] | |

## 4. Party paging and Create

| # | Check | OK | What I saw |
|---|---|---|---|
| 25 | Settings > Behaviour has NO "remember pages across restart" switch (not built); after a restart the pages start fresh | [ ] | |
| 26 | Customers: PageUp / PageDown move to the previous / next customer (one customer, not a page); no wrap at the ends | [ ] | |
| 27 | Customers > a customer's bills page: PageUp / PageDown switch customer | [ ] | |
| 28 | History with exactly one customer's name typed in the search box: PageUp / PageDown switch to the next customer with bills | [ ] | |
| 29 | History with no party in focus: PageUp / PageDown keep normal list paging | [ ] | |
| 30 | Items, Sales window: PageUp / PageDown move to the next party; other windows keep their own keys | [ ] | |
| 31 | No paging while typing in a search box, an open dropdown, a dialog or a menu | [ ] | |
| 32 | Create (new bill): PageUp / PageDown still page the grid, Ctrl+PageUp / Ctrl+PageDown are unchanged | [ ] | |
| 33 | F1 cheat-sheet shows the new hints (Bill opened from a list, Parties, Grid PageUp text) | [ ] | |
| 34 | Command palette lists the bill / party actions | [ ] | |

## 5. Standing gaps and known failures (not caused by Milestone 21)

- Real keyboard feel, focus after an in-place bill swap, grid scroll after a swap, History / Items party paging at store level, `usePagingKeys` DOM wiring and the F1 sheet rendering are covered only by code reading and pure-helper tests.
- Pre-existing failing tests (same result before Milestone 21, left alone): `historyPage.test.ts` "History order (Phase 146)"; 6 tests in `settingsPage.test.ts` (mock bridge has no `settings.get`); `phase92Selectors.test.ts` flags `components/dashboard/TodayTiles.tsx` line 176. Decide whether to fix them.
- Unconfirmed [A] items: `docs/MILESTONE21_DESIGN.md` section 7 (A1-A6) and the Phase 218-220 reading decisions in `PHASE_STATUS.md`.
