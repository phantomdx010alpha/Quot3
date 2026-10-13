# PROJECT_STRUCTURE — Quot3

**Edit in place as new structure is legitimately introduced by a phase. Do not regenerate wholesale.**
This is the **target** layout. Not everything exists yet — `PHASE_STATUS.md` says what has actually been created; `PHASES.md` says which phase introduces which piece. Items marked `(Phase N)` are introduced by that phase.

```
quot3/
├── CLAUDE_MUST_READ.md            # read first, every session
├── MASTERPLAN.md
├── PHASES.md
├── PHASE_STATUS.md                # ground truth; append-only edits
├── API_CONTRACTS.md               # frozen contracts (shared fns, IPC, bridge)
├── PROJECT_STRUCTURE.md           # this file
├── DEPENDENCY_VERSIONS.md         # LOCKED package versions
├── README.md                      # human quick start
├── .nvmrc  .gitignore  .npmrc(Phase 1)  .editorconfig(Phase 1)
├── package.json  package-lock.json                       (Phase 1)
├── electron.vite.config.ts                                (Phase 1)
├── tsconfig.json  tsconfig.node.json  tsconfig.web.json   (Phase 1)
├── tailwind.config.js  postcss.config.js                  (Phase 1)
├── vitest.config.ts                                       (Phase 1)
├── electron-builder.yml                                   (Phase 64)
├── playwright.config.ts                                   (Phase 66 ✅ one worker, no retries, tests-e2e/**/*.e2e.ts)
├── tsconfig.e2e.json                                      (Phase 66 ✅ type-checks tests-e2e + playwright.config.ts; part of `npm run typecheck`)
│
├── docs/
│   ├── DATA_MODEL.md              # SQLite schema contract
│   ├── SYNC_POSTBOX_SPEC.md       # Supabase postbox design (v1; history after Phase 142)
│   ├── SYNC_SHARED_STORE_SPEC.md  # (Milestone 12) shared-notebook sync, binding for Phases 128–143
│   ├── MILESTONE12_DESIGN.md      # (Milestone 12) why, owner decisions, assumptions, cutover plan
│   ├── SUPABASE_MIGRATIONS.md     # (Phase 51) applied SQL log
│   ├── design/DESIGN_TOKENS.md
│   ├── security/SECURITY_MODEL.md
│   └── reference/
│       ├── REQUIREMENTS_ORIGINAL.md
│       ├── KEYBOARD_CELL_RULES.md
│       ├── UNDO_REDO_RULES.md
│       ├── PAPER_ENGINE_RULES.md
│       ├── EXTRA_COLS_UNITS_RULES.md
│       └── legacy_app/            # screenshots of the owner's current app
│           ├── legacy_create_screen.png
│           └── legacy_history_screen.png
│
├── supabase/
│   └── sql/                       # (Phase 51) numbered SQL files: 01_licenses.sql, 02_branches.sql, 03_postbox.sql, 04_rpcs.sql, 05_sweep.sql
│                                  # (Milestone 12) WRITTEN Phases 128-130: 11_members_branches, 12_records, 13_rls, 14_license_admin, 15_rpcs (sn_* RPCs); PLANNED: 16_realtime, 91_selftest_v2, 99_drop_v1 (owner-run)
│
├── resources/                     # packaged with the app
│   ├── icons/                     # (Phase 63 ✅) icon.ico (16-256), icon-256.png, icon-512.png, source-original-1024.jpg (owner upload, untouched)
│   └── fonts/                     # (Phase 33 ✅) noto-sans-{latin,latin-ext}-{400,700}-normal.woff2 (₹ is in latin-ext) + OFL-NotoSans.txt; renderer dev preview imports them via src/renderer/print/fontUrls.ts
│
├── src/
│   ├── shared/                    # PURE TypeScript — no electron, no node:*, no DOM
│   │   ├── money.ts                         (Phase 6)   decimal.js wrapper, rounding, formatting
│   │   ├── types.ts                         (Phase 6/8) Bill, BillRow, ExtraColDef, Party … shared types
│   │   ├── ipc.ts                           (Phase 2)   Result/ErrorCode/AppInfo/Quot3Bridge (zod-free)
│   │   ├── theme/{tokens,validateTheme,contrast}.ts (Phase 3)  token whitelist + clamps, theme validation, WCAG helpers
│   │   ├── constants.ts                     (Phase 1+)  UNDO_MAX_DEPTH, TRASH_RETENTION_DAYS … (not paper limits)
│   │   ├── shortcuts.ts                     (Phase 4)   single shortcut registry (ACTIONS + SHORTCUTS + matcher)
│   │   ├── (main/services/seedHistory.ts   Phase 32 ✅ dev/test `seedHistoricalBills(svc, sqlite)`; src/__tests__/createFlow.integration.test.ts + tsconfig.integration.json (DOM + node types) hold the Create-page end-to-end QA)
│   │   ├── outputActions.ts                 (Phase 30 ✅) table of the 5 bottom-bar output actions; shared/tsv/billTsv.ts (Phase 31 ✅ whole-bill TSV/HTML) (label, implementing phase) → disabled reason / tooltip; renderer: stores/outputActions.ts `runOutput` (stub toast), tests components/create/__tests__/bottomBar.test.ts
│   │   ├── commandSearch.ts  routes.ts      (Phase 4)   palette fuzzy search; route table + pure history stack
│   │   ├── calc/
│   │   │   ├── classifyRow.ts               (Phase 6)
│   │   │   ├── rowCalc.ts                   (Phase 6)
│   │   │   ├── billTotals.ts                (Phase 6)
│   │   │   ├── expression.ts                (Phase 82 ✅) calculator engine `evaluateExpression` (no eval); tests calc/__tests__/expression.test.ts
│   │   │   ├── percentPresets.ts            (Phase 82 ✅) `calc.percentPresets` parse / validate / `percentResults`
│   │   │   ├── calcPanel.ts                 (Phase 83 ✅) drawer prefs, grand total read, display text; tests calc/__tests__/calcPanel.test.ts
│   │   │   │   (renderer, Phase 83: stores/calcPanelStore.ts, components/create/CalcDrawer.tsx + __tests__/calcDrawer.test.ts)
│   │   ├── legacyImport/                (Phase 84 ✅) pure legacy-bill importer: sha256.ts, parse.ts, convert.ts, plan.ts, index.ts; tests __tests__/legacyImport.test.ts + corpus.ts (reads the private zip, skipped when absent)
│   │   │   └── billOptions.ts               (Phase 76 ✅; Phase 77 wired) THE one options read `getBillOptions(bill)`; tests calc/__tests__/roundOffWiring.test.ts (callers agree + grep guards), main/services/__tests__/billServiceRoundOff.test.ts; Phase 79 adds `tailRowCountOf` + `tailRowCount` (tests calc/__tests__/freeCellsModel.test.ts, main/services/__tests__/billServiceFreeCells.test.ts); migration `main/db/migrations/0003_bill_free_cells.sql`
│   │   ├── units/
│   │   │   ├── parseUnits.ts                (Phase 7)
│   │   │   ├── summarizeUnits.ts            (Phase 7; Phase 80: optional `free` cells continue the last segment in display order)
│   │   │   └── index.ts                     (Phase 7)  barrel
│   │   ├── format/
│   │   │   ├── registry.ts                  (Phase 8)
│   │   │   ├── nonGst.ts                    (Phase 8)
│   │   │   ├── gst.ts                       (Phase 8)
│   │   │   └── index.ts                     (Phase 8)  barrel
│   │   ├── billModel.ts                     (Phase 8)  createEmptyBill / normalizeBill / (de)serialise / withFormat
│   │   ├── freeCells.ts                     (Phase 80 ✅) pure helpers for extra-column free cells: `fx:` / `tr:` row ids, nav ids, edit / trim / mark / strip; tests shared/__tests__/freeCells.test.ts
│   │   ├── gridModel.ts                     (Phase 9)  grid view-model: columns, body/footer split, trailing blanks, structural sharing
│   │   ├── gridEdit.ts                      (Phase 11 ✅) pure cell-edit helpers
│   │   ├── nav/cellNav.ts                   (Phase 10 ✅) pure navigation/edit-mode reducer (+ nav/__tests__/cellNav.test.ts)
│   │   ├── richtext/runs.ts                 (Phase 14 ✅) run model + toggle bold/red/highlight, applyEdit, applyTextChange
│   │   ├── richtext/format.ts               (Phase 15 ✅) FormatKind + applyFormat (shared by keys/toolbar/palette), hasStyle
│   │   ├── history/undoStack.ts             (Phase 17 ✅) stacks, coalescing, jumpTo; history/billDoc.ts (✅) undoable doc, row-level Immer patches, dirty equality; history/historyView.ts (Phase 18 ✅) panel rows, tooltips, notices
│   │   ├── paper/
│   │   │   ├── paperConstants.ts            (Phase 36)  THE ONLY place for 40/30/80/70 and A5 limits
│   │   │   └── paperRules.ts                (Phase 36)  decidePaper()
│   │   ├── print/printModel.ts              (Phase 33 ✅) buildPrintModel → PrintModel (pure); printConstants.ts (page/margins/fonts/width budget); template/printCss.ts + renderHtml.ts (pure PrintModel → HTML, shared by preview/print/PDF/image); __tests__ + snapshots
│   │   ├── __fixtures__/printLogo.ts        (Phase 34 ✅) sample wide/tall SVG data-URL logos
│   │   ├── paper/paperTypes.ts              (Phase 33 ✅) PaperDecision type + simplePaperDecision
│   │   ├── paper/paperConstants.ts          (Phase 36 ✅) A5_MAX_ROWS / A4_MAX_ROWS — the only home of 40/30/80/70
│   │   ├── paper/paperRules.ts              (Phase 36 ✅) decidePaper(), pagesFor()
│   │   ├── print/printFlow.ts               (Phase 37 ✅) decideForBill, resolvePrintSettings, overflow geometry + MEASURE_SCRIPT, printDialogKey (+ __tests__/printFlow.test.ts); (Phase 38 ✅) PDF_OPTIONS, pdfFileName, isPdfPath, countPdfPages, dialog key S (+ __tests__/pdfFlow.test.ts)
│   │   (Phase 38 also: main/print/electronPdfFiles.ts (Save dialog / fs / shell), PrintPort.toPdf in electronPrintPort.ts, PrintService.pdf/openPdf + PdfFilePort in main/services/printService.ts (+ __tests__/printServicePdf.test.ts), print:pdf / print:openPdf in main/ipc/print.ts (+ __tests__/printPdf.test.ts), main/print/__tests__/pdfExport.test.ts (real headless Chromium + poppler), renderer printActions.savePdf/openLastPdf, PrintDialog Save PDF button, components/create/__tests__/printPdf.test.ts)
│   │   (Phase 37 also: main/services/printService.ts (+ __tests__), main/print/electronPrintPort.ts, main/ipc/print.ts (+ __tests__/print.test.ts); renderer stores/printUiStore.ts + printActions.ts, components/create/PrintDialog.tsx (+ __tests__/printDialog.test.ts), mounted in components/layout/AppShell.tsx)
│   │   ├── paper/__tests__/                 (Phase 36 ✅) paperRules.test.ts (§6 matrix + property sweeps), paperConstants.test.ts (literal guard)
│   │   ├── __fixtures__/printBills.ts       (Phase 33 ✅) 7 named print fixtures (legacy, gst, adjustment, extraCols, longText, styled, rows40)
│   │   ├── diff/billDiff.ts                 (Phase 44 ✅) diffBills / describeDiff / sameNumber (pure); revisions.ts (Phase 44 ✅) RevisionSummary / RevisionDetail / RestoreDraft / previousRevision / formatRevisionTime
│   │   ├── trash.ts                          (Phase 43 ✅) TrashItem, purgeAt/daysLeft/trashCutoff, sanitizeRetentionDays, EMPTY_TRASH_WORD + isEmptyTrashConfirm, formatDeletedAt/formatPurgeIn; main: db/trashRepo.ts (only SQL: list/restore/hard delete/audit) + services/trashService.ts (list, restore, purge, emptyTrash, autoPurge) + ipc/trash.ts (+ __tests__/trashService.test.ts on real SQLite); renderer: stores/trashStore.ts (view state + 10 s undo offer), stores/trashActions.ts, components/history/{TrashView,UndoDeleteBar}.tsx (+ __tests__/trashView.test.ts)
│   │   ├── partyImport/partyImport.ts        (Phase 47 ✅) header aliases, autoDetectMapping, detectHeaderRow, valueToText, planImport (duplicate / update rules), describeReport + preview / report types (pure)
│   │   ├── dashboard/dashboardStats.ts       (Phase 46 ✅) DashboardStats, buildDashboardStats (decimal day / week / month sums), addDays, topCustomers, sparklinePoints, formatBackupTime; main: db/dashboardRepo.ts (only SQL) + services/dashboardService.ts (+ latestBackupTime) + ipc/dashboard.ts (+ __tests__/dashboardService.test.ts on real SQLite); renderer: stores/dashboardStore.ts + dashboardActions.ts, pages/Dashboard.tsx, components/dashboard/{StatTile,Sparkline,DashList}.tsx (+ __tests__/dashboardPage.test.ts), styles `.q3-stat*` / `.q3-spark*` / `.q3-dashlist*` in ui.css
│   │   ├── settings/appSettings.ts           (Phase 48 ✅) company / logo-bytes / PO-prefix / behaviour / print-default rules + AppSettingsState (pure); main: db/branchRepo.ts (only SQL) + services/appSettingsService.ts + ipc/appSettings.ts + import/electronSettingsPorts.ts; renderer: stores/settingsStore.ts + behaviourStore.ts, pages/Settings.tsx, components/settings/{Company,Branch,Print,Behaviour}Section.tsx, styles `.q3-set*` in grid.css (tests: shared/settings/__tests__, services/__tests__/appSettingsService.test.ts, components/settings/__tests__/settingsPage.test.ts)
│   │   ├── settings/uiPrefs.ts               (Phase 49) row height / grid font size preference rules
│   │   ├── theme/starter.ts                  (Phase 49) starter theme file from live token values
│   │   ├── theme/preview.ts                  (Phase 103) swatch colours for the theme picker (built-in table + custom-theme overrides); __tests__/themePreview.test.ts = swatch/tokens.css parity + theme QA scan
│   │   ├── shortcutList.ts                   (Phase 49) shortcut viewer rows + search (Phase 67: + CONTEXT_KEY_HINTS for the F1 sheet)
│   │   ├── backup/backupRules.ts             (Phase 50) backup names / kinds / retention / typed words
│   │   ├── customers/customerList.ts         (Phase 45 ✅) CustomerRow, aggregateCustomerStats (decimal sums), searchCustomers (party index + address), addressPreview, validateCustomerInput; main: db/customerRepo.ts (only SQL for stats + a customer's bill page + audit) + db/partyRepo.ts (softDelete, findByNormExcept) + services/customerService.ts + ipc/customers.ts (+ __tests__/customerService.test.ts on real SQLite)
│   │   ├── history/historyList.ts            (Phase 41 ✅) BillListItem/HistoryDate/HistoryBranch, formatHistoryDate (DD-MM-YY), formatHistoryTotal (₹ Indian), keyset cursor, moveListIndex; main: db/historyRepo.ts (only SQL for the History lists) + services/historyService.ts + ipc/history.ts (+ __tests__/historyService.test.ts: 500-bill perf, paging, trash, branch); renderer: stores/historyStore.ts, pages/History.tsx, components/history/{DatesPanel,BillList,HistoryHeader}.tsx (+ __tests__/historyPage.test.ts), styles in grid.css `.q3-hist*`
│   │   ├── party/partyLite.ts, fuzzy.ts, sampleParties.ts (Phase 26 ✅) PartyLite, normalizePartyName, isNewParty; Fuse index with tier ranking + phone-digit search; 30 dev sample parties
│   │   ├── tsv/tsvCodec.ts                  (Phase 16 ✅) parseTsv / formatTsv / looksLikeTsv
│   │   ├── tsv/gridClip.ts                  (Phase 16 ✅) Quot3 clipboard flavour, planPaste, describePaste
│   │   (also Phase 16: main/ipc/clipboard.ts `clipboard:readGrid`; renderer/stores/historyHooks.ts — Phase 17 hook point; copy/cut/paste/mouse-drag live in components/grid/gridController.ts, no separate useGridClipboard.ts)
│   │   ├── __fixtures__/                    (Phase 6+)  `bills.ts` (row builder, 18-row legacy screenshot bill), `formats.ts` (STUB GST/non-GST FormatDefs until Phase 8's registry); later: ruby/tomato, 40/41/80/81-row bills, long names
│   │   ├── __fixtures__/historicalBills.ts  (Phase 32 ✅) `historicalBills()` — 30 deterministic bills (both formats, extras+marks, adjustments, styled/long names, paper override)
│   │   └── **/__tests__/*.test.ts
│   │
│   ├── main/                      # Electron main process (Node)
│   │   ├── security.ts                      (Phase 2)   CSP strings, isTrustedUrl
│   │   ├── index.ts                         (Phase 2)   app lifecycle, userData override, single instance
│   │   ├── window.ts                        (Phase 2)   BrowserWindow factory, CSP, navigation guards
│   │   ├── paths.ts                         (Phase 2)   %LOCALAPPDATA%\Quot3 layout
│   │   ├── logger.ts                        (Phase 2)
│   │   ├── ipc/
│   │   │   ├── register.ts                  (Phase 2)   registers all handlers
│   │   │   ├── envelope.ts                  (Phase 2)   {ok,data}|{ok:false,error}
│   │   │   └── <ns>.ts                      (per phase) settings, parties, bills, drafts, history, customers, print, image, clipboard, backup, themes, sync, partyImport, license, app
│   │   ├── db/
│   │   │   ├── connection.ts                (Phase 5)   open, pragmas, migrate, pre-migration backup
│   │   │   ├── migrate.ts  seed.ts          (Phase 5)   journal-driven runner (user_version guard); local-branch seed
│   │   │   ├── poCounter.ts  settingsRepo.ts (Phase 5)  atomic PO allocation; raw settings table access
│   │   │   ├── __tests__/helpers.ts         (Phase 5)   openTestDb() temp-file DB per test
│   │   │   ├── schema.ts                    (Phase 5)   Drizzle schema (= docs/DATA_MODEL.md)
│   │   │   └── migrations/                  (Phase 5)   generated + committed
│   │   ├── services/
│   │   │   ├── settingsService.ts           (Phase 5/48)
│   │   │   ├── partyService.ts              (Phase 26 ✅/47) list / upsert / seedSamples (SQL is in db/partyRepo.ts; IPC in ipc/parties.ts)
│   │   │   ├── billService.ts               (Phase 27 ✅) newDefaults / save (one IMMEDIATE transaction: PO, bill, rows, new party, revision snapshot, outbox hook); SQL in db/billRepo.ts; IPC in ipc/bills.ts; pure rules in shared/billSave.ts
│   │   │   ├── draftService.ts              (Phase 29 ✅) save / list / get / delete / cleanupStale (SQL in db/draftRepo.ts; IPC in ipc/drafts.ts; pure rules in shared/draft.ts); renderer: stores/draftAutosave.ts (debounced writer) + stores/draftStore.ts (list/recover/remove) + hooks/useDrafts.ts + components/create/DraftRecovery.tsx (Dashboard banner)
│   │   │   ├── historyService.ts            (Phase 41)
│   │   │   ├── trashService.ts              (Phase 43)
│   │   │   ├── trashService.ts              (Phase 43)
│   │   │   ├── revisionService.ts           (Phase 44 ✅) list / get / restoreToDraft (read-only; SQL is in db/billRepo.ts; IPC in ipc/revisions.ts; tests in __tests__/revisionService.test.ts)
│   │   │   ├── customerService.ts           (Phase 45)
│   │   │   ├── dashboardService.ts          (Phase 46)
│   │   │   ├── partyImportService.ts        (Phase 47 ✅) preview / commit (one transaction) / undo / list over a SheetReader port; repo = db/partyImportRepo.ts; reader = import/excelSheetReader.ts (ExcelJS); picker = import/electronFilePicker.ts; migration 0001_party_import
│   │   │   ├── (renderer) stores/partyImportStore.ts + components/partyImport/PartyImportDialog.tsx (Phase 47 ✅, modal in AppShell)
│   │   │   ├── backupService.ts             (Phase 50)
│   │   │   ├── themeService.ts              (Phase 3/49)
│   │   │   └── auditService.ts              (Phase 61)
│   │   ├── print/
│   │   │   ├── __tests__/layoutHarness.ts + printLayout.test.ts  (Phase 35 ✅) real headless-Chromium layout measurement (skips when no Chromium binary: QUOT3_CHROME or /opt/pw-browsers/chromium-1194)
│   │   │   ├── template/index.ts            (Phase 33 ✅) printFontsDir/printFontBaseUrl/renderBillHtml (the renderer itself is pure, in shared/print/template)
│   │   │   ├── printService.ts              (Phase 37)
│   │   │   ├── pdfService.ts                (Phase 38)
│   │   │   └── imageService.ts              (Phase 39 ✅) capture + crop + clipboard (ImagePort; + __tests__/imageService.test.ts); Phase 71: content-hash PNG cache, prerender/warm/dispose; electronImagePort pools one hidden window; renderer stores/imagePrerender.ts (+ __tests__/imagePrerender.test.ts); Phase 72: image.scale setting (imageFlow.ts readImageScale/verifyScale, appSettings saveImage, Print tab ImageQualitySection)
│   │   (Phase 40 also: A4 density tiers - printConstants `A4_DENSITY_TIERS`, printFlow `fitDensity`, printCss `densityCss`, PrintService fit + `DecideResult.density`; fixture `matrixBill`; main/print/__tests__/outputGate.test.ts + outputHarness.ts (shared Chromium/Playwright helpers); docs/reference/qa/OUTPUT_GATE.md + pdf-*.pdf + image-*.png)
│   │   (Phase 39 also: shared/print/imageFlow.ts (+ __tests__/imageFlow.test.ts), main/print/electronImagePort.ts, main/ipc/image.ts (+ __tests__/image.test.ts), PrintService.resolveOutput, main/print/__tests__/imageCapture.test.ts (real Chromium + Playwright by path, skips if absent; QUOT3_IMAGE_SAMPLES=dir writes PNGs), renderer stores/outputActions.copyBillImage, components/create/__tests__/copyImage.test.ts, samples in docs/reference/qa/image-*.png)
│   │   └── sync/                            # ONLY place that imports @supabase/supabase-js
│   │       ├── transport.ts                 (Phase 54)  interface + InMemoryTransport
│   │       ├── supabaseTransport.ts         (Phase 52)
│   │       ├── crypto.ts                    (Phase 53, DONE)
│   │       ├── outbox.ts                    (Phase 54, DONE)
│   │       ├── pushWorker.ts                (Phase 55, DONE) push loop: seal, fan-out, backoff, poison
│   │       ├── pullWorker.ts                (Phase 56, DONE) pull loop: decrypt, apply, cursor, ack
│   │       ├── remoteApplier.ts             (Phase 56, DONE) idempotent apply + held changes for the open bill
│   │       ├── pushWorker.ts                (Phase 55)
│   │       ├── pullWorker.ts                (Phase 56)
│   │       ├── apply.ts                     (Phase 57)  conflict rules
│   │       └── syncManager.ts               (Phase 59)
│   │
│   ├── preload/
│   │   └── index.ts                         (Phase 2)   exposes window.quot3 (typed)
│   │
│   └── renderer/
│       ├── index.html                       (Phase 1)
│       ├── main.tsx  App.tsx                (Phase 1/4)   App.tsx = route switch inside AppShell
│       ├── theme/ThemeProvider.tsx          (Phase 3)   applies built-in/custom themes via data-theme + CSSOM
│       ├── router/routerStore.ts            (Phase 4)   tiny in-memory router + history (zustand)
│       ├── styles/
│       │   ├── tokens.css                   (Phase 3)   ALL design tokens
│       │   ├── neumorph.css                 (Phase 3)
│       │   ├── grid.css                     (Phase 9)
│       │   └── index.css                    (Phase 1)   tailwind layers
│       ├── components/
│       │   ├── ui/                          (Phase 3)   Surface, Button, Input, Badge, Dialog, Toast, EmptyState …
│       │   ├── layout/                      (Phase 4)   SideRail, AppShell, TitleBar (Phase 98), CommandPalette, ShortcutSheet (Phase 67: lists every action + in-control keys), navItems; __tests__/keyboardAcceptance.test.ts (Phase 67)
│       │   ├── grid/                        (Phase 9+)  BillGrid, GridRow, GridCell, NameCell, NumCell, FooterRows, ColumnHeader, FormatPalette (Phase 15; no separate NameCell: name runs render inside GridCell)
│       │   ├── create/FormatToolbar.tsx     (Phase 15 ✅) Red+Bold/Bold/Clear/Highlight/palette buttons; mounted on /dev/grid until the Create page (Phase 25)
│       │   ├── create/ExtraColsToolbar.tsx  (Phase 21 ✅) +Col / −Col / rename buttons + remove confirmation; stores/extraColActions.ts + extraColUiStore.ts; shared/extraCols.ts (pure); ColumnHeader.tsx = in-place header rename
│       │   ├── grid/ (Phase 23 ✅) ColumnHeader resize handle; stores/columnWidthStore.ts + columnWidthActions.ts; shared/columnWidths.ts (width policy, sticky offsets, grapheme slice)
│       │   ├── create/ (Phase 25 ✅) PartyBar.tsx; stores/partyUiStore.ts; shared/partyFields.ts; pages/Create.tsx (bar + toolbars + grid + bottom bar)
│       │   ├── create/ (Phase 28 ✅) UnsavedDialog.tsx (S/D/Esc); stores/guardStore.ts (requestLeave), stores/createSession.ts (Create's bill id, startFreshBill, openBillForEdit; Phase 70: endSessionAfterSave + re-arm on dirty; BottomBar New bill button); hooks/useDirtyGuard.ts; shared/dirtyGuard.ts; routerStore leave-guard; main: bills:getForEdit, app:confirmQuit + held window close
│       │   ├── create/ (Phase 27 ✅) SaveFlow.tsx (toast on save result); stores/saveActions.ts (runSave: flush → tidy party → validate → bills:save → markSaved) + saveUiStore.ts; billStore gained meta/toBill/applySaved; Ctrl+S = bill.save
│       │   ├── create/ (Phase 26 ✅) PartyAutocomplete.tsx (combobox around Party name); stores/partyIndexStore.ts (saved parties + local Fuse index)
│       │   ├── perf/ (Phase 24 ✅) perfHarness.ts (6 scenarios, injected clock/frame); shared/perf/stats.ts (percentiles, budget, markdown rows); pages/dev/PerfDev.tsx → /dev/perf; (Phase 68 ✅) shared/perf/acceptance.ts (budgets, verdict, rows, heap slope) + shared/perf/startupMarks.ts
│       │   ├── create/UnitsPopup.tsx        (Phase 22 ✅) Units summary + Marked calculations popups (Ctrl+U / Ctrl+Shift+M); Mark = Ctrl+M (billStore.toggleMark); buttons live in ExtraColsToolbar
│       │   ├── create/FormatSwitcher.tsx    (Phase 20 ✅) format indicator + segmented switcher (one button per registered format); mounted on /dev/grid; stores/formatActions.ts = switchFormat (draft flush, undoable switch, active-cell remap)
│       │   ├── create/                      (Phase 25+) PartyBar, BottomBar, UnitsPopup, PrintDialog, UndoPanel
│       │   ├── history/                     (Phase 41 ✅) DatesPanel, BillList, HistoryHeader; (Phase 42 ✅) SearchBox (debounced search + From/To), ActionBar (Open PDF, Edit/Open, Print, Copy image, Delete, Back); stores/historyActions.ts (open/print/pdf/image/export/delete + output-key routing); shared/history/historySearch.ts (pure ranking)
│       │   ├── customers/                   (Phase 45 ✅) CustomerList.tsx (virtualised table + inline editor); bills view reuses history/BillList; pages/Customers.tsx; stores/customersStore.ts + customersActions.ts; styles `.q3-cust__*` in grid.css (+ __tests__/customersPage.test.ts)
│       │   └── settings/                    (Phase 48+)
│       ├── pages/                           # Dashboard, Create, History, Customers, Settings/*, dev/*
│       │   └── dev/{DesignPreview,GridDev}.tsx   (Phases 3, 9)  dev routes; grid components live in components/grid/ (+ renderProbe.ts test instrumentation); Phase 11 added gridController.ts (event pipeline), gridDom.ts, GridStatus.tsx, stores/gridUiStore.ts
│       ├── stores/
│       │   ├── billStore.ts                 (Phase 9 skeleton → 13/17 ✅) open bill rows + derived grid view + undo/redo/dirty state; stores/billHistory.ts (✅ Phase 17) glue (record/wrap/undo/redo/jumpTo/revertToSaved); stores/undoUiStore.ts + stores/undoActions.ts (✅ Phase 18); components/create/BottomBar.tsx + UndoPanel.tsx (✅ Phase 18, mounted on /dev/grid); components/grid/FooterRows.tsx (✅ Phase 19: editable adjustment rows); components/grid/FreeCells.tsx (✅ Phase 80: editable extra cells on the total rows + tail rows; tests grid/__tests__/freeCells.test.ts)
│       │   ├── uiStore.ts                   (Phase 4)
│       │   ├── backupStore.ts               (Phase 50) Settings > Backup state + Ctrl+Alt+B
│       │   ├── settingsStore.ts             (Phase 48; Phase 49 added themes / appearance / shortcuts sections)
│       │   └── uiPrefsStore.ts              (Phase 49) density + font-size preferences applied after the theme
│       ├── hooks/                           # useHotkeys + useAppActions (Phase 4), useBridge, useDirtyGuard …
│       └── dev/                             # perf harness (Phase 24), seed data
│
├── scripts/                                 # postinstall.mjs (Phase 1: native-module guard); verify-*.mjs / seed scripts when needed
├── tests-e2e/                               (Phase 66 ✅ written, not yet run)
│   ├── helpers/app.ts, helpers/bills.ts     launch the built app on a temp data folder; keyboard + bridge helpers; PDF / PNG size readers
│   └── 01-create-history, 02-format-switch, 03-extra-col-mark, 04-print-pdf, 05-image-copy, 06-trash-restore, 07-backup-restore  (*.e2e.ts)
│   (Phase 67 also: src/__tests__/keyboardAcceptance.test.ts - registry / handler / mouse-only audit)
│   (Phase 68 also: vitest.perf.config.ts + src/main/perf/acceptance.perf.ts = `npm run perf:acceptance` (5 000 bills / 2 000 parties / soak); docs/reference/qa/PERF_ACCEPTANCE.md)
│   (also: src/main/__tests__/e2eSuite.test.ts - vitest checks of the suite's scaffolding and helpers)
└── release/                                 # electron-builder output (gitignored, never zipped)
```

