# MILESTONE 22 — Local AI: item suggestions, party purchase history in the billing screen, plain-sentence search (Phases 222–232)

Planned 2026-11-11 from the owner's request. Docs only; nothing built or run. Desktop only. This milestone supersedes the sentence "No AI model in v1" (`ITEM_SORTER_SPEC.md` section 8, `CLAUDE_MUST_READ.md` 10e) for SUGGESTIONS ONLY, exactly as that spec foresaw: "a local embedding model ... used ONLY to propose suggested matches, never to auto-merge".

## 1. What the owner asked for

1. A local AI that groups items that are the same thing under different names (the Items page, leftovers the rules cannot decide).
2. In the BILLING (Create) screen: when a party is set and an item is being typed, the app finds whether THIS party previously bought the same-looking item, in WHICH FORMAT (GST / non-GST / other) and under WHICH NAMES, with the last rate and date.
3. The billing-screen help can be TOGGLED on and off from the billing UI itself (a key and a visible switch), and also in Settings.
4. Plain-sentence search ("ruby tomato to Sharma last month") in the command palette and History.
5. "We don't need your shitty code for it, we need AI": the owner wants a real model doing the matching, not only string rules. This milestone uses a real local embedding model; the rules stay as the first tier and the safety net.

Not chosen (listed so a later milestone can pick them up): photo / scan to draft bill (OCR), smart paste of WhatsApp text, duplicate-party suggestions, voice dictation. See section 11.

## 2. Hard rules (binding for Phases 222-232; copied to `CLAUDE_MUST_READ.md` 10q)

1. LOCAL ONLY. The model runs on the owner's PC. No network call at runtime for AI, no API key, no cloud. Bills and party names never leave the PC. (The existing rule "only the city and currency codes may leave the PC" is unchanged.)
2. SUGGESTIONS ONLY. The AI never fills a cell, merges a group, changes a rate or saves anything by itself. The one allowed write is an explicit key press that copies a suggested ITEM NAME into the active item cell (one undo step) [A].
3. The AI NEVER touches money: totals, GST, rounding, quantities, rates, stock. The decimal.js engine and `shared/billModel` stay the only calculators. A suggestion may DISPLAY an old rate as text; it never writes one.
4. Numbers, sizes and units are protected tokens. Embeddings cannot tell "505" from "D7"; a candidate whose protected tokens conflict with the typed text is rejected before ranking (`shared/items/normalise`, `shared/units/parseUnits`).
5. Order of trust: (1) owner rules and Items-page groups, (2) exact / near-text matches from the existing `shared/items/*`, (3) embedding similarity above the model's threshold. Higher tiers always rank above lower ones. Every suggestion says WHY it is shown ("your rule", "same group", "looks similar").
6. All AI features default OFF (`ai.enabled`, `ai.billingPanel`, `ai.itemSuggestions`, `ai.sentenceSearch`). With AI off, or the model missing, loading, or crashed, the app behaves exactly as in 0.1.49. A failing AI never blocks billing: errors are caught, logged once, the panel simply hides.
7. The grid stays smooth ("240 FPS" rule): the model runs in an Electron utility process, never in the renderer or the main thread; the billing panel never takes focus and is debounced.
8. Model files are shipped inside the installer (`extraResources`), pinned to an exact revision with a SHA-256 per file, and never downloaded at runtime. They are NOT in the repo or the zip (about 100+ MB).
9. Tests never load a real model and never use the network. A deterministic FAKE embedder (hash-based vectors) stands in. Real quality, speed and memory are measured by the owner on a real PC (`docs/M22_OWNER_CHECKLIST.md`, Phase 231) and never written as verified from the sandbox.
10. One additive migration is allowed (the vector cache, section 6). No other schema, sync, Supabase or backup-format change. The phone PWA gets no AI ("no AI on the phone", M17 rule).
11. The Phase 92 selector rule, tokens only, Phosphor only, no emoji in Quot3's own UI, edits to shared files small and additive.

## 3. Sandbox limits the phases must respect (read first)

- The Claude.ai sandbox network allows npm, GitHub, PyPI and a few hosts but NOT `huggingface.co`. A phase session therefore CANNOT download the model. `tools/fetch-ai-model.mjs` (Phase 222) is run by the owner on Windows (and by the GitHub Action before the build). Sessions install the npm package only; they test with the fake embedder.
- `@huggingface/transformers` pulls `onnxruntime-node` (native). It must work inside Electron 44 (utility process, Node ABI of Electron) and be unpacked from the asar. Phase 223 pins versions from the npm registry, installs with `--save-exact`, records the install in `DEPENDENCY_VERSIONS.md`, and lists "real Windows load of the model" as a standing gap [A].

## 4. Model choice [A]

Default: `Xenova/multilingual-e5-small`, int8 (about 118 MB on disk per its model card), 384-dim vectors, MIT licence upstream (`intfloat/multilingual-e5-small`). Why: item names are short and mixed-language trade words; it is small enough for a shop PC and runs on CPU.

