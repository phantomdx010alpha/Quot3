# Performance acceptance (Phase 68)

What was measured, the budgets, and how to repeat it on your own PC and on an installed build. Numbers from the build sandbox are in `PHASE_STATUS.md` -> "Performance log". **They are Linux / Node / jsdom numbers, not your PC.**

## Budgets (proposed by Phase 68 - you never stated these; change them in `src/shared/perf/acceptance.ts`)
Each is a p95. The keystroke budget (4.2 ms, `PERF_P95_BUDGET_MS`) is separate and is measured by the Phase 24 harness.

| Scenario | Budget |
|---|---|
| Reopen a database with 5 000 bills / 2 000 parties | 500 ms |
| Open + migrate a new database | 1 500 ms |
| Process start to window shown (installed app, from the log) | 3 000 ms |
| History: dates list / first page / deep page | 50 ms each |
| History: search over 5 000 bills | 250 ms (the box waits `SEARCH_DEBOUNCE_MS` first) |
| Customers: list + stats (2 000 parties) | 150 ms |
| Customers page search / party autocomplete per keystroke | 16 ms (one 60 Hz frame) |
| Save a bill into a 5 000-bill database | 100 ms |
| Print: build HTML for an 80-row bill | 100 ms |
| Print to PDF / copy as image (one real render) | 4 000 ms |
| Memory: heap growth after warm-up | 50 MB per hour |

## 1. The service-level run (any machine with Node 22 and `npm install`)
```
npm run perf:acceptance
```
Seeds 5 000 bills (12 rows each) and 2 000 parties into a temp SQLite file, times every scenario above, soaks for 20 s, prints PHASE_STATUS rows and an "OVER BUDGET" line. Nothing in your real data folder is touched. Options (environment variables): `QUOT3_PERF_BILLS`, `QUOT3_PERF_PARTIES`, `QUOT3_SOAK_SECONDS` (3600 = the one-hour soak), `QUOT3_PERF_OUT=file.md` (write the rows to a file), `QUOT3_CHROME=path` (a Chromium / Chrome binary; without one the PDF and image rows are skipped).
PowerShell: `$env:QUOT3_SOAK_SECONDS=3600; npm run perf:acceptance`.
This measures the database, search, calculation and print HTML. The PDF / image rows are a **Chromium command-line run** (browser start included), not Electron's `printToPDF` or the app's capture window. The soak measures the Node side only (no renderer, no Chromium memory).

## 2. Start-up time of an installed build
Every launch writes one log line `Start-up timing (ms since the process started)` with `app_ready`, `db_open`, `window_shown`, `page_loaded`. Find it in `%LOCALAPPDATA%\Quot3\logs\`. Compare `window_shown` with the 3 000 ms budget. Measure the second launch (the first one after installing is cold).

## 3. Real keystroke -> paint (the Phase 24 harness) on the release build
The perf harness is in every build (it is not stripped from release): palette (Ctrl+K) -> "Open perf harness (dev)" -> Run all -> "Copy as PHASE_STATUS rows". Use a 240 Hz display if you have one; on 60 Hz judge p95 against the logic row too.

## 4. Real-window memory soak (renderer + Chromium)
Open Task Manager -> Details, note the memory of the Quot3 processes, use the app normally (create, save, switch pages, open History and Customers, copy an image) for an hour, note it again. Growth that keeps climbing after the first 10 minutes is worth reporting. Nothing in this repo automates this.