## Naming conventions
- Files: `camelCase.ts` for modules, `PascalCase.tsx` for components. Tests live in `__tests__` next to the module.
- IPC channels: `namespace:method` (e.g. `bills:save`). Bridge methods mirror them: `window.quot3.bills.save(...)`.
- Constants shared with the owner for tuning (undo depth, coalesce ms, retention, `LEFT_UNLOCK_PRESSES`) are named, exported and documented — never magic numbers.

## Import boundaries (enforced by a lint-style Vitest check added in Phase 2)
- `src/renderer/**` must not import from `electron`, `node:*`, `fs`, `path`, `better-sqlite3`, `@supabase/*`, or `src/main/**`.
- `src/shared/**` must not import from `electron`, `node:*`, DOM globals, `src/main/**` or `src/renderer/**`.
- `@supabase/supabase-js` only under `src/main/sync/**`. `better-sqlite3` only under `src/main/db/**`.

**Phase 50 main-process files:** `src/main/db/backupRepo.ts` (the `backups` table), `src/main/db/pendingRestore.ts` (stage + apply a restore / reset at launch, before the DB opens), `src/main/services/backupService.ts`, `src/main/ipc/backup.ts`, `src/main/import/electronBackupPorts.ts` (Open dialog + relaunch). Renderer: `components/settings/BackupSection.tsx`, `components/settings/BackupRecoveryPrompt.tsx`; Phase 49: `components/settings/{Themes,Appearance,Shortcuts}Section.tsx`, `stores/uiPrefsStore.ts`.

