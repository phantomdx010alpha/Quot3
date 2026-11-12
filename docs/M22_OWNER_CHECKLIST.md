# Milestone 22 - Owner's Windows checklist (local AI: purchase history panel, item suggestions, sentence search, Settings > AI)

Handed over UNFILLED by Phase 231 (2026-11-12), release 0.1.52 [A]. Nothing below was run in a real Electron window, with a real model, or on Windows: the sandbox ran one typecheck and named test files with a FAKE embedder only. Real model quality, speed, memory and installer size are NEVER "verified" from the sandbox. Tick each line on a real Windows PC and write what you saw.

Date checked: ____________  App version shown in Settings: ____________  Windows version: ____________  RAM: ____________  Screen size(s): ____________

## 0. Read this first (what this release does and does not contain)

- This release has the AI code, but the model is NOT pinned yet (`revision` and every `sha256` are empty in `src/shared/ai/modelConfig.ts`, `licenceConfirmed` is `false`). The GitHub Action runs `tools/fetch-ai-model.mjs --skip-if-unpinned`, so until you do section 1 the installer has NO model, and Settings > AI shows "Not installed". That is the expected result of this release as shipped.
- With AI off (the default) the app must behave exactly as 0.1.49 / 0.1.51. That is row 5.
- One additive database change only: the table `ai_text_vectors` (migration `0010`). Backups made by 0.1.52 have this cache emptied.

## 1. Choose and fetch the model (once, on your PC)

| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | Run the bake-off on REAL item names (`tools/ai-bakeoff.mjs`, see `docs/THIRD_PARTY_AI.md`) and write which model won: ____________ | [ ] | |
| 2 | Open the official model card(s) on Hugging Face and confirm the licence (MIT / Apache-2.0). Paste the licence link in `docs/THIRD_PARTY_AI.md`, then set `licenceConfirmed: true` in `modelConfig.ts` | [ ] | |
| 3 | `node --experimental-strip-types tools/fetch-ai-model.mjs --allow-unpinned` prints the commit and each SHA-256. Paste them into `modelConfig.ts` (`revision`, `sha256`) | [ ] | |
| 4 | Run `node --experimental-strip-types tools/fetch-ai-model.mjs` again (pinned): it downloads and says every file matches | [ ] | |
| 5 | (After the model is pinned and pushed) the GitHub Action "Release" run is green and its log shows the model fetch, not "skipped" | [ ] | |

## 2. Install and AI off

| # | Check | OK | What I saw |
|---|---|---|---|
| 6 | Install the packaged app on Windows (the SmartScreen warning is normal). It starts; the Dashboard shows | [ ] | |
| 7 | AI OFF (default): no AI panel on Create, no "Suggested" rows on Items, search behaves as before, Ctrl+K has no "Search bills" sentence row | [ ] | |
| 8 | AI OFF: Task Manager shows no extra Quot3 / utility process and normal memory | [ ] | |
| 9 | Settings has a section "AI (runs on this PC)"; it says "Status: Off" and the privacy line "Runs on this PC. Nothing leaves it." | [ ] | |
| 10 | Offline start: unplug the network, start the app: it starts with no AI message or delay | [ ] | |
| 11 | Startup time with AI off, from the click to the Dashboard (seconds): ____________ | [ ] | |

## 3. Settings > AI (the controls)

| # | Check | OK | What I saw |
|---|---|---|---|
| 12 | Without the model files: turn the master switch on: "Status: Not installed" with the plain reason; nothing crashes; billing works | [ ] | |
| 13 | With the model: the master switch on: status goes Ready; the model id and size show; the three other switches become usable | [ ] | |
| 14 | Indexing progress counts up ("Indexing: N of M item names") and ends at "Up to date" | [ ] | |
| 15 | Pause stops the count; Resume continues it | [ ] | |
| 16 | Rebuild index empties and refills the cache (vectors drops to 0, then grows) | [ ] | |
| 17 | Delete AI data asks first; Cancel deletes nothing; Delete sets vectors to 0 and bills / parties / items are untouched | [ ] | |
| 18 | Turn the master switch off while indexing: indexing stops, the AI process in Task Manager goes away, and the Create panel disappears at once | [ ] | |
| 19 | Settings > AI shows the support line (model id, dim, vectors, last embed ms); Copy diagnostics (Ctrl+K) contains the same "AI:" line | [ ] | |
| 20 | New bills made after the first scan: their item names are indexed at the next start or Rebuild [A] (not at save) | [ ] | |

## 4. The three features (AI on)

| # | Check | OK | What I saw |
|---|---|---|---|
| 21 | Create: pick a known party, click an item cell: the panel shows that party's past lines with date, qty, rate and format; it never takes focus | [ ] | |
| 22 | The same party in GST and in non-GST: both formats are shown separately and labelled | [ ] | |
| 23 | The panel toggle key / button shows and hides it; the state is remembered | [ ] | |
| 24 | The grid stays smooth with the panel on: typing, arrows and cell commits on an 80-row bill feel the same as with it off | [ ] | |
| 25 | Using a suggestion copies ONLY the item name into the cell (one undo step); no rate, qty or total is ever written by the AI | [ ] | |
| 26 | Items page "Suggested" rows: Accept merges the group; Dismiss hides it and it stays hidden; nothing merges by itself | [ ] | |
| 27 | Items: names with different numbers or sizes (for example 505 vs D7) are NOT suggested together | [ ] | |
| 28 | History search: type a sentence such as "ruby tomato to <a real party> last month": the chips look right, can be edited and removed, and the right bills show | [ ] | |
| 29 | Open a found bill: PageUp / PageDown step through the found bills; Esc returns to the same list | [ ] | |
| 30 | Ctrl+K "Search bills" row works for a sentence and is absent for a plain word | [ ] | |

## 5. Size, speed, memory

| # | Check | OK | What I saw |
|---|---|---|---|
| 31 | Installer size (MB): ____________ (0.1.51 was: ____________) | [ ] | |
| 32 | Update download size from 0.1.51 to the new version (MB): ____________ | [ ] | |
| 33 | RAM used by Quot3 with AI on and the model loaded (MB, Task Manager, all Quot3 processes): ____________ | [ ] | |
| 34 | First embed after start (seconds, from the "last embed" ms in the support line): ____________ | [ ] | |
| 35 | Time to index all item names the first time (minutes): ____________ | [ ] | |

## 6. What to send back if something is wrong

1. The support line from Settings > AI (or Copy diagnostics: it holds the "AI:" line, versions and the last log lines; no bills or customers).
2. The log file: `%LOCALAPPDATA%\Quot3\logs\quot3.log` (the last 150 lines are already inside Copy diagnostics).
3. For a wrong or missed suggestion: the two item names written exactly as typed (invented examples are fine), what you expected, and what you saw. For wrong sentence search: the sentence and what the chips showed.
4. For install or model-load trouble: the status text in Settings > AI and whether `resources\ai-models\<id>\` exists next to the installed app.

Phase 232 (fix pack) starts only from this filled checklist.
