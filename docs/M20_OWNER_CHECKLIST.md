# Milestone 20 — Owner's Windows checklist (Games in English)

Handed over UNFILLED by Phase 216 (2026-10-30), release 0.1.49. Nothing below was run in a real Electron window: the sandbox ran one typecheck and named test files only, and nobody played any game. Tick each line on a real Windows PC with the installed app, and write what you see next to anything that fails. Items marked [A] are unconfirmed design assumptions. Report problem games by id and what is wrong (a screenshot helps); Phase 217 fixes them.

Date checked: ____________  App version shown in Settings: ____________  Windows version: ____________  Screen size(s): ____________

## 1. State after this milestone (from the code, not from a screen)

- 62 games in `resources/games/manifest.json`, all `lang: "en"`, all MIT. 55 were translated by Quot3 (a worksheet in `docs/translations/<id>.json` and a diff in `docs/patches/<id>-en.diff` each); 7 were English already.
- The 4 games that were not translated (`starforge-idle`, `shan-hai`, `star-tarot`, `crossword-cafe`) were REMOVED on the owner's word (2026-10-30). There is no Chinese-interface game left, so the "show games with a Chinese interface" switch changes nothing today.
- Version 0.1.48 was never published (Phase 205 shipped no bump); the release after 0.1.47 is 0.1.49.

## 2. App-level checks

| # | Check | OK | What I saw |
|---|---|---|---|
| 1 | Settings shows version 0.1.49 after the update | [ ] | |
| 2 | Games page shows 62 games (Settings > Games line "62 of 62 games shown") | [ ] | |
| 3 | No line "N games with a Chinese interface are hidden" appears on the Games page | [ ] | |
| 4 | Settings > Games switch "Show games with a Chinese interface" can be turned on and off and nothing changes (62 games either way) | [ ] | |
| 5 | The "(?)" dashboard tile and random pick open a game that is readable English | [ ] | |
| 6 | Search finds games by English title and tag | [ ] | |
| 7 | Credits list shows 62 games with author, source, licence | [ ] | |
| 8 | No removed game (starforge-idle, shan-hai, star-tarot, crossword-cafe) appears anywhere | [ ] | |
| 9 | Games open and play with the network cable unplugged / Wi-Fi off (offline) | [ ] | |
| 10 | Favourites and last played still work | [ ] | |

## 3. Translated games (55): play about one minute each

Tick the four columns: all text is English / nothing cut off or overlapping / buttons make sense / the game still plays. Write the problem in the last column.

| Game id | All text is English | Nothing cut off or overlapping | Buttons make sense | Still plays | Problem |
|---|---|---|---|---|---|
| `abyss-sonar` | | | | | |
| `air-hockey` | | | | | |
| `auto-chess-forge` | | | | | |
| `auto-composer` | | | | | |
| `ball-arena` | | | | | |
| `beat-bento` | | | | | |
| `breakout` | | | | | |
| `cat-seesaw` | | | | | |
| `chalk-billiards` | | | | | |
| `comet-weaver` | | | | | |
| `curling-endgame` | | | | | |
| `dice-delver` | | | | | |
| `dodge-blocks` | | | | | |
| `drift-racer` | | | | | |
| `dungeon-delver` | | | | | |
| `elemental-sandbox` | | | | | |
| `em-lab` | | | | | |
| `ember-tactics` | | | | | |
| `farm-tycoon` | | | | | |
| `fractal-gallery` | | | | | |
| `garden-front` | | | | | |
| `gem-garden` | | | | | |
| `gomoku` | | | | | |
| `hydrogen-atom` | | | | | |
| `iso-snake` | | | | | |
| `match3` | | | | | |
| `math-lab` | | | | | |
| `memory` | | | | | |
| `merge-2048` | | | | | |
| `merge-cats` | | | | | |
| `merge-town` | | | | | |
| `mine-matrix` | | | | | |
| `mini-games-hub` | | | | | |
| `moba-frontier` | | | | | |
| `moon-lander` | | | | | |
| `mosaic-jigsaw` | | | | | |
| `neon-snake` | | | | | |
| `neon-sudoku` | | | | | |
| `newton-lab` | | | | | |
| `orbital-pinball` | | | | | |
| `pocket-farm` | | | | | |
| `pocket-golf` | | | | | |
| `pulse-studio` | | | | | |
| `river-holdem` | | | | | |
| `room-styler` | | | | | |
| `shadow-post` | | | | | |
| `sky-shooter` | | | | | |
| `slingstorm` | | | | | |
| `sokoban-quest` | | | | | |
| `solitaire-classic` | | | | | |
| `spud-arena` | | | | | |
| `stickman-runner` | | | | | |
| `stickman-stage` | | | | | |
| `tank-arena` | | | | | |
| `thunder-vanguard` | | | | | |

Games where English labels are long and most likely to overflow [A]: `mini-games-hub` (status lines, Gomoku messages, "Wind Swordsman" card), `ball-arena`, `pulse-studio`; the cross-device save-code input in `beat-bento`.

## 4. Games that were already English (7): one-minute smoke test

| Game id | Opens and plays | Problem |
|---|---|---|
| `2048` | | |
| `blocks` | | |
| `bounce-ball` | | |
| `chess` | | |
| `snake` | | |
| `spider-solitaire` | | |
| `tower-defence` | | |

## 5. Problem games

List each problem game by id and what is wrong:

| Game id | What is wrong | Screenshot? |
|---|---|---|
| | | |
| | | |
| | | |

## 6. Decisions for the owner

- Phase 217 (fix pack) runs only if this checklist lists problems.
- Phase 188 (Milestone 17 gate) and Phase 69 (release gate) are still pending and separate from this release.