**Phase 52 files:** `src/shared/sync/license.ts`, `src/main/sync/{transport,secretStore,electronSecretStore,licenseService}.ts`, `src/main/db/syncStateRepo.ts`, `src/main/db/probe.ts` (the read-only `probeDatabase`, moved out of `backupService.ts` to keep better-sqlite3 under `db/`), `src/main/ipc/license.ts`; renderer `stores/licenseStore.ts`, `components/settings/SyncSection.tsx`; tests `shared/sync/__tests__/license.test.ts`, `main/sync/__tests__/{transport,licenseService}.test.ts`.
**Phase 53 files:** `src/shared/sync/canonicalJson.ts` (+ `__tests__/canonicalJson.test.ts`), `src/main/sync/crypto.ts` (+ `__tests__/crypto.test.ts`); edited in place: `src/main/sync/licenseService.ts` (key derivation + cache, `encryptionKey()`), its test, `renderer/components/settings/SyncSection.tsx` (label).
**Phase 54 files:** `src/shared/sync/outbox.ts`, `src/main/db/outboxRepo.ts`, `src/main/sync/outbox.ts`, `src/main/ipc/sync.ts`; tests `src/main/sync/__tests__/{outbox,postbox}.test.ts`. Edited in place: `sync/transport.ts` (push / pull / ack, both implementations), `sync/crypto.ts` (`sealedToParts` / `partsToSealed`), `services/billService.ts` + `trashService.ts` (`op`), `ipc/register.ts`, `main/index.ts`, `preload/index.ts`, `shared/ipc.ts`. The transport lives in `sync/transport.ts` (not a separate `supabaseTransport.ts`), as built in Phase 52.

