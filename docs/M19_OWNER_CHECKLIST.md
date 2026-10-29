# Milestone 19 — Owner's Windows checklist (Games)

Handed over UNFILLED by Phase 204 (2026-10-29). Nothing below was run in a real Electron window: the sandbox ran one typecheck and named test files only. Tick each line on a real Windows PC with the installed app, and write what you see next to anything that fails. Items marked [A] are unconfirmed design assumptions (`docs/MILESTONE19_DESIGN.md` section 5).

Date checked: ____________  App version shown in Settings: ____________  Windows version: ____________  Screen size(s): ____________

## 1. Install and size

- [ ] Installer size is acceptable. Games folder is about 8.3 MB uncompressed (66 games); the sandbox did not build the installer, so the real growth is unknown. Size before: ______ MB, after: ______ MB.
- [ ] The app starts normally and Bills, History, Customers, Items, Print and Backup behave exactly as before.

## 2. Games page

- [ ] Games is in the left navigation with the game-controller icon; `Ctrl+6` opens it [A8]; the command palette finds "Games".
- [ ] The search box has focus on arrival. Typing a name, a tag word or a typo (for example "sudko") still finds the game.
- [ ] Tag chips filter the list; Favourites and Recently played filters work; "Random game" opens a game.
- [ ] Cards show title, tags, 1 or 2 players, the favourite star and last played. Long titles do not break the card at 1024 and 1280 px.
- [ ] Keyboard only: Tab, arrow keys and Enter move through the cards and open a game.
- [ ] Starring a game, closing the app and reopening keeps the star, "last played" and play counts.

## 3. Playing (try each game briefly; list any that misbehave)

For every game: it loads (no blank frame), the keyboard works inside it, sound plays (or is silent only if the game has none), Restart reloads it, Fullscreen enters and leaves, Back returns to the list, and `Alt+Left` leaves the game even while the game has focus [A8].

- [ ] Snake  - [ ] Blocks  - [ ] 2048  - [ ] Merge Numbers  - [ ] Bounce Ball  - [ ] Brick Breaker
- [ ] Tower Defence  - [ ] Spider Solitaire  - [ ] Quiet Night Solitaire  - [ ] Memory Match  - [ ] Gem Match
- [ ] Gomoku  - [ ] Neon Sudoku  - [ ] Warehouse Pusher  - [ ] Deep-Space Sweeper  - [ ] Air Hockey
- [ ] Mini Games Hub (its inner games open and close)
- [ ] The remaining games, one by one (list any problem): ______________________________________
- [ ] High scores of a game survive closing and reopening the app (each game keeps its own).
- [ ] A game cannot open a browser window or leave the app (nothing loads from the internet).
- [ ] Games with a Chinese interface are readable enough, or you want them dropped: ______________

## 4. Chess

- [ ] All four levels play; level 1 is easy and level 4 is clearly stronger (and still replies in a reasonable time on this PC).
- [ ] White, Black and random side; Undo; Flip board; New game; move list; last-move and check marks.
- [ ] Two players on one PC works.
- [ ] Checkmate and stalemate are announced; pawn promotion offers a choice.
- [ ] The piece symbols look acceptable (they are drawn from Unicode symbols, not images) [A].

## 5. Settings > Games and Credits

- [ ] Games off: the nav item, `Ctrl+6`, the palette entry and the Dashboard tile all disappear; `/games` is not reachable. Games on again brings them back.
- [ ] "Clear favourites and history" asks first and then clears stars, last played and play counts.
- [ ] The number of games shown is 66 and "problems" is 0.
- [ ] Credits lists every game with author, repo, licence and commit; each game's licence text opens inside the app. The four chess library licence texts (chess.js, chessboard.js, jQuery, chess-ai) are NOT readable in the app (only shipped as files under `resources/games/chess/LICENSES` and in `THIRD_PARTY.txt`); decide if that is acceptable: ______

## 6. The "(?)" Dashboard tile

- [ ] At 1024 px and at 1280 px the tile text is exactly "(?)" and nothing else, and the seven tiles have no lonely row [A9].
- [ ] Clicking it (and Enter / Space when focused) opens a random game, and not the same one twice in a row [A7].
- [ ] Settings > Dashboard lists it as "(?)"; unticking removes it and the other tiles re-flow.
- [ ] An existing PC that already had tile choices still shows its other six tiles.

## 7. Offline

- [ ] Wi-Fi / network off: Games page, every game you tried and chess all work the same.

## 8. Decisions only you can make

- [ ] Quot3 stays personal use [A1]. If it is ever sold or given to others: re-check the game names and art (the filter list is in `docs/THIRD_PARTY_GAMES.md`; "2048" is a generic number-merge game name but is a well known title) and the Stockfish question first.
- [ ] Stockfish (GPLv3) stays NOT shipped [A5].
- [ ] Games default ON for everyone [A6].

## What the sandbox did and did not show (Phase 204)

Done: typecheck (five configs clean); audit over all 66 game folders (0 failures); manifest, folders, `THIRD_PARTY_GAMES.md`, `THIRD_PARTY.txt` and the Credits data list the same 66 games; all 66 are MIT; 18 named test files, 461 tests, all pass.
NOT done: full test suite, build, installer, dev server, any real window, any real game, sound, focus, Alt+Left, Fullscreen, real layout at 1024 / 1280 px.