- e5 REQUIRES prefixes: `"query: "` for the typed text and `"passage: "` for stored history names. Without them quality drops. The prefix policy is part of the model config, not scattered in code.
- Alternatives the owner may test with the bake-off tool (Phase 222): `Xenova/all-MiniLM-L6-v2` (about 23 MB, English only, no prefixes), `ibm-granite/granite-embedding-97m-multilingual-r2` (higher published multilingual retrieval score; its licence must be checked before shipping). The model id, dimension, prefixes, pooling and similarity thresholds live in ONE file, `src/shared/ai/modelConfig.ts`; the vector cache is keyed by model id, so switching a model reindexes by itself.
- Thresholds are model-specific (e5 cosine scores are compressed into a narrow high band). The default thresholds are set from the owner's bake-off on his real item names, not guessed; until then they are conservative [A].

## 5. Architecture

```
renderer (React)                    main process                 utility process (AI worker)
  Create panel / Items / Palette -> ipc ai:* (src/main/ipc/ai.ts) -> embed(texts, kind) with transformers.js
  (never imports the AI package)     aiService (queue, status)        loads model lazily, batches, returns Float32 vectors
                                     vector cache (SQLite)
```

- `src/shared/ai/*`: PURE code (model config, vector math, ranking, protected-token compatibility, party-history engine, sentence parser). Fully unit-tested with the fake embedder.
- `src/main/ai/*`: the service (`aiService.ts`), the worker entry (`embedWorker.ts`), the real embedder and the fake embedder, status (`notInstalled | loading | ready | error`), queue with back-pressure, restart on crash.
- `src/main/ipc/ai.ts`: channels `ai:status`, `ai:embed`, `ai:suggestForParty`, `ai:suggestGroups`, `ai:searchSentence`, `ai:reindex`, `ai:cancel`.
- `src/__tests__/importBoundaries.test.ts` gains a rule: `src/renderer/**` and `src/pwa/**` may not import `@huggingface/transformers` or `onnxruntime-*`.

## 6. The vector cache (the one migration)

Table `ai_text_vectors(model_id TEXT, text_hash TEXT, dim INTEGER, vector BLOB, created_at TEXT, PRIMARY KEY (model_id, text_hash))`.