**Phase 55 files:** `src/shared/sync/push.ts`, `src/main/sync/pushWorker.ts`; `licenseService.ts` gains `recipients()`; `main/index.ts` creates, starts and stops the worker; tests `src/shared/sync/__tests__/push.test.ts`, `src/main/sync/__tests__/pushWorker.test.ts`.

**Phase 56 files:** `src/shared/sync/pull.ts`, `src/main/db/remoteApplyRepo.ts`, `src/main/sync/{remoteApplier,pullWorker}.ts`; renderer `stores/remoteChangeStore.ts`, `components/create/RemoteChangeBanner.tsx`; tests `main/sync/__tests__/pullWorker.test.ts`, `renderer/components/create/__tests__/remoteChangeBanner.test.ts`. Edited in place: `ipc/sync.ts`, `ipc/register.ts` (`remote`), `shared/ipc.ts`, `preload/index.ts`, `main/index.ts`, `sync/licenseService.ts` (deactivate clears `sync.*`), `pages/Create.tsx`, `components/layout/AppShell.tsx`, `hooks/useAppActions.ts`, `shared/shortcuts.ts`, `styles/ui.css`.

**Phase 57 files:** `src/shared/sync/conflict.ts`; tests `shared/sync/__tests__/conflict.test.ts`, `main/sync/__tests__/conflicts.test.ts` (scenarios + two seeded convergence property tests). Edited in place: `db/remoteApplyRepo.ts`, `sync/remoteApplier.ts`, `sync/pullWorker.ts`, `shared/sync/pull.ts`, `ipc/sync.ts`, `shared/ipc.ts`, `preload/index.ts`, `services/billService.ts` (`saved_by_branch` = local branch).
**Phase 58 files:** `src/shared/sync/bootstrap.ts`; `src/main/db/bootstrapRepo.ts` (the only SQL of the merge; opens the backup file read-only), `src/main/sync/bootstrapService.ts`, `src/main/ipc/bootstrap.ts`; renderer `stores/bootstrapStore.ts`, `components/settings/BootstrapPanel.tsx` (rendered under `SyncSection` by `pages/Settings.tsx`), `.q3-bs*` CSS in `grid.css`; test `main/sync/__tests__/bootstrap.test.ts`.

