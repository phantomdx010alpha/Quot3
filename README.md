# Quot3

Windows desktop quotation app — keyboard-first, local-first, Excel-like grid, GST / non-GST formats, rough and professional printing (A5/A4), one-key copy-as-image for WhatsApp, party autocomplete, history/customers/dashboard, undo/redo, optional multi-branch sync through Supabase (today an encrypted postbox; Milestone 12 replaces it with a shared, versioned notebook).

**Status:** Phases 0–68 and 70–91 built; Milestones 9, 10 and 11 (Phases 92–127: fixes, item sorter, post-Phase-115 bugs/features) built or planned; Milestone 12 (Phases 128–143, shared-notebook sync) and Milestone 13 (Phase 144, print position fix) planned 2026-10-12; Milestone 17 (Phases 173–188, the Android phone PWA on Vercel, docs in `docs/MILESTONE17_DESIGN.md`) planned 2026-10-21, nothing built; then the Phase 69 release gate — see `PHASE_STATUS.md`, `docs/MILESTONE8_DESIGN.md` and `docs/MILESTONE9_DESIGN.md`, `docs/ITEM_SORTER_SPEC.md`, `docs/MILESTONE11_DESIGN.md`, `docs/MILESTONE12_DESIGN.md` and `docs/SYNC_SHARED_STORE_SPEC.md`.

## For the owner: starting a phase
1. Unzip this project.
2. Open a new Claude.ai session, upload the zip.
3. Send exactly this (replace NN with the next phase number from `PHASE_STATUS.md`):

> Read `CLAUDE_MUST_READ.md` inside the zip first, then `DEPENDENCY_VERSIONS.md`, then commence Phase NN. Don't extract the entire zip — extract only what's required for this phase. Don't list the archive. Read the minimum to understand, write everything from that understanding, extract only what's needed to verify. Skip anything you can skip. Deliver the output zip in this session without exhausting the 5-hour limit. Do not read any skill .md files.

4. Take the returned `quot3_phaseNN.zip` into the next session.

Some phases will ask you for something only you have: the app icon (Phase 63), the party Excel format (Phase 47), Supabase details (Phases 51–52; from Milestone 12 the Supabase project, the generator query's license key and the email/password logins — Phases 129 and 140), sample bills (Phases 33/40), a look at the Professional print layout (Phase 34). They are listed in `PHASE_STATUS.md` → "Awaiting from owner".

## For you, locally (after Phase 1)
Requires Node 22 and Windows 10/11 for the real app.
```
npm install
npm run dev        # launches the Electron app
npm test           # unit tests
npm run typecheck
```
Your data lives in `%LOCALAPPDATA%\Quot3\` (database, backups, themes, logs). Delete `quot3.db` there to start fresh while testing.

## Where things are
Start with `CLAUDE_MUST_READ.md`. Owner rules live in `docs/reference/` (requirements, keyboard/cell rules, undo/redo, paper engine, extra-column units).