- Keyed by the hash of the NORMALISED item text, not by bill or line IDs. The same name in a thousand bills is one row. Deleting or editing a bill never has to touch it. It is a pure cache: it can be dropped and rebuilt any time.
- Additive migration `0010_ai_text_vectors.sql` (the folder's last is `0009_legacy_watch.sql`); the drizzle schema in `src/main/db/schema.ts` gets the table.
- NOT synced (no `shared_sync_records` entry; each PC embeds its own), NOT part of the cross-PC data. Whether the backup file includes it is decided in Phase 224 [A]: default exclude (rebuild after restore).
- Background indexer: after enabling AI and when bills are saved / imported, missing hashes are queued; chunks of about 32 texts per idle tick; pausable, resumable after restart, progress shown in Settings > AI. Rebuilds when the model id or its version changes.

## 7. Party purchase history in the billing screen (the owner's main ask)

Pure engine `src/shared/ai/partyHistory.ts`:

Input: the party (ID), the text typed in the item cell, the party's history lines (from the existing history / items repos: name used, qty + unit, rate, bill date, bill format id / GST flag, bill id), the cached vectors, the owner's item rules and Items-page groups.
Output (max 5, ranked): `{ nameUsed, formatLabel ('GST' | 'Non-GST' | other format name), lastRate, lastQty + unit, lastDate, timesBought, tier, score, why }`.

Algorithm: (1) normalise typed text; (2) tier 1 = lines whose item is in the same owner-rule or Items-page group as the typed text; (3) tier 2 = near-text matches from `shared/items` (existing fuzzy); (4) tier 3 = cosine similarity of the typed text vector against that party's history vectors above the threshold; (5) drop candidates whose protected tokens (numbers, sizes, units) conflict; (6) collapse duplicates by name + format; (7) sort by tier, then score, then recency.

UI (`src/renderer/components/create/AiHistoryPanel.tsx`): a compact panel beside / under the grid, tokens only, for the ACTIVE item cell once the party is set. Shows one row per suggestion: the name this party used, the format pill, last rate, last date, "bought N times", the reason chip. It never takes focus, never moves the grid cursor, hides itself when nothing matches. Debounce about 150 ms. A visible switch in the billing toolbar and a shortcut toggle it (the key is chosen in Phase 226 after the shortcut-conflict test; proposed Alt+H, must not collide with Alt+1/2/3 formats, Alt+C calculator, Alt+Shift rows). The switch writes `ai.billingPanel`; Settings > AI shows the same value. Optional [A]: an accept key copies the highlighted suggestion's NAME into the active item cell only (one undo step); rate and qty are never copied.

Which "format" is shown: the bill's format (GST / non-GST / another registered format) the line was billed under, from the bill record, plus any line-level GST flag if the bill model has one (Phase 225 reads `shared/billModel` and `shared/format/registry` to confirm and records it).

## 8. Items page suggestions (Phase 227)

On the Items page, for groups the rules left alone, the engine proposes "suggested" merges using group-level vectors (a group is represented by the average of its name vectors, or its most frequent name). A suggestion is shown in the spellings / groups window with a "Suggested" badge and the reason; the owner accepts (creates an `item_rule`, undoable, like today) or dismisses (remembered so it is not shown again). Never an automatic merge. GST and non-GST stay separate in the sales view exactly as today. The protected-token rule applies.

## 9. Plain-sentence search (Phases 228-229) — the owner's choice "3"

Honest design: there is no chat model here. The "AI" is a deterministic parser for the structure plus the embedding model for the item words.

`src/shared/ai/sentenceQuery.ts` (pure) turns "ruby tomato to Sharma last month above 5000" into a `StructuredQuery`: `{ party?, dateRange?, amount?: {op, value}, format?: 'gst' | 'nongst', itemText }`, plus explanation chips the UI shows ("Party: Sharma  Date: 1-31 Oct  Item: ruby tomato"). The owner can click a chip to fix or remove it.

- Dates: today, yesterday, this / last week, this / last month, last N days, a month name, dd/mm/yyyy and dd-mm ranges (Indian day-first order). English words only in v1 [A]; Hindi / Hinglish words (kal, parson, pichle mahine) are a candidate for a later phase if the owner wants them.
- Party: matched against the customers list with the existing fuzzy matcher; ambiguous matches show the top choices as chips.
- Amount: "above / over / under / below N", with k and lakh shorthands.
- Format: "gst", "non gst" words.
- Item text: the remainder, searched with the existing text search first, re-ranked by embeddings when the model is ready. Protected tokens are enforced.
- Results are bills (like History search). Opening one uses `returnToCurrent`, so the Milestone 21 page memory brings the owner back to the same result list and position.
- Works with the model off (text search + chips only). Setting `ai.sentenceSearch` (default off) controls only the embedding re-rank; the chips parser is part of search once enabled [A].
- Where: the command palette (Ctrl+K) result group "Search bills" and the History search box (`history.search`).

## 10. Settings > AI (Phase 230)

A new Settings section "AI (runs on this PC)": status (not installed / loading / ready / error with the plain reason), model name and size, the four switches, indexing progress with Pause / Resume, "Rebuild index", "Delete AI data" (drops the cache), a one-line privacy statement ("Nothing leaves this PC"), and a diagnostics line for support (model id, dim, vectors count, last embed ms).

## 11. Not planned (parking lot, from the planning chat)

- Photo / scan to draft bill (OCR): PP-OCRv6 small / tiny ONNX class models; every field reviewed; numbers must exist in the source image text. A good next milestone if the owner wants it.
- Smart paste of WhatsApp text into grid rows, with the rule that every number in the output must appear in the input.
- Duplicate-party suggestions using the same embedding model (next to `shared/customers/duplicates.ts`).
- Voice dictation (a Whisper-family model, push-to-talk): weakest fit.
- Anything that touches totals, GST or rounding; a chat assistant; image generation; unusual-rate flags (plain statistics in the who-paid-what view, not AI).

## 12. [A] unconfirmed list (say so in every phase log)

- A1 Default model `multilingual-e5-small` int8; the owner's bake-off may change it.
- A2 The accept key (copies the suggested NAME only) exists at all.
- A3 The billing-panel toggle key (proposed Alt+H) and its place in the toolbar.
- A4 Thresholds start conservative and are tuned after the owner's bake-off.
- A5 The vector cache is excluded from backups and is not synced.
- A6 English-only date words in sentence search.
- A7 The utility process + onnxruntime-node loads inside the packaged Electron 44 app on Windows (never run in the sandbox).
- A8 The installer grows by roughly the model size (about 120 MB or more with the runtime); auto-update downloads stay acceptable because the model files do not change between releases.
- A9 Whether the owner's real item names are mostly English, Hindi-in-Latin-script or mixed decides the model (bake-off).
- A10 "Party bills" means the History view for one party; Phase 226 and Milestone 21 Phase 220 verify how that screen works today.

## 13. Phases

222 foundations, contract, licence audit, tools · 223 embedding service (dependency, packaging, utility process, IPC) · 224 vector cache and indexer · 225 party-history engine (pure) · 226 billing-screen panel and toggle · 227 Items page suggestions · 228 sentence parser (pure) · 229 sentence search UI · 230 Settings > AI · 231 QA gate (release gate, 0.1.51 [A]) · 232 fix pack from the owner's report (only if needed).