**Phase 51 files:** `supabase/sql/{01_licenses,02_branches,03_postbox,04_rpcs,05_sweep,90_selftest}.sql`, `scripts/generate-license.mjs`, `docs/SUPABASE_MIGRATIONS.md`, `src/__tests__/supabaseSql.test.ts` (structural guards over the SQL text + the generator script).

### Phase 59 additions
- `src/shared/sync/manager.ts` - overview derivation, badge rule, IPC schemas (pure).
- `src/main/sync/syncManager.ts` - on/off switch, status, retry, Sync now.
- `src/renderer/stores/syncStatusStore.ts`, `src/renderer/components/sync/SyncStatusPanel.tsx`, `src/renderer/components/sync/SyncBadgeMark.tsx`.
- Tests: `src/shared/sync/__tests__/manager.test.ts`, `src/main/sync/__tests__/syncManager.test.ts`.

### Phase 60 additions
- `src/main/sync/flakyTransport.ts` - seeded lossy / delaying wrapper around any `SyncTransport` + metrics (no Electron, no Supabase import). Phase 141 appended `FlakySharedTransport` (same idea for the v2 `SharedStoreTransport`: loss before / after the server, duplicate delivery, `down()`, `heal()`).
- `src/main/sync/__tests__/simHarness.ts` - N virtual branches on real temp SQLite; `harness.test.ts` - loss, size limit, skew and the 1000-operation soak.
- `docs/SUPABASE_MIGRATIONS.md` - owner-run real-Supabase checklist and clock-skew note.

