# Games Hall · 小游戏厅

> 12 small browser games behind one page: 4096, Snake, Tetris, Minesweeper, Breakout, Flappy, Memory, Whack-a-mole, Sliding puzzle, Space shooter, Dino run, Gomoku. No install, no account; high scores stay in your browser.

**English** | [简体中文](README.zh-CN.md)

<a href="https://bushimashen.github.io/games/"><b>▶ Live demo</b></a>

## The 12 games

| Game | Controls |
|---|---|
| **4096** | Arrows / WASD, swipe on mobile; Space toggles AI autopilot (1–10× speed), Backspace undoes a move |
| **Snake** | Arrows / WASD to turn, Space pause, R restart |
| **Tetris** | ←→ move, ↑ rotate, ↓ soft drop, Space hard drop, C hold |
| **Minesweeper** | Click to reveal, right-click / flag mode to mark |
| **Breakout** | Mouse or ←→ to move the paddle |
| **Flappy** | Space / click to flap |
| **Memory** | Flip pairs, fewer moves is better |
| **Whack-a-mole** | Click the mole before it hides |
| **Sliding puzzle** | Click a tile or use arrows |
| **Space shooter** | Arrows to move, Space to fire |
| **Dino run** | Space / click to jump, ↓ to duck |
| **Gomoku** | Click an intersection; U undoes |

## Architecture: 12 games, 118 KB of JS

Every game is a **framework-free ES module** that exports one object:

```js
export default {
  id: 'snake',
  name: '贪吃蛇',
  options: [{ key: 'size', label: '盘面', def: 4, values: [...] }],  // optional
  runtime: [{ key: 'auto', label: '操作', def: 'off', values: [...] }], // optional
  mount(container, api) { /* draw into container */ return { destroy() {}, setRuntime(k, v) {} } }
}
```

`api` is a tiny surface: `score(v)`, `over(v)`, `win(v)`, `status(text)`, `options` (live getter),
`setRuntime(key, value)`. The shell only knows these five things — which is why adding a game means writing
one file and adding one registry row, with no changes to the hall.

Shared drawing helpers (`setupCanvas`, `onKey`, `onSwipe`, `roundRect`, `centerText`, …) live in
`games/canvasKit.js`; games that are DOM-based instead of canvas (Minesweeper, Memory) just build elements.

**Most games render to `<canvas>`, two don't.** Minesweeper and Memory build real DOM nodes — a grid of
buttons gives you free hit-testing, focus and accessibility that canvas would make you reimplement.

## Why the roguelike is missing

The original site's hall also listed **风之剑修**, a 29 MB action roguelite with its own full-screen page and
multiplayer rooms. It isn't a `mount()` module — the registry entry is a plain `href` — so the shell filters
out anything without a `load()`. Shipping it here would mean adding 456 files and 29 MB of assets to this repo
for one game that already lives in its own project.

## High scores

Stored per game under `games-hall:best:<id>` in `localStorage`. Timed games flagged `bestLower: true`
(Minesweeper, Memory) only record a result when you *win*, and lower is better. There's no server, so scores
don't sync between devices — clearing site data resets them.

## Usage

The hall uses ES modules, so serve it rather than opening the file:

```bash
python -m http.server 8000    # then open http://localhost:8000
```

Deep links work too: `?g=snake` opens Snake directly.

## License

MIT — see [LICENSE](LICENSE). The games are original work; no third-party game code is bundled.
