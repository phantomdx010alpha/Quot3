/**
 * 4096 —— 2048 的升级变体（参考 4096game.com 的 4×4 classic）
 *
 * 规则：同数相撞合并翻倍，每次有效移动后在空位生成一个新块（90% 出 2、10% 出 4），
 * 无法移动即结束，达到目标分后可选择继续。相比 2048 的差异化点：
 *   · 盘面 3×3 ~ 7×7 可选（大盘面明显更容易冲高分）
 *   · 目标 512 ~ 16384 可选（默认 4096）
 *   · 支持撤销（Backspace），参考站把撤销做成标配，误操作不用重开
 *
 * 逻辑与渲染分离：move/undo 等只操作数据，draw() 只读数据画。
 */
import { setupCanvas, createRunner, onKey, onSwipe, roundRect, centerText, cssVar, lerp } from './canvasKit.js'
import { createSolver } from './ai4096.js'

const SIZE = 460
const PAD = 12
const GAP = 10

/* 数值配色：低段冷色（品牌蓝青）→ 高段暖色（金/粉），形成「越合越热」的进度感 */
const PALETTE = [
  [2, '#2F5D8C', '#EAF3FF'],
  [4, '#3F7FBF', '#FFFFFF'],
  [8, '#1FA9C9', '#FFFFFF'],
  [16, '#22D3EE', '#052A33'],
  [32, '#3FCFA8', '#04301F'],
  [64, '#6FD3A5', '#04301F'],
  [128, '#6C63E8', '#FFFFFF'],
  [256, '#8B7CF0', '#FFFFFF'],
  [512, '#B57CF5', '#FFFFFF'],
  [1024, '#E8609F', '#FFFFFF'],
  [2048, '#F0A24F', '#3A1E05'],
  [4096, '#F0D878', '#3A3205'],
  [8192, '#FF8A4C', '#3A1E05'],
  [16384, '#FF5C8A', '#FFFFFF'],
]
const colorOf = (v) => {
  for (const p of PALETTE) if (p[0] === v) return [p[1], p[2]]
  return ['#3A2A5C', '#FFFFFF']
}

const cellAt = (dir, i, j, n) =>
  dir === 'left' ? [i, j] : dir === 'right' ? [i, n - 1 - j] : dir === 'up' ? [j, i] : [n - 1 - j, i]