### Phase 61 additions
- `src/shared/audit.ts`, `src/shared/diagnostics.ts` - pure: audit types / summaries / filters / retention; scrubbing, error description, diagnostics text, crash notice wording.
- `src/main/db/auditRepo.ts`, `src/main/db/diagnosticsRepo.ts` - the only SQL for reading / trimming `audit_log` and for the diagnostics counts.
- `src/main/services/auditService.ts`, `src/main/services/diagnosticsService.ts`, `src/main/crash.ts` (session marker, crash records, global handlers), `src/main/ipc/audit.ts` (`audit:*` + `diagnostics:*`).
- `src/shared/updater.ts` (Phase 62: feed / channel rules, `UpdateState`, install gate, copy), `src/main/services/updateService.ts` (check -> download -> ready -> install), `src/main/services/updaterPort.ts` (the only import of `electron-updater`), `src/main/ipc/updates.ts` (`updates:*`). Renderer: `stores/updateStore.ts`, `components/settings/UpdatesSection.tsx`, `components/layout/UpdateBanner.tsx`.
- Phase 63: `src/shared/appInfo.ts` (name, `APP_ID`, publisher, version scheme, icon file names), `src/main/appIcon.ts` (`resolveAppIcon`), `window.ts` `iconPath`. Renderer: `components/settings/AboutSection.tsx` (Settings > About Quot3). Tests: `shared/__tests__/appInfo.test.ts` (incl. real icon file checks), `main/__tests__/appIcon.test.ts`, `renderer/components/settings/__tests__/aboutSection.test.ts`.
- Phase 64: `electron-builder.yml`, `build/installer.nsh` (uninstall data prompt), `src/main/runtimePaths.ts`; scripts `npm run pack` / `npm run dist` (output in `release/`, git-ignored). Test: `main/__tests__/runtimePaths.test.ts`.
- Phase 65: `docs/RELEASE_SIGNING.md` (signing options, SmartScreen, antivirus, release checklist), `scripts/signing-env.mjs`, `win.signtoolOptions` in `electron-builder.yml`. Test: `main/__tests__/signing.test.ts`.
- Renderer: `stores/auditStore.ts`, `stores/diagnosticsStore.ts`, `errorReporting.ts`, `components/ErrorBoundary.tsx`, `components/diagnostics/CrashNotice.tsx`, `components/settings/AuditSection.tsx` (Settings > Activity log).
- Tests: `shared/__tests__/{audit,diagnostics}.test.ts`, `main/services/__tests__/auditService.test.ts`, `main/__tests__/crash.test.ts`, `renderer/components/diagnostics/__tests__/phase61Ui.test.ts`.

## Milestone 8 planned files (docs only so far)
- Docs: `docs/MILESTONE8_DESIGN.md`, `docs/LEGACY_IMPORT_SPEC.md`, `docs/reference/CALCULATOR_PANEL_RULES.md`, `docs/reference/legacy_import/Bills_JSON.zip`.
- **Phase 90 files (built):** `src/shared/wipe/wipeRules.ts` (+ test), `src/main/db/wipeApply.ts` (options file + post-open Level 1 clear / PO restart), `src/main/services/wipeService.ts`, `src/main/ipc/wipe.ts` (`wipe:start`, `publisher:*`), `src/renderer/components/settings/StartFreshSection.tsx`; tests `src/main/services/__tests__/wipeService.test.ts`. Touched in place: `shared/appInfo.ts`, `shared/backup/backupRules.ts` (`pre-wipe`), `main/db/pendingRestore.ts` (`wipe` action), `main/index.ts`, `ipc/register.ts`, `shared/ipc.ts`, `preload/index.ts`, `shared/shortcuts.ts`, `AboutSection.tsx`, `Settings.tsx`, `settingsStore.ts`.
- **Phase 85 files (built):** `src/main/db/migrations/0004_legacy_import.sql` (+ journal entry), `src/main/db/schema.ts` (`importBatches`, three `bills` columns), `src/main/db/legacyImportRepo.ts` (the only SQL for `import_batches` and the `bills.legacy_*` columns), `src/main/services/legacyImportService.ts` (read / preview / commit / list / undo); tests `src/main/services/__tests__/legacyImportService.test.ts` (22, incl. the owner corpus). Touched in place: `shared/backup/backupRules.ts` + `main/services/backupService.ts` (`pre-import` kind), `main/db/__tests__/db.test.ts` (table list). (Wired into `main/index.ts` / IPC by Phase 86; swept in Phase 91.)
- **Phase 86 files (built):** `shared/legacyImport/uiModel.ts` (+ test), `main/ipc/legacyImport.ts`, `main/import/electronLegacyPicker.ts`, `renderer/stores/legacyImportStore.ts`, `renderer/components/legacyImport/LegacyImportDialog.tsx`, `renderer/components/history/SourceFilter.tsx`, `renderer/components/create/ImportedNote.tsx`. Touched in place: `main/index.ts`, `main/ipc/{register,history}.ts`, `main/db/{historyRepo,legacyImportRepo}.ts`, `main/services/{historyService,legacyImportService}.ts`, `preload/index.ts`, `shared/{ipc,shortcuts}.ts`, `shared/history/{historyList,historySearch}.ts`, `renderer/stores/historyStore.ts`, `renderer/components/{history/BillList,create/PartyBar,layout/AppShell}.tsx`, `renderer/pages/{History,Settings,Customers}.tsx`, `renderer/hooks/useAppActions.ts`, `renderer/styles/grid.css`.
- Planned code: `shared/calc/expression*`, `shared/legacyImport/*`, `main/services/legacyImport*`, `main/services/wipeService*`, renderer `components/calculator/*`, `components/settings/{ImportLegacy,StartFresh,About}*`.

## Milestone 9 planned files (docs only so far)
- Docs: `docs/MILESTONE9_DESIGN.md`.
- Phase 92 added `renderer/components/settings/__tests__/phase92Selectors.test.ts` (selector lint scan + Settings mount test). Planned code: fix in `renderer/components/settings/BootstrapPanel.tsx` (done); root-aware back rule in `shared/routes.ts` + `router/routerStore.ts`; theme tokens/themes in `renderer/styles/tokens.css` and `renderer/theme/*`; title-bar overlay in `main/window.ts`; extra-column Down in `shared/nav/cellNav.ts`; image scale in `main/print/electronImagePort.ts`.

**Milestone 9 as built (Phases 92-106 summary).** Themes: `shared/theme/tokens.ts` `BUILTIN_THEMES` (navy-ember, paper, glossy-glass, space, red-navy, red-black), blocks in `renderer/styles/tokens.css`, `shared/theme/preview.ts` (picker swatches, Phase 103), parity/contrast/QA in `src/__tests__/tokensParity.test.ts` and `shared/theme/__tests__/*`. Navigation: root-aware Esc in `shared/routes.ts` + `router/routerStore.ts` (Phase 94). Grid: extra-column Down in `shared/nav/cellNav.ts` (`GridShape.isExtraCol`, Phase 104). Image: DevTools-protocol capture in `main/print/electronImagePort.ts` with pure builders in `shared/print/imageFlow.ts` (Phase 105). No new tables, no new IPC channels in Phases 99-106.

