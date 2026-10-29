/**
 * 数字华容道（滑块拼图 / 15-Puzzle）—— 点击同行同列可整排推动，方向键滑单块。
 * 打乱方式为「从完成态做大量随机合法移动」，天然可解，不存在无解局。
 * 计时制：score 实时上报已用秒数，胜利时 api.win(秒)，模块标记 bestLower（越快越好）。
 */
import { setupCanvas, createRunner, onKey, onPointer, onSwipe, roundRect, centerText, cssVar, randInt, lerp } from './canvasKit.js'

const SIZE = 460
const PAD = 12 // 盘面内边距

export default {
  id: 'slide',
  name: '数字华容道',
  bestLower: true,
  options: [{
    key: 'size',
    label: '盘面',
    def: 4,
    values: [
      { v: 3, t: '3×3' },
      { v: 4, t: '4×4' },
      { v: 5, t: '5×5' },
    ],
  }],

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, SIZE, SIZE)

    const N = [3, 4, 5].includes(api.options.size) ? api.options.size : 4
    const GRID = (SIZE - PAD * 2) / N

    let grid = [] // 行主序，存 tile 值（1..N²-1），0 = 空格
    let blank = { r: 0, c: 0 }
    let moves = 0
    let startAt = 0 // 首次移动才开始计时
    let elapsed = 0
    let won = false
    let anims = [] // {v, fr, fc, tr, tc}，dur 秒内从 from 插值到 to

    const idx = (r, c) => r * N + c

    function shuffle() {
      grid = Array.from({ length: N * N }, (_, i) => (i + 1) % (N * N))
      blank = { r: N - 1, c: N - 1 }
      // 随机合法移动打乱（不立即回退），次数随盘面规模增长
      const steps = N * N * N * 6
      let lastDir = null
      for (let i = 0; i < steps; i++) {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
          .filter(([dr, dc]) => {
            const r = blank.r + dr
            const c = blank.c + dc
            return r >= 0 && r < N && c >= 0 && c < N
          })
          .filter(([dr, dc]) => !lastDir || !(dr === -lastDir[0] && dc === -lastDir[1]))
        const [dr, dc] = dirs[randInt(0, dirs.length - 1)]
        lastDir = [dr, dc]
        slideBlank(-dr, -dc) // 与「空格朝 dr,dc 方向移动」等价
      }
      // 极小概率打乱后恰为完成态：再补 20 步合法移动
      if (isSolved()) {
        const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        for (let i = 0; i < 20; i++) {
          const [dr, dc] = DIRS4[randInt(0, 3)]
          slideBlank(dr, dc)
        }
      }
    }

    /** 键盘语义：方向键 = 滑块滑动方向，即空格朝反方向挪一格 */
    function slideBlank(dr, dc) {
      const r = blank.r + dr
      const c = blank.c + dc
      if (r < 0 || r >= N || c < 0 || c >= N) return false
      anims.push({ v: grid[idx(r, c)], fr: r, fc: c, tr: blank.r, tc: blank.c, t: 0 })
      grid[idx(blank.r, blank.c)] = grid[idx(r, c)]
      grid[idx(r, c)] = 0
      blank = { r, c }
      return true
    }

    /** 点击 (r,c)：与空格同行/同列则整段推向空格 */
    function pushLine(r, c) {
      if (r === blank.r && c !== blank.c) {
        const step = c < blank.c ? 1 : -1 // 滑块移动方向
        for (let cc = blank.c; cc !== c; cc -= step) {
          anims.push({ v: grid[idx(r, cc - step)], fr: r, fc: cc - step, tr: r, tc: cc, t: 0 })
          grid[idx(r, cc)] = grid[idx(r, cc - step)]
        }
        grid[idx(r, c)] = 0
        blank = { r, c }
        return true
      }
      if (c === blank.c && r !== blank.r) {
        const step = r < blank.r ? 1 : -1
        for (let rr = blank.r; rr !== r; rr -= step) {
          anims.push({ v: grid[idx(rr - step, c)], fr: rr - step, fc: c, tr: rr, tc: c, t: 0 })
          grid[idx(rr, c)] = grid[idx(rr - step, c)]
        }
        grid[idx(r, c)] = 0
        blank = { r, c }
        return true
      }
      return false
    }

    function isSolved() {
      for (let i = 0; i < N * N - 1; i++) if (grid[i] !== i + 1) return false
      return true
    }

    function afterMove() {
      if (won) return
      moves++
      if (!startAt) startAt = performance.now()
      api.status(`已走 ${moves} 步 · 用时 ${elapsed.toFixed(0)}s`)
      if (isSolved()) {
        won = true
        api.score(elapsed)
        api.win(Math.round(elapsed * 10) / 10)
        api.status(`完成！${moves} 步 · ${Math.round(elapsed * 10) / 10}s`)
      }
    }

    function reset() {
      moves = 0
      startAt = 0
      elapsed = 0
      won = false
      shuffle()
      anims = [] // 打乱过程产生的移动记录不需要动画
      api.score(0)
      api.status('点击方块或用方向键开始，计时从第一步起')
    }

    // 品牌蓝→紫的色相插值
    const tileColor = (v) => `hsl(${222 + ((v - 1) / (N * N - 2)) * 46}, 68%, ${34 + ((v - 1) / (N * N - 2)) * 14}%)`

    function drawTile(v, x, y, w) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      roundRect(ctx, x + 2, y + 3, w, w, 10)
      ctx.fill()
      ctx.fillStyle = tileColor(v)
      roundRect(ctx, x, y, w, w, 10)
      ctx.fill()
      // 顶部一线高光，方块更「厚」
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      roundRect(ctx, x + 3, y + 3, w - 6, w * 0.28, 8)
      ctx.fill()
      const fs = N <= 3 ? 34 : N === 4 ? 28 : 22
      centerText(ctx, String(v), x + w / 2, y + w / 2 + 1, fs, '#FFFFFF')
    }

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE)
      roundRect(ctx, 0, 0, SIZE, SIZE, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      const animCells = new Set(anims.map((a) => idx(a.tr, a.tc)))
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = grid[idx(r, c)]
          if (!v || animCells.has(idx(r, c))) continue
          drawTile(v, PAD + c * GRID + 3, PAD + r * GRID + 3, GRID - 6)
        }
      }
      // 动画中的方块画在插值位置（覆盖其最终格）
      const p = anims.length ? Math.min(anims[0].t / 0.09, 1) : 1
      const k = 1 - (1 - p) * (1 - p)
      for (const a of anims) {
        const x = lerp(PAD + a.fc * GRID, PAD + a.tc * GRID, k)
        const y = lerp(PAD + a.fr * GRID, PAD + a.tr * GRID, k)
        drawTile(a.v, x + 3, y + 3, GRID - 6)
      }

      if (won) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, SIZE, SIZE, 16)
        ctx.fill()
        centerText(ctx, '🧩 复原成功！', SIZE / 2, SIZE / 2 - 26, 32, '#7EE2B8')
        centerText(ctx, `${moves} 步 · ${Math.round(elapsed * 10) / 10} 秒`, SIZE / 2, SIZE / 2 + 18, 20, '#E8EEF9', '500')
        centerText(ctx, '按 R 重开', SIZE / 2, SIZE / 2 + 54, 15, 'rgba(232,238,249,0.55)', '500')
      }
    }

    const KEYMAP = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
      W: [-1, 0], S: [1, 0], A: [0, -1], D: [0, 1],
    }
    const offKey = onKey((e) => {
      if (e.key === 'r' || e.key === 'R') { reset(); return }
      if (won) return
      const dir = KEYMAP[e.key]
      if (!dir) return
      e.preventDefault()
      // 滑块朝 dir 滑动 = 空格朝反方向挪；先清旧动画（上一手直接落位）
      anims = []
      if (slideBlank(-dir[0], -dir[1])) afterMove()
    })

    const offPointer = onPointer(canvas, (x, y) => {
      if (won) { reset(); return }
      const c = Math.floor((x * SIZE - PAD) / GRID)
      const r = Math.floor((y * SIZE - PAD) / GRID)
      if (r < 0 || r >= N || c < 0 || c >= N) return
      anims = []
      if (pushLine(r, c)) afterMove()
    })

    const offSwipe = onSwipe(canvas, (d) => {
      if (won) return
      const dir = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] }[d]
      anims = []
      if (dir && slideBlank(-dir[0], -dir[1])) afterMove()
    })

    const runner = createRunner()
    let shownSec = -1
    runner.start((dt) => {
      if (anims.length) {
        for (const a of anims) a.t += dt
        if (anims[0].t > 0.1) anims = []
      }
      if (startAt && !won) {
        elapsed = (performance.now() - startAt) / 1000
        const sec = Math.floor(elapsed)
        if (sec !== shownSec) {
          shownSec = sec
          api.score(sec)
          if (moves) api.status(`已走 ${moves} 步 · 用时 ${sec}s`)
        }
      }
      draw()
    })

    reset()

    return {
      restart: reset,
      destroy() {
        runner.stop(); offKey(); offPointer(); offSwipe()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
