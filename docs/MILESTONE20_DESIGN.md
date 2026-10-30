# Milestone 20 — Games in English: language field, English-by-default, translation phases (Phases 205–217)

Planned 2026-10-29 from the owner's report after the Phase 204 gate (release 0.1.47): "the games are all Chinese, can't understand anything". **Docs only: nothing was built, run or tested when this was written. No code, version, tag, game file or SQL changed.** Phase 188 (Milestone 17 gate) and Phase 69 (release gate) are STILL PENDING; this milestone does not replace them. It continues Milestone 19 and keeps ALL its rules (`docs/MILESTONE19_DESIGN.md`, `CLAUDE_MUST_READ.md` 10n); read both before any Phase 205-217.

**Items marked [A] are unconfirmed assumptions; say "[A] unconfirmed" in every phase log.** Real Windows behaviour (does the English text fit, does the game still play) is never written as "verified" from the sandbox; it goes in `docs/M20_OWNER_CHECKLIST.md`.

**Testing rule (owner's standing rule, repeated on purpose):** DO NOT RUN THE FULL TEST SUITE: never `npm test`, never a bare `npx vitest run`, never the whole `src` folder. Run `npm run typecheck` once plus ONLY the test files you wrote or changed and the few that could conflict (named per phase in `PHASES.md`). No build, no dev server, no repeated or "double / triple" checks. Name what you ran and what you did not.

## 1. What the owner wants (firm decisions)

1. The Games page must be usable by an English reader. Today 59 of the 66 games have a Chinese interface (counted 2026-10-29 by CJK characters in each game's files; only `2048`, `bounce-ball`, `blocks`, `chess`, `snake`, `spider-solitaire`, `tower-defence` are English).
2. Quick fix first: Chinese-interface games are HIDDEN by default (one switch brings them back); the "(?)" tile and random pick must never open a game the owner cannot read.
3. Then translate the games into English in batches ("translation phases"), one session per batch, the same way the other milestones run (small phases, named tests, owner checklist at the end).

## 2. What exists today (read from the 0.1.47 zip)

- 66 games in `resources/games/<id>/`, listed in `resources/games/manifest.json` (strict validator in `src/shared/games/manifest.ts`: `id, title, tags, description, source, commit, licence, author, entry, players, touch, added`). Titles and tags are already English; descriptions of the Chinese games say so ("Interface is in Chinese").
- Games are plain HTML / JS / CSS copied from MIT repos; each has a recorded patch list in `docs/THIRD_PARTY_GAMES.md` and diffs in `docs/patches/`. `tools/audit-games.mjs` and the permanent guard `src/main/games/__tests__/vendoredGames.test.ts` check every game.
- Size of the work (CJK characters per game, counted from `.html .js .css .json` files): 59 games, about 84,800 characters in all; smallest 402 (`beat-bento`), largest 4,977 (`starforge-idle`). Most games are one file; `mini-games-hub` has 16 files. Per-game numbers are in `PHASES.md` Phases 206-215.

## 3. Hard rules (binding for Phases 205–217; the Milestone 19 rules stay)

1. **A translation is a change to strings only.** Never change game logic, structure, names of variables, files, sizes or timing. Never rewrite a whole file: the tool replaces exact strings and every change is kept as a unified diff in `docs/patches/<gameId>-en.diff`.
2. **No translation API, no key, no network, no machine-translation service.** Claude writes the English itself, in the session, from the worksheet. (The "no API" rule of Milestone 19 stands.)
3. **Translations are data in `docs/translations/<gameId>.json`** (format in 4.2), kept in the repo as the record and for review; they are NOT shipped in the installer. Only the patched game files ship.
4. **A game is `lang: "en"` only when it is finished:** the checker reports no Chinese in visible text, attributes, string literals or CSS `content` (comments may stay Chinese [A]); it still passes `tools/audit-games.mjs`; its manifest title and description are English and no longer say the interface is Chinese. A half-translated game is NEVER marked `en`. If a session runs out of room it stops at a game boundary, records the rest as not done, and the next batch picks them up.
5. **Language is data in the manifest:** `lang` is `"en"` or `"zh"` (required on every game from Phase 205). Hidden-by-default applies to `zh` only.
6. **Games whose content IS the language** (a Chinese-word crossword, Chinese mythology / tarot texts) are judged one by one in Phase 215: translate if it still makes sense in English, otherwise keep `lang: "zh"` (hidden by default) or drop it. Default [A]: translate `shan-hai` and `star-tarot`; keep `crossword-cafe` as `zh`. The owner decides; the log records the reason.
7. **Licence and credits unchanged.** The LICENSE file in each game folder is never touched; `docs/THIRD_PARTY_GAMES.md` gains "Translated to English by Quot3 (M20), patch `docs/patches/<id>-en.diff`" for each game; the Credits screen data (author, source, licence, commit) is unchanged and still lists all 66.
8. **Nothing outside games changes** except the small, additive items of Phase 205 (manifest `lang`, a filter function, one setting, the Games page / Settings / tile reading the filter). No change to bills, parties, items, Supabase, sync, SQL, print, CSP, the `q3game` protocol, `src/pwa`.
9. UI rules as everywhere: tokens only, Phosphor only, no emoji in Quot3's own UI, the Phase 92 selector rule, every control has an accessible name.
10. Versions: see section 6.

## 4. The pieces

### 4.1 Language field, filter and switch (Phase 205)

- `manifest.ts`: `lang: 'en' | 'zh'` required (the validator rejects a missing or unknown value; tests updated, not deleted). `tools/games-lang.mjs` (plain Node) counts CJK characters in visible text and in code strings per game and classifies (`en` when 0-10 characters in total and none in visible text [A]); the owner can override by a list in the manifest only through a phase, not at run time.
- `src/shared/games/search.ts` (additive): `filterByLanguage(list, showChinese)`. `searchGames`, `sortGames` callers, `pickRandom` and the tile all receive the filtered list, so a hidden game can never be opened by search, random or the tile. Favourites, last played and play counts of hidden games stay in `games.state` (not pruned) and show again when the switch is on.
- Setting `games.showChinese` (boolean, default `false`) in the existing settings store (settings defaults + zod schema, small and additive). Settings > Games: switch "Show games with a Chinese interface" and the line "N of 66 games shown". Games page: when some games are hidden, one quiet line under the search box: "N games with a Chinese interface are hidden" and a button "Show them"; when shown, their cards carry the label "Chinese" (text, no emoji). The Credits list always shows all 66 games (licence duty).
- The "(?)" tile and `openRandomGame` pick only from the visible list; the tile is hidden if the visible list is empty (cannot happen while 7 English games exist).

### 4.2 Translation tool and worksheet (Phase 206)

`tools/games-i18n.mjs` (plain Node, no dependencies, no network), three commands:

- `extract <gameFolder>`: finds every string that contains CJK characters in `.html .htm .js .mjs .css .json` files and writes a worksheet `docs/translations/<gameId>.json` with `zh` filled and `en` empty. Each entry: `{ file, kind, line, zh, en, risky? }` where `kind` is one of `text` (HTML text node), `attr` (`title alt placeholder aria-label value content` and similar attributes), `js` (string or template-literal static part), `css` (`content:`), `json` (value in a data file), `other`. Comments are not listed. The same `zh` string in the same file is ONE entry (all its occurrences are replaced together, so lookups that compare strings keep matching); an entry may carry `line` to translate one occurrence differently.
- `apply <gameFolder> <worksheet>`: refuses unless every entry has a non-empty `en` with no CJK characters; replaces the exact `zh` string (inside the same kind of context only) with `en`; sets `<html lang="zh...">` to `lang="en"`; writes the patched files; writes `docs/patches/<gameId>-en.diff`; fails (and writes nothing) if a `zh` string is not found where the worksheet says. Idempotent: a second run reports "already applied".
- `check <gameFolder>`: reports any CJK left outside comments (file, line, text), duplicate `en` for two different `zh` in one file (a warning to review), and runs the audit rules from `tools/audit-games.mjs`. Exit 1 on leftovers or audit failures.

**How Claude translates (method, every batch):**
1. `extract`, then read each entry WITH its line of code. If the string is split, indexed, measured (`.length`, `substr`, `split('、')`), used as an object key, compared, or stored (`localStorage`), mark it `risky: true` and either keep the same structure in English (translate the whole phrase consistently) or leave a note; never change the code to make English fit.
2. Write natural, short, plain English in the game's tone (buttons: verbs; labels: nouns; numbers and units kept; `{}` / `%s` / `${...}` placeholders kept exactly). Chinese units and dates become English units and dates ("3 turns", "Level 4", "Score: 120"). Names of characters or items: a short English name, the same everywhere in that game.
3. `apply`, then `check`; fix leftovers; set `lang: "en"`, an English description without "Chinese", the THIRD_PARTY_GAMES.md row and the patch diff.
4. Keep English labels about as long as the Chinese label plus a little: long English text can overflow a button or a canvas label, and the sandbox cannot see it. Prefer short words; list any label you had to make long in the log. The owner's checklist covers the look [A].

### 4.2a What the pilot taught (Phase 206, `beat-bento` + `pocket-golf`)

- **Template literals:** only the static parts between `${...}` are translated, so the English word order must follow the code (`完成 ${n} 份` becomes `Make ${n} recipes`: prefix `Make `, suffix ` recipes`). When the same Chinese prefix means different things on two lines, use a second entry with `onlyLine: true` (done once in `beat-bento`: `Make ` for the goal, `Served ` for the result).
- **Punctuation-only strings** (a lone `。` after a `${...}`, a `、` used as a join separator) are real visible text: `extract` lists them and `en` may not contain full-width characters, so they become `.` and `, `.
- **The same word can be a button and a pause title:** one `zh` of two different kinds is two entries and may get two English words (`Continue` / `Resume`).
- **Minified single-line games** (`pocket-golf`: one very long line per function) work like any other game; the diff is long per line but correct.
- **Canvas text** (lane icons, floating "Perfect / Good", "Wind" on a fan) is drawn with `fillText` and does not wrap: keep it to one short word. Long strings the owner should eyeball: `BENTO2 cross-device save code` (an input placeholder), the lane buttons (`A Rice`), the two long header sentences.
- **The audit needs a `LICENSE` file** in every folder it checks (also in test fixtures).
- **Risky strings:** the automatic hints found none in these two games; reading the code showed no translated string is compared, split, measured or stored (names are only displayed; ids such as `full-moon` are separate). Do the same reading per game.

### 4.3 Permanent guards

- `src/main/games/__tests__/gameLanguage.test.ts` (new, Phase 206): for every manifest game with `lang: "en"` the checker finds no leftover CJK and the audit passes; every `docs/translations/*.json` has a non-empty English `en` with no CJK for every entry and names a game that exists; every game whose folder has a translation is `lang: "en"`; every `zh` game description still says so (so the owner knows).
- `vendoredGames.test.ts` keeps running unchanged (audit, licence, manifest, record rows).

### 4.4 Batches (Phases 207–215)

Ordered by size, small first; each batch is about 9,000 Chinese characters or less, one session. **The owner may reorder:** after playing a few games the owner names the ones they want first; those move to the next free batch and the lists below shift down. Totals are CJK characters (2026-10-29). The exact lists are in `PHASES.md`.

| Phase | Games | Chinese chars |
|---|---|---|
| 206 | tool + pilot: `beat-bento`, `pocket-golf` | 826 |
| 207 | 8 games (`shadow-post` ... `mine-matrix`) | 4,751 |
| 208 | 10 games (`drift-racer` ... `curling-endgame`) | 7,981 |
| 209 | 9 games (`sokoban-quest` ... `pocket-farm`) | 9,416 |
| 210 | 7 games (`auto-chess-forge` ... `iso-snake`) | 9,382 |
| 211 | 6 games (`em-lab` ... `stickman-stage`) | 9,071 |
| 212 | 5 games (`garden-front` ... `room-styler`) | 8,637 |
| 213 | 4 games (`math-lab`, `breakout`, `memory`, `match3`) | 8,684 |
| 214 | 3 games (`gomoku`, `pulse-studio`, `ball-arena`) | 8,594 |
| 215 | `starforge-idle`, `mini-games-hub`, `shan-hai`, `star-tarot`, decision on `crossword-cafe` | about 17,400 (two sessions allowed) |
| 216 | QA gate + owner checklist (release gate) | — |
| 217 | optional fix pack from the owner's report (only if needed) | — |

### 4.5 Gate and owner checklist (Phase 216)

Re-run the language tool over every game (no `en` game has Chinese left), the audit, the manifest / record / Credits reconciliation as in Phase 204, the named tests; write `docs/M20_OWNER_CHECKLIST.md` UNFILLED: for each translated game play one minute and tick "all text is English, nothing cut off or overlapping, buttons make sense, the game still works"; switch on / off; "(?)" tile; offline. The owner lists problem games by id and what is wrong; Phase 217 fixes them.

## 5. Risks (known, with the mitigation)

1. **English is longer than Chinese** and may overflow buttons, canvas labels or fixed boxes. The sandbox cannot see it. Mitigation: short wording; owner checklist; Phase 217 fix pack. [A]
2. **Strings used as logic** (keys, comparisons, `split`, `length`). Mitigation: consistent replacement of every occurrence, `risky` marks, never editing code; any game where this cannot be done safely is left `zh` and listed.
3. **Two different Chinese words with one English word** inside one game, which could merge two lookups: the checker warns; Claude chooses two English words.
4. **A tiny change to a game breaks it** (a quote or backslash inside a string): `apply` escapes for the string's own quote type and the audit and a syntax check (`node --check` for `.js`, a simple parse for `<script>` blocks) run in `check`. Real play is the owner's checklist.
5. **Translation quality.** Claude's English is good but not a native game localiser: the owner reports wrong or odd text by game id; Phase 217 fixes it.
6. **Time.** 84,800 characters is about 11 sessions. A shorter path is possible: Phase 205 alone already solves "I cannot read these"; the owner can stop translating at any batch and keep the rest hidden.

## 6. Versions and releases

- Phase 205 is a RELEASE GATE [A: owner may flip]: it fixes the immediate problem alone, so it ships as its own release, planned **0.1.48** (bump `package.json` and both spots at the top of `package-lock.json`, `GITHUB_UPDATE_PUSH.md` section 2; tag `v0.1.48`).
- Phases 206-215 and 217: NO version bump and NO tag (their game files ship with the next release); push steps are only extract the changed-files zip, `git add .`, `git commit`, `git push origin main`.
- Phase 216 is the milestone RELEASE GATE: planned **0.1.49** (renumber if Phase 188 ships 0.2.0 first). If the owner stops translating early, Phase 216 may run after any batch; say so in its log.
- Every phase hands back the changed-files zip (only changed files, same folders), the full project zip per `CLAUDE_MUST_READ.md` section 8, and a short message: what changed, files, tests run, what was NOT run, next phase.

## 7. Owner assumptions to confirm or flip ([A] list)

| # | Assumption | Default adopted |
|---|---|---|
| A1 | Chinese-interface games are hidden by default; one switch shows them | hidden |
| A2 | Phase 205 ships alone as release 0.1.48 | release gate |
| A3 | Translation by Claude in-session, no API, no network | as written |
| A4 | Chinese comments in code stay | stay |
| A5 | `en` detection: 0-10 CJK characters and none visible (`tools/games-lang.mjs`) | as written |
| A6 | `shan-hai` and `star-tarot` are translated; `crossword-cafe` stays `zh` | as written |
| A7 | English label length / overflow is checked by the owner on Windows, fixes in Phase 217 | owner |
| A8 | Batches ordered by size; the owner may reorder after playing | by size |

## 8. Out of scope

New games, a language picker for the whole app, translation of Quot3's own UI (it is English already), games API or network, editing game logic, adding Chinese-to-English dictionaries as dependencies, translating comments, phone PWA, anything touching bills or quotations.