## Milestone 10 planned files
- **Phase 110 built:** `shared/items/sales.ts`, `shared/items/api.ts`, `main/db/itemsRepo.ts`, `main/services/itemsService.ts`, `main/ipc/items.ts` (wired in `ipc/register.ts` + `main/index.ts`; bridge `items` in `shared/ipc.ts` / `preload/index.ts`), tests `main/services/__tests__/itemsService.test.ts`, `itemsCorpus110.test.ts`, `shared/items/__tests__/sales.test.ts`.
- **Phase 112 built:** `shared/items/search.ts` (+ `__tests__/search.test.ts`), `renderer/stores/itemsStore.ts`, `renderer/pages/Items.tsx`, `renderer/components/items/ItemsWindowFrame.tsx` (+ `__tests__/itemsPage.test.ts`); edited `shared/routes.ts`, `shared/shortcuts.ts`, `shared/shortcutList.ts`, `components/layout/navItems.ts`, `App.tsx`, `hooks/useAppActions.ts`, `styles/grid.css` (`.q3-items*`), and the nav / dashboard / routes tests.
- **Phase 111 built:** `shared/sync/itemRule.ts`, `main/sync/itemRuleApplier.ts`; edited `main/db/itemRulesRepo.ts` (`onChange`, `applyRemote`), `main/sync/pushWorker.ts`, `main/sync/pullWorker.ts`, `main/index.ts`; tests `shared/sync/__tests__/itemRule.test.ts`, `main/sync/__tests__/itemRuleSync.test.ts`; `simHarness.ts` extended (`rules`, `decide`, `legacyBranches`).
- **Phase 109 built:** `main/db/migrations/0005_item_rules.sql`, `main/db/itemRulesRepo.ts`, `shared/items/rules.ts`, tests `main/db/__tests__/itemRules.test.ts` and `shared/items/__tests__/rules.test.ts`.
- **Phase 108 built:** `shared/items/vocabulary.ts`, `shared/items/grouping.ts`, tests `grouping.test.ts` and `corpus108.test.ts`.
- **Phase 107 built:** `shared/items/normalise.ts`, tests `shared/items/__tests__/normalise.test.ts` and `corpus.test.ts` (counts only, skipped without the private zip).
- Docs: `docs/ITEM_SORTER_SPEC.md`.
- Planned code: `shared/items/{normalise,vocabulary,grouping}.ts`, `main/db/itemRulesRepo.ts` + migration, `main/services/itemsService.ts`, `main/ipc/items.ts`, `renderer/pages/Items.tsx`, `renderer/components/items/*`, `renderer/stores/itemsStore.ts`.
- **Phase 113 built:** `shared/items/decide.ts`, `shared/items/groupRows.ts` (+ `__tests__/decide113.test.ts`), `renderer/components/items/{GroupsWindow,SpellingsWindow}.tsx` and `windowKeys.ts` (+ `__tests__/itemsWindows113.test.ts`); edited in place: `shared/items/api.ts`, `shared/ipc.ts`, `preload/index.ts`, `main/ipc/items.ts`, `main/services/itemsService.ts` (+ new Phase 113 tests in `__tests__/itemsService.test.ts`), `main/index.ts`, `renderer/stores/itemsStore.ts`, `renderer/pages/Items.tsx`, `renderer/hooks/useAppActions.ts`, `shared/shortcuts.ts`, `shared/shortcutList.ts`, `styles/grid.css`.
- **Phase 114 built:** `shared/items/salesView.ts` (+ `__tests__/salesView114.test.ts`), `renderer/components/items/SalesPanel.tsx` (+ `__tests__/itemsSales114.test.ts`); edited in place: `renderer/components/items/windowKeys.ts` (`salesKey`), `renderer/stores/itemsStore.ts` (sales state + open / copy), `renderer/pages/Items.tsx`, `renderer/hooks/useAppActions.ts`, `shared/shortcuts.ts`, `shared/shortcutList.ts`, `styles/grid.css` (`.q3-items__sales*`, tabs, chip, flag). No IPC / schema / package change.
- **Phase 115 built (M10 QA gate; no new feature):** new `main/services/__tests__/itemsPerf115.test.ts` (5 000 bills / 60 000 lines, invented names, prints timings). Edited in place: `renderer/pages/Items.tsx` (stable `frameRefs`, `onWindowKey` typed `KeyboardEvent<HTMLElement>`), `renderer/components/items/GroupsWindow.tsx` (one re-render after mount), and test fixes in `itemsService.test.ts`, `itemsPage.test.ts`, `itemsWindows113.test.ts`. **Milestone 10 as-built summary:** pure `shared/items/*` (normalise, vocabulary, grouping, rules, sales, salesView, decide, groupRows, search, api) -> `main/db/{itemRulesRepo,itemsRepo}.ts` -> `main/services/itemsService.ts` -> `main/ipc/items.ts` -> bridge `window.quot3.items.*` -> `stores/itemsStore.ts` -> `pages/Items.tsx` + `components/items/*`; rules sync as snapshot kind `item_rule` (`shared/sync/itemRule.ts`, `main/sync/itemRuleApplier.ts`).

## Milestone 11 planned files (docs only so far)
- Docs: `docs/MILESTONE11_DESIGN.md`.
- Phase 126 as built: `shared/dashboard/tileLayout.ts`, `renderer/components/dashboard/TodayTiles.tsx`, `renderer/components/settings/DashboardSection.tsx` (Settings section `dashboard`), CSS `.q3-today` / `.q3-tile*` in `styles/ui.css`; tests `shared/dashboard/__tests__/tileLayout.test.ts`, `components/dashboard/__tests__/todayTiles.test.ts`.
- Phase 125 as built: `shared/dashboard/{live,holidays}.ts`, `main/services/{dashboardLiveService,dashboardHttp}.ts`, `main/ipc/dashboardLive.ts`; tests `shared/dashboard/__tests__/live.test.ts`, `main/services/__tests__/dashboardLive125.test.ts`.
- Phase 124 as built: `gridController.moveActiveRow`, `gridUiStore.moveRow`, shortcuts `grid.moveRow*`; test `components/grid/__tests__/gridRowMove124.test.ts`.
- Phase 123 as built: `shared/rows/moveRows.ts` (+ `__tests__/moveRows.test.ts`), `billStore.moveRow`; test `stores/__tests__/rowMove123.test.ts`. No UI yet (Phase 124).
- Phase 122 as built: `shared/rows/deleteRows.ts` (+ test), `billStore.deleteRows`, row selection / delete in `gridController.ts`, ports in `gridUiStore`; test `components/grid/__tests__/gridRowDelete122.test.ts`.
- Phase 119 as built: new test `components/grid/__tests__/gridClipboard119.test.ts`; no new source files (`MODIFIER_ONLY_KEYS` in `shared/nav/cellNav.ts`, clipboard fallback in `gridController.ts`).
- (Superseded: all of the below were built in Phases 116-126, see the 'as built' lines above. Phase 127 added only perf tests `renderer/perf/__tests__/perfMoveDelete127.test.ts` and `perfDashboardOpen127.test.ts`.) Originally planned code: `components/ui/Toast.tsx` (dedupe), `components/items/*` (scroll fix), `stores/createSession.ts` + `pages/Create.tsx` (always blank), `components/grid/gridController.ts` + `shared/nav/cellNav.ts` (clipboard, delete/move row), `main/print/electronImagePort.ts` (HD), `main/services/dashboardLive*`, `shared/dashboard/*`, `pages/Dashboard.tsx` + `components/dashboard/*`.

## Phase 116 additions (notification discipline)
- `src/renderer/components/RouteToastClear.tsx` - clears toasts on every page change (mounted in `App.tsx`).
- `src/renderer/components/create/QuietStatus.tsx` - quiet bottom-bar text for routine 'ok' notices (mounted in `BottomBar`).
- `src/renderer/components/ui/__tests__/toastDiscipline.test.ts`.

## Phase 117 additions (Items windows)
- `src/shared/items/windowing.ts` - pure row windowing for fixed-height lists.
- `src/renderer/components/items/useScrollView.ts` - scroll position of the Items window's content div.
- Groups and Sales no longer use `@tanstack/react-virtual`.