export default {
  id: '4096',
  name: '4096',
  options: [
    { key: 'size', label: '盘面', def: 4, values: [3, 4, 5, 6, 7].map((v) => ({ v, t: `${v}×${v}` })) },
    { key: 'target', label: '目标', def: 4096, values: [512, 1024, 2048, 4096, 8192, 16384].map((v) => ({ v, t: String(v) })) },
  ],

  /* 运行时控件（不触发重开）：自动托管 + 倍速。倍速最高 10× */
  runtime: [
    {
      key: 'auto',
      label: '操作',
      def: 'off',
      values: [{ v: 'off', t: '手动' }, { v: 'on', t: '自动托管' }],
    },
    {
      key: 'speed',
      label: '倍速',
      def: 4,
      values: [1, 2, 4, 6, 8, 10].map((v) => ({ v, t: `${v}×` })),
    },
  ],

  mount(container, api) {
    const n = Number(api.options.size) || 4
    const target = Number(api.options.target) || 4096

    const boardBg = cssVar('--surface2', '#0F1730')
    const cellBg = 'rgba(255,255,255,0.05)'
    const { canvas, ctx } = setupCanvas(container, SIZE, SIZE)

    const cell = (SIZE - PAD * 2 - GAP * (n - 1)) / n
    const cx = (c) => PAD + c * (cell + GAP)
    const cy = (r) => PAD + r * (cell + GAP)

    let uid = 0
    let tiles = []
    let score = 0
    let over = false
    let won = false
    let paused = false
    let history = []

    const alive = () => tiles.filter((t) => !t.dead)
    const tileAt = (r, c) => alive().find((t) => t.r === r && t.c === c)
    const emptyCells = () => {
      const out = []
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!tileAt(r, c)) out.push([r, c])
      return out
    }

    function addTile(r, c, v) {
      const t = { id: ++uid, v, r, c, x: cx(c), y: cy(r), scale: 0, pop: 0 }
      tiles.push(t)
      return t
    }

    function spawn() {
      const empty = emptyCells()
      if (!empty.length) return
      const [r, c] = empty[Math.floor(Math.random() * empty.length)]
      addTile(r, c, Math.random() < 0.9 ? 2 : 4)
    }

    function reset() {
      tiles = []
      score = 0
      over = false
      won = false
      history = []
      spawn()
      spawn()
      api.score(0)
      api.status('')
    }

    const snapshot = () => ({ tiles: alive().map((t) => ({ v: t.v, r: t.r, c: t.c })), score })

    function restore(s) {
      tiles = s.tiles.map((t) => ({ id: ++uid, v: t.v, r: t.r, c: t.c, x: cx(t.c), y: cy(t.r), scale: 1, pop: 0 }))
      score = s.score
      over = false
      api.score(score)
      api.status('')
    }

    function canMove() {
      if (emptyCells().length) return true
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const t = tileAt(r, c)
          if (!t) continue
          const right = c + 1 < n ? tileAt(r, c + 1) : null
          const down = r + 1 < n ? tileAt(r + 1, c) : null
          if (right && right.v === t.v) return true
          if (down && down.v === t.v) return true
        }
      }
      return false
    }

    function move(dir) {
      if (over || paused) return
      const before = snapshot()
      let moved = false
      let gained = 0

      for (let i = 0; i < n; i++) {
        let pos = 0
        let prev = null // 上一块已落位的方块，用于判定合并
        for (let j = 0; j < n; j++) {
          const [r0, c0] = cellAt(dir, i, j, n)
          const t = tileAt(r0, c0)
          if (!t) continue
          let merged = false
          if (prev && !prev.mergedThisMove && prev.v === t.v) {
            prev.v *= 2
            gained += prev.v
            prev.pop = 1
            prev.mergedThisMove = true
            t.dead = true
            t.goto = { r: prev.r, c: prev.c }
            merged = true
          } else {
            const [r, c] = cellAt(dir, i, pos, n)
            if (t.r !== r || t.c !== c) moved = true
            t.r = r
            t.c = c
            prev = t
            pos++
          }
          if (merged) moved = true
        }
      }

      if (!moved) return
      alive().forEach((t) => {
        t.mergedThisMove = false
      })
      // 被吞掉的块先滑向目标位置再移除（保留「合并」的视觉因果）
      tiles.filter((t) => t.dead).forEach((t) => {
        if (t.goto) {
          t.r = t.goto.r
          t.c = t.goto.c
        }
      })

      score += gained
      api.score(score)
      history.push(before)
      if (history.length > 40) history.shift()

      const finish = () => {
        if (paused) return
        tiles = alive()
        spawn()
        if (alive().some((t) => t.v >= target) && !won) {
          won = true
          api.win(score)
        }
        if (!canMove()) {
          over = true
          api.over(score)
          stopAuto()
        }
      }
      // 自动模式同步落新块：否则 10× 下下一步会抢在落块之前，导致一回合落两块
      if (auto) finish()
      else timers.push(setTimeout(finish, 90))
    }

    function undo() {
      if (!history.length || over) return
      restore(history.pop())
      won = false
    }

    const timers = []

    /* ---------- 自动托管（AI 代打 + 倍速） ---------- */
    const solver = createSolver(n)
    let auto = false
    let speed = 4
    let autoTimer = 0
    let aiDepth = 0
    let aiMoves = 0

    const toExpGrid = () => {
      const g = new Uint8Array(n * n)
      for (const t of alive()) g[t.r * n + t.c] = Math.round(Math.log2(t.v))
      return g
    }

    function stopAuto() {
      if (!auto) return
      auto = false
      if (autoTimer) {
        clearTimeout(autoTimer)
        autoTimer = 0
      }
      if (api.setRuntime) api.setRuntime('auto', 'off')
    }

    function autoStep() {
      if (!auto || over || paused) return
      const perMove = 340 / speed // 1× ≈ 340ms/步，10× ≈ 34ms/步
      const r = solver.decide(toExpGrid(), Math.max(8, perMove * 0.8))
      aiDepth = r.depth
      if (!r.dir) {
        stopAuto()
        api.status('AI 判断已无路可走')
        return
      }
      aiMoves++
      move(r.dir)
      if (over) return
      api.status(`AI 第 ${aiMoves} 步 · 搜索深度 ${r.depth} 层 · ${r.ms.toFixed(0)}ms`)
      autoTimer = setTimeout(autoStep, Math.max(6, perMove - r.ms))
    }

    function startAuto() {
      if (over) reset()
      auto = true
      aiMoves = 0
      api.status('AI 接管中…')
      if (autoTimer) clearTimeout(autoTimer)
      autoTimer = setTimeout(autoStep, 120)
    }

    /* ---------- 渲染 ---------- */
    function draw(dt) {
      ctx.clearRect(0, 0, SIZE, SIZE)
      roundRect(ctx, 0, 0, SIZE, SIZE, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          roundRect(ctx, cx(c), cy(r), cell, cell, 10)
          ctx.fillStyle = cellBg
          ctx.fill()
        }
      }

      for (const t of tiles) {
        t.x = lerp(t.x, cx(t.c), 26 * dt + 0.14)
        t.y = lerp(t.y, cy(t.r), 26 * dt + 0.14)
        t.scale = lerp(t.scale, 1, 18 * dt)
        t.pop = lerp(t.pop, 0, 12 * dt)
        const s = t.scale * (1 + t.pop * 0.18)
        const w = cell * s
        const off = (cell - w) / 2
        const [bg, fg] = colorOf(t.v)
        roundRect(ctx, t.x + off, t.y + off, w, w, 10)
        ctx.fillStyle = bg
        ctx.fill()
        const fs = Math.round(cell * (t.v >= 10000 ? 0.26 : t.v >= 1000 ? 0.3 : 0.38))
        centerText(ctx, String(t.v), t.x + cell / 2, t.y + cell / 2, fs, fg)
      }

      if (auto) {
        ctx.fillStyle = 'rgba(124,108,232,0.92)'
        roundRect(ctx, 14, 14, 156, 28, 14)
        ctx.fill()
        centerText(ctx, `AI 自动 ×${speed} · 深度 ${aiDepth || '-'}`, 92, 28, 13, '#FFFFFF', '600')
      }

      if (over || won) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, SIZE, SIZE, 16)
        ctx.fill()
        centerText(ctx, won ? `达成 ${target}！` : '无路可走', SIZE / 2, SIZE / 2 - 18, 34, '#FFFFFF')
        centerText(ctx, won ? '继续合并刷更高分' : `本局 ${score} 分`, SIZE / 2, SIZE / 2 + 22, 18, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 重开', SIZE / 2, SIZE / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      }
    }

    const runner = createRunner()
    runner.start((dt) => draw(dt))

    /* ---------- 输入 ---------- */
    const KEYS = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down',
      A: 'left', D: 'right', W: 'up', S: 'down',
    }
    const offKey = onKey((e) => {
      const dir = KEYS[e.key]
      if (dir) {
        e.preventDefault()
        // 手动介入即接管：退出托管并走这一步
        if (auto) {
          stopAuto()
          api.status('已交还手动操作')
        }
        move(dir)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        if (auto) stopAuto()
        undo()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (auto) stopAuto()
        else startAuto()
        return
      }
      if (e.key === 'r' || e.key === 'R') reset()
    })
    const offSwipe = onSwipe(canvas, (dir) => move(dir))

    reset()

    return {
      restart: reset,
      pause() {
        paused = true
      },
      resume() {
        paused = false
      },
      setRuntime(key, value) {
        if (key === 'auto') {
          if (value === 'on') startAuto()
          else stopAuto()
        } else if (key === 'speed') {
          speed = Number(value) || 1
        }
      },
      destroy() {
        if (autoTimer) clearTimeout(autoTimer)
        runner.stop()
        offKey()
        offSwipe()
        timers.forEach(clearTimeout)
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
