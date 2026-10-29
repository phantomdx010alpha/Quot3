/**
 * 五子棋（人机对战）—— 15 路棋盘，AI 为启发式评分：
 * 单点四方向计连子与开放端（活四/冲四/活三…），攻防加权求和；
 * 「大师」档再对前 10 候选做一层对手最佳应对搜索（近似两层极小化极大）。
 * 计分 = 当前连胜场次；难度为运行时选项（不重开、连胜不断）。
 */
import { setupCanvas, createRunner, onKey, onPointer, onPointerMove, roundRect, centerText, cssVar, rand } from './canvasKit.js'

const N = 15
const SIZE = 460
const CELL = SIZE / (N + 1)
const R = CELL * 0.42

const EMPTY = 0
const HUMAN = 1
const AI = 2

// 棋型分值
const FIVE = 1e7
const LIVE4 = 1e6
const RUSH4 = 1.2e5
const LIVE3 = 4e4
const SLEEP3 = 4e3
const LIVE2 = 800
const SLEEP2 = 150
const COMBO = 4e5 // 双威胁（两条 ≥ 活三 的线路）

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]

export default {
  id: 'gomoku',
  name: '五子棋',
  runtime: [{
    key: 'ai',
    label: 'AI 棋力',
    def: 'normal',
    values: [
      { v: 'easy', t: '随缘' },
      { v: 'normal', t: '认真' },
      { v: 'hard', t: '大师' },
    ],
  }],

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, SIZE, SIZE)

    let board = new Int8Array(N * N)
    let turn = HUMAN // 玩家先手
    let ended = null // null | 'win' | 'lose' | 'draw'
    let winLine = null // {r0,c0,r1,c1}
    let last = null // 最后一手 {r, c, who}
    let moves = 0
    let streak = 0 // 当前连胜
    let level = 'normal' // 宿主不暴露 runtime 初值，用模块默认；setRuntime 时更新
    let thinkTimer = 0
    let hover = null
    let history = [] // 落子手顺（悔棋用）

    const idx = (r, c) => r * N + c
    const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N
    const px = (c) => CELL + c * CELL

    /* ---------- 评分 ---------- */
    function scoreDir(count, open) {
      if (count >= 5) return FIVE
      if (count === 4) return open === 2 ? LIVE4 : open === 1 ? RUSH4 : 0
      if (count === 3) return open === 2 ? LIVE3 : open === 1 ? SLEEP3 : 0
      if (count === 2) return open === 2 ? LIVE2 : open === 1 ? SLEEP2 : 0
      return open === 2 ? 30 : open === 1 ? 10 : 0
    }

    /** 假设 who 落在 (r,c) 的单点价值（落子→计分→撤销，零分配） */
    function evalPoint(r, c, who) {
      board[idx(r, c)] = who
      let total = 0
      let threats = 0
      for (const [dr, dc] of DIRS) {
        let cnt = 1
        let i = 1
        while (inb(r + dr * i, c + dc * i) && board[idx(r + dr * i, c + dc * i)] === who) { cnt++; i++ }
        const openA = inb(r + dr * i, c + dc * i) && board[idx(r + dr * i, c + dc * i)] === EMPTY ? 1 : 0
        let j = 1
        while (inb(r - dr * j, c - dc * j) && board[idx(r - dr * j, c - dc * j)] === who) { cnt++; j++ }
        const openB = inb(r - dr * j, c - dc * j) && board[idx(r - dr * j, c - dc * j)] === EMPTY ? 1 : 0
        const s = scoreDir(cnt, openA + openB)
        total += s
        if (s >= LIVE3) threats++
      }
      board[idx(r, c)] = EMPTY
      if (threats >= 2) total += COMBO
      return total
    }

    /** 空位里与任意棋子切比雪夫距离 ≤2 的候选点 */
    function candidates() {
      const out = []
      let hasStone = false
      for (let i = 0; i < N * N; i++) if (board[i] !== EMPTY) { hasStone = true; break }
      if (!hasStone) return [{ r: 7, c: 7 }]
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (board[idx(r, c)] !== EMPTY) continue
          let near = false
          for (let dr = -2; dr <= 2 && !near; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              if (inb(r + dr, c + dc) && board[idx(r + dr, c + dc)] !== EMPTY) { near = true; break }
            }
          }
          if (near) out.push({ r, c })
        }
      }
      return out
    }

    function bestMove() {
      const cands = candidates()
      if (!cands.length) return null

      const rate = (m, w) => evalPoint(m.r, m.c, w)
      // 随缘：一成概率完全乱下，且只看眼前
      if (level === 'easy') {
        if (Math.random() < 0.12) return cands[Math.floor(Math.random() * cands.length)]
        const DEF = 0.55
        let best = null
        let bestV = -1
        for (const m of cands) {
          const v = (rate(m, AI) + rate(m, HUMAN) * DEF) * rand(0.75, 1.25) // 大噪声
          if (v > bestV) { bestV = v; best = m }
        }
        return best
      }

      const DEF = level === 'hard' ? 0.95 : 0.85
      const scored = cands
        .map((m) => ({ m, s: rate(m, AI) + rate(m, HUMAN) * DEF }))
        .sort((a, b) => b.s - a.s)

      // 己方能成五：直接赢
      if (scored[0] && rate(scored[0].m, AI) >= FIVE) return scored[0].m

      if (level === 'normal') {
        // 认真：启发式 + 前几名里的小随机
        const top = scored.slice(0, 3)
        const weights = [0.72, 0.2, 0.08]
        let p = Math.random()
        for (let i = 0; i < top.length; i++) {
          p -= weights[i]
          if (p <= 0) return top[i].m
        }
        return top[0].m
      }

      // 大师：对前 10 候选做一层「对手最佳应对」的展开评估
      const top = scored.slice(0, 10)
      let best = top[0].m
      let bestV = -Infinity
      for (const { m } of top) {
        board[idx(m.r, m.c)] = AI
        let reply = 0
        for (const m2 of candidates()) {
          const v = evalPoint(m2.r, m2.c, HUMAN) + evalPoint(m2.r, m2.c, AI) * 0.9
          if (v > reply) reply = v
        }
        board[idx(m.r, m.c)] = EMPTY
        const v = rate(m, AI) + rate(m, HUMAN) * DEF - reply * 0.55
        if (v > bestV) { bestV = v; best = m }
      }
      return best
    }

    /* ---------- 对局流程 ---------- */
    function checkWin(r, c, who) {
      for (const [dr, dc] of DIRS) {
        let cnt = 1
        let i = 1
        while (inb(r + dr * i, c + dc * i) && board[idx(r + dr * i, c + dc * i)] === who) { cnt++; i++ }
        const endA = { r: r + dr * (i - 1), c: c + dc * (i - 1) }
        let j = 1
        while (inb(r - dr * j, c - dc * j) && board[idx(r - dr * j, c - dc * j)] === who) { cnt++; j++ }
        const endB = { r: r - dr * (j - 1), c: c - dc * (j - 1) }
        if (cnt >= 5) return { dir: [dr, dc], a: endA, b: endB }
      }
      return null
    }

    function place(r, c, who) {
      board[idx(r, c)] = who
      last = { r, c, who }
      history.push({ r, c, who })
      moves++
      const w = checkWin(r, c, who)
      if (w) {
        ended = who === HUMAN ? 'win' : 'lose'
        winLine = w
        if (who === HUMAN) {
          streak++
          api.score(streak)
          api.win(streak)
          api.status(`🏆 你赢了！连胜 ${streak} 场，点击棋盘再战`)
        } else {
          api.over(streak)
          streak = 0
          api.status('AI 获胜，连胜清零。点击棋盘再战')
        }
        return true
      }
      if (moves >= N * N) {
        ended = 'draw'
        api.status('棋盘下满，平局。点击棋盘再战')
        return true
      }
      return false
    }

    function aiMove() {
      if (ended) return
      const m = bestMove()
      if (!m) return
      if (place(m.r, m.c, AI)) return
      turn = HUMAN
      api.status(`你执蓝先行 · 已下 ${moves} 手 · 连胜 ${streak}`)
    }

    function humanPlay(r, c) {
      if (ended || turn !== HUMAN || board[idx(r, c)] !== EMPTY) return
      if (place(r, c, HUMAN)) return
      turn = AI
      api.status('AI 思考中…')
      thinkTimer = setTimeout(() => {
        thinkTimer = 0
        aiMove()
      }, 320 + rand(0, 260))
    }

    /** 悔棋：撤掉 AI 最后一手 + 自己上一手；AI 思考中与终局后不可悔 */
    function undo() {
      if (ended || thinkTimer || !history.length) return
      const n = history.length >= 2 ? 2 : 1
      for (let i = 0; i < n; i++) {
        const m = history.pop()
        board[idx(m.r, m.c)] = EMPTY
      }
      moves = history.length
      last = history[history.length - 1] || null
      turn = HUMAN
      api.status(`已悔 ${n} 手 · 轮到你落子`)
    }

    function reset() {
      clearTimeout(thinkTimer)
      thinkTimer = 0
      board = new Int8Array(N * N)
      turn = HUMAN
      ended = null
      winLine = null
      last = null
      moves = 0
      history = []
      hover = null
      api.status('你执蓝先行 · 点击棋盘交叉点落子（U 悔棋）')
    }

    /* ---------- 绘制 ---------- */
    function drawStone(r, c, who, ghost) {
      const x = px(c)
      const y = px(r)
      ctx.globalAlpha = ghost ? 0.35 : 1
      if (!ghost) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.beginPath(); ctx.ellipse(x + 1.5, y + 2.5, R, R * 0.92, 0, 0, Math.PI * 2); ctx.fill()
      }
      const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.15, x, y, R)
      if (who === HUMAN) { g.addColorStop(0, '#9DBCFF'); g.addColorStop(1, '#2563EB') }
      else { g.addColorStop(0, '#C9B4FF'); g.addColorStop(1, '#7C3AED') }
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill()
      if (ghost) ctx.globalAlpha = 1
    }

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE)
      roundRect(ctx, 0, 0, SIZE, SIZE, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      // 网格
      ctx.strokeStyle = 'rgba(140,155,180,0.35)'
      ctx.lineWidth = 1
      for (let i = 0; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(px(0), px(i)); ctx.lineTo(px(N - 1), px(i)); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(N - 1)); ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(140,155,180,0.6)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(px(0), px(0), CELL * (N - 1), CELL * (N - 1))
      // 星位
      ctx.fillStyle = 'rgba(140,155,180,0.6)'
      for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
        ctx.beginPath(); ctx.arc(px(c), px(r), 2.6, 0, Math.PI * 2); ctx.fill()
      }

      // 顶部阵营图例
      ctx.fillStyle = '#2563EB'
      ctx.beginPath(); ctx.arc(CELL * 1.2, CELL * 0.42, 6, 0, Math.PI * 2); ctx.fill()
      centerText(ctx, '你', CELL * 1.2 + 14, CELL * 0.42, 12, 'rgba(232,238,249,0.75)', '600')
      ctx.fillStyle = '#7C3AED'
      ctx.beginPath(); ctx.arc(SIZE - CELL * 1.2 - 30, CELL * 0.42, 6, 0, Math.PI * 2); ctx.fill()
      centerText(ctx, 'AI', SIZE - CELL * 1.2 - 16, CELL * 0.42, 12, 'rgba(232,238,249,0.75)', '600')

      if (hover && !ended && turn === HUMAN && board[idx(hover.r, hover.c)] === EMPTY) drawStone(hover.r, hover.c, HUMAN, true)

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = board[idx(r, c)]
          if (v !== EMPTY) drawStone(r, c, v)
        }
      }

      // 最后一手标记
      if (last && !winLine) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(px(last.c), px(last.r), R * 0.45, 0, Math.PI * 2); ctx.stroke()
      }

      // 连珠高亮
      if (winLine) {
        ctx.strokeStyle = 'rgba(126,226,184,0.9)'
        ctx.lineWidth = 3.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(px(winLine.a.c), px(winLine.a.r))
        ctx.lineTo(px(winLine.b.c), px(winLine.b.r))
        ctx.stroke()
        ctx.lineCap = 'butt'
      }

      if (ended) {
        ctx.fillStyle = 'rgba(6,10,24,0.6)'
        roundRect(ctx, 0, SIZE / 2 - 52, SIZE, 104, 14)
        ctx.fill()
        const msg = ended === 'win' ? '🏆 你赢了！' : ended === 'lose' ? 'AI 获胜' : '平局'
        const color = ended === 'win' ? '#7EE2B8' : ended === 'lose' ? '#E05B5B' : '#E8EEF9'
        centerText(ctx, msg, SIZE / 2, SIZE / 2 - 12, 28, color)
        centerText(ctx, '点击棋盘再战 · U 悔棋无效', SIZE / 2, SIZE / 2 + 24, 14, 'rgba(232,238,249,0.6)', '500')
      }
    }

    /* ---------- 输入 ---------- */
    const toCell = (x, y) => {
      const c = Math.round((x * SIZE - CELL) / CELL)
      const r = Math.round((y * SIZE - CELL) / CELL)
      if (!inb(r, c)) return null
      const dx = x * SIZE - px(c)
      const dy = y * SIZE - px(r)
      if (dx * dx + dy * dy > CELL * 0.45 * CELL * 0.45) return null
      return { r, c }
    }
    const offDown = onPointer(canvas, (x, y) => {
      if (ended) { reset(); return }
      const p = toCell(x, y)
      if (p) humanPlay(p.r, p.c)
    })
    const offMove = onPointerMove(canvas, (x, y) => { hover = toCell(x, y) })
    const offKey = onKey((e) => {
      if (e.key === 'r' || e.key === 'R') reset()
      if (e.key === 'u' || e.key === 'U') undo()
    })

    const runner = createRunner()
    runner.start(() => draw())

    reset()

    return {
      restart: reset,
      setRuntime(key, v) {
        if (key === 'ai') level = v
      },
      destroy() {
        runner.stop(); offKey(); offDown(); offMove()
        clearTimeout(thinkTimer)
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