## Milestone 12 planned files (Phases 128–143; nothing built yet)
- **Phase 130 tests (built):** `src/main/sync/__tests__/pushTruthTable.cases.ts` (the push conflict table as data + reference model; Phase 132's in-memory transport must pass it) and `pushTruthTable.test.ts`.
- **SQL (128–131):** `supabase/sql/{11_members_branches,12_records,13_rls,14_license_admin,15_rpcs,16_realtime,91_selftest_v2,99_drop_v1}.sql`; `src/__tests__/supabaseSql.test.ts` extended.
- **Phase 132 built:** `src/main/sync/sharedTransport.ts` (interface `SharedStoreTransport`, `InMemorySharedServer` + `InMemorySharedTransport`, `SupabaseSharedTransport`, `createSupabaseClient`), `src/main/sync/activationV2.ts` (`createSharedActivation`, `SHARED_KEYS` = `shared.*` rows of `sync_state`); appended a "Phase 132" section to `src/shared/sync/license.ts` (e-mail / password / branch-name checks, `SHARED_MESSAGES`, `classifySharedFailure`, `SharedLicenseStatus`, `ActivateInputV2`); `ErrorCode` gained `AUTH_FAILED` and `SERVER_PAUSED` (`shared/ipc.ts`); tests `main/sync/__tests__/{sharedTransport,activationV2}.test.ts`, `shared/sync/__tests__/licenseV2.test.ts`. `@supabase/supabase-js@2.117.2` added to `package.json` / lockfile. `syncStateRepo.ts` and the v1 files are untouched.
- **Phase 134 built:** `src/shared/sync/diff.ts` (pure compare plan, conflict resolution, clock offset) + `shared/sync/__tests__/diff.test.ts`.
- **Phase 135 built:** `src/main/sync/{pushWorkerV2,pullWorkerV2,recordApplierV2,compareService,billRecordV2,sharedState}.ts` (v2 workers + first compare; not wired until Phase 140), appended `shared/sync/{push,pull}.ts`, tests `main/sync/__tests__/{workersV2.test.ts,sharedSim.ts}` and `shared/sync/__tests__/sharedFlow135.test.ts`.
- **Phase 136 built:** `src/main/sync/heldService.ts`, `recordApplierV2.ts` (party kind, aside guard), `shared/sync/manager.ts` (set-aside counts + line), `renderer/pages/History.tsx` (line), test `main/sync/__tests__/applyV2.test.ts`.
- **Phase 139 built:** `src/shared/sync/sharedUi.ts`, additions to `shared/sync/manager.ts` (`serverPaused`, `signedOut`, `clockWarning`), renderer `stores/sharedSyncStore.ts`, `components/settings/SharedSyncSection.tsx` (shown by `SyncSection` when `window.quot3.syncShared` exists, else the v1 `LegacySyncSection`), `SyncStatusPanel.tsx` (delivery + clock lines), shortcuts `sync.compare` / `sync.renameBranch`; tests `shared/sync/__tests__/sharedUi.test.ts`, `renderer/components/settings/__tests__/sharedSyncSection.test.ts`.
- **Phase 140 built:** `src/shared/sync/cutover.ts` (pure: `CUTOVER_KEYS`, `cutoverStep` / `cutoverNeeded`, wizard words, `CutoverBridge` contract), `src/main/sync/cutoverService.ts` (`createCutoverService`: forced backup, pause v1, compare, optional customer unify, finish), `src/main/ipc/cutover.ts` (`cutover:*` handlers, not registered yet), `syncManager.ts` (+ `inert()` / `suspend()`), renderer `stores/cutoverStore.ts` and `components/settings/CutoverWizard.tsx` (shown by `SyncSection` only when `window.quot3.cutover` exists). Tests: `shared/sync/__tests__/cutover.test.ts`, `main/sync/__tests__/cutoverService.test.ts`, `cutoverSim.test.ts`, `renderer/components/settings/__tests__/cutoverWizard.test.ts`. NOT wired into `main/index.ts`, `register.ts`, `shared/ipc.ts` or the preload yet (see the Phase 140 log in `PHASE_STATUS.md`).
- **Phase 141 built:** `src/main/sync/__tests__/simHarnessV2.ts` (N-branch harness over `createSim` + `FlakySharedTransport`: seeded random edits / deletes / restores, `converge`, `snapshotOf`, `assertConverged`, soak seed + Windows-flake note), `src/main/sync/__tests__/harnessV2.test.ts` (19 tests), appended `FlakySharedTransport` to `main/sync/flakyTransport.ts`, option `wrapTransport` in `__tests__/sharedSim.ts`; one typo fix in `cutoverSim.test.ts`. Test-only: no app code, IPC or contract changed.
- **Phase 138 built:** `src/main/sync/doorbell.ts`, additions to `shared/sync/{pull,manager}.ts` and `main/sync/pullWorkerV2.ts` (`pollMs`), docs `SYNC_SHARED_STORE_SPEC.md` section 10, test `main/sync/__tests__/doorbell.test.ts` (+ `pullOpts` in `sharedSim.ts`).
- **Phase 137 built:** `src/shared/customers/duplicates.ts`, migration `0007_customer_merge.sql` (+ journal, `schema.ts`: `party_merge_log`, `party_not_same`), `main/db/{partyRepo,remoteApplyRepo}.ts` (merge SQL), `main/services/customerService.ts`, `main/sync/{billRecordV2,pushWorkerV2,recordApplierV2}.ts`, `main/ipc/customers.ts`, `shared/{ipc,shortcuts}.ts`, `preload/index.ts`, `renderer/{stores/duplicatesStore.ts,components/customers/DuplicatesPanel.tsx,pages/Customers.tsx,hooks/useAppActions.ts,styles/grid.css}`; tests `shared/customers/__tests__/duplicates.test.ts`, `main/services/__tests__/customerMerge.test.ts`, `main/sync/__tests__/customerMergeSync.test.ts`, `renderer/components/customers/__tests__/duplicatesPanel.test.ts`.
- **Phase 133 built:** `src/shared/sync/codecV2.ts` (pure codec, content hash, sha-256), `src/main/db/syncRecordRepo.ts`, `src/main/sync/asideService.ts`, migration `src/main/db/migrations/0006_shared_sync_records.sql` (+ journal entry, `schema.ts` tables `syncRecordState` / `syncAside`, column `parties.mergedInto`); tests `shared/sync/__tests__/codecV2.test.ts`, `main/db/__tests__/syncRecords.test.ts`, `main/sync/__tests__/asideService.test.ts`. `main/index.ts` creates the repo and passes `isAside` to `createBillService`.
- **Main (132, 135, 136, 138, 140):** `src/main/sync/{sharedTransport,activationV2,pushWorkerV2,pullWorkerV2,compareService,remoteApplierV2,doorbell,cutoverService}.ts`, `src/main/db/syncRecordRepo.ts`, migration `0006_*.sql`. `@supabase/supabase-js` is still imported only under `src/main/sync/**`.
- **Shared, pure (133, 134, 137):** `src/shared/sync/{codecV2,diff}.ts`, `src/shared/customers/duplicates.ts`; edits to `shared/sync/{manager,push,pull,progress,license}.ts`.
- **Renderer (137, 139, 140):** `components/settings/{SyncSection,CutoverWizard}.tsx`, `components/sync/SyncStatusPanel.tsx`, `pages/Customers.tsx` (Possible duplicates).
- **Tests (141):** `src/main/sync/__tests__/{simHarnessV2.ts,harnessV2.test.ts}`.
- **Tests (143, interim M12 gate):** `src/main/sync/__tests__/perfV2.test.ts` (2 000-bill first compare, 1 000-record pull; client cost only, budgets [A]). `cutoverSim.test.ts` fixture now gives the "shared" bills the same branch id and row ids on both computers (a backup join does). `docs/DATA_MODEL.md` gained the Phase 137 tables (`party_merge_log`, `party_not_same`; migration `0007`).
- **Removed in Phase 142:** `main/sync/crypto.ts`, passphrase / key-check handling, the postbox transport and ack paths.

- **Phase 144 (print position, 2026-10-13):** `shared/print/printFlow.ts` gained `printPageSizeMicrons`, `parsePrintMarginType`, `buildElectronPrintOptions`, `printDebugLine`; `main/print/electronPrintPort.ts` uses them (`QUOT3_PRINT_DEBUG`, `QUOT3_PRINT_MARGIN_TYPE`). New tests: `shared/print/__tests__/printPosition144.test.ts` (pure options + CSS no-top-offset guard) and `main/print/__tests__/printTopOffset144.test.ts` (first-text Y per page in real headless-Chromium PDFs, A4/A5 x rough/professional x 15/16/60 rows; `QUOT3_PRINT_REPORT=1` prints the table).
- **Phase 144 follow-up (PDF-first print):** `main/print/pdfPrintRoute.ts` (+ `__tests__/pdfPrintRoute144.test.ts`), `shared/print/printFlow.ts` gained `parsePrintRoute` / `buildPdfPrintOptions`; `electronPrintPort.print` = PDF route first, `htmlPrint` fallback; new runtime dependency `pdf-to-printer@5.8.1`; `electron-builder.yml` `asarUnpack` lists its SumatraPDF exe.
- **Phase 144 follow-up 2 (speed):** `main/services/printService.ts` measured-answer cache + `warm`; `main/print/electronPrintPort.ts` single reusable hidden window (queue, idle close, `warmWindow`); tests added to `main/services/__tests__/printService.test.ts`.
