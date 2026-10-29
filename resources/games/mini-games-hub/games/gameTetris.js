/**
 * 俄罗斯方块 —— 7-bag 随机、暂存（C）、硬降（空格）、幽灵落点提示，等级随消行提速。
 */
import { setupCanvas, createRunner, onKey, onPointer, onSwipe, roundRect, centerText, cssVar } from './canvasKit.js'

const COLS = 10
const ROWS = 20
const CELL = 26
const BX = 14 // 棋盘左上
const BY = 14
const W = BX * 2 + COLS * CELL + 128 // 右侧信息栏
const H = BY * 2 + ROWS * CELL

const PIECES = {
  I: { m: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], color: '#22D3EE' },
  O: { m: [[1, 1], [1, 1]], color: '#F0D878' },
  T: { m: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], color: '#8B7CF0' },
  S: { m: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], color: '#6FD3A5' },
  Z: { m: [[1, 1, 0], [0, 1, 1], [0, 0, 0]], color: '#FF5C8A' },
  J: { m: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], color: '#3F7FBF' },
  L: { m: [[0, 0, 1], [1, 1, 1], [0, 0, 0]], color: '#F0A24F' },
}
const KINDS = Object.keys(PIECES)
const rotate = (m) => m[0].map((_, i) => m.map((row) => row[i]).reverse())

export default {
  id: 'tetris',
  name: '俄罗斯方块',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    let board, cur, hold, canHold, bag, queue, score, lines, level, over, paused, acc, dropInterval

    const fromBag = () => {
      if (!bag.length) bag = KINDS.slice().sort(() => Math.random() - 0.5)
      return bag.pop()
    }
    const spawn = (type) => ({ type, m: PIECES[type].m.map((r) => r.slice()), r: type === 'I' ? -1 : 0, c: Math.floor((COLS - PIECES[type].m.length) / 2) })

    function reset() {
      board = Array.from({ length: ROWS }, () => Array(COLS).fill(null))
      bag = []
      queue = [fromBag(), fromBag(), fromBag()]
      cur = spawn(queue.shift())
      queue.push(fromBag())
      hold = null
      canHold = true
      score = 0
      lines = 0
      level = 1
      over = false
      paused = false
      acc = 0
      dropInterval = 0.9
      api.score(0)
      api.status('')
    }

    const collide = (m, r0, c0) => {
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (!m[r][c]) continue
          const rr = r0 + r
          const cc = c0 + c
          if (cc < 0 || cc >= COLS || rr >= ROWS) return true
          if (rr >= 0 && board[rr][cc]) return true
        }
      }
      return false
    }

    function lock() {
      let aboveTop = false
      cur.m.forEach((row, r) => row.forEach((v, c) => {
        if (v) {
          if (cur.r + r < 0) aboveTop = true
          else board[cur.r + r][cur.c + c] = PIECES[cur.type].color
        }
      }))
      // 消行
      let cleared = 0
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every((v) => v)) {
          board.splice(r, 1)
          board.unshift(Array(COLS).fill(null))
          cleared++
          r++
        }
      }
      if (cleared) {
        lines += cleared
        score += [0, 100, 300, 500, 800][cleared] * level
        level = Math.floor(lines / 10) + 1
        dropInterval = Math.max(0.09, 0.9 - (level - 1) * 0.075)
        api.score(score)
      }
      // 新块落不下 / 有格子堆出顶界，才算真结束
      cur = spawn(queue.shift())
      queue.push(fromBag())
      canHold = true
      if (aboveTop || collide(cur.m, cur.r, cur.c)) {
        over = true
        api.over(score)
      }
    }

    function tryMove(dc) {
      if (!collide(cur.m, cur.r, cur.c + dc)) cur.c += dc
    }
    function tryRotate() {
      const rm = rotate(cur.m)
      // 简易踢墙：左右各试一格
      for (const dc of [0, -1, 1, -2, 2]) {
        if (!collide(rm, cur.r, cur.c + dc)) {
          cur.m = rm
          cur.c += dc
          return
        }
      }
    }
    function softDrop() {
      if (!collide(cur.m, cur.r + 1, cur.c)) {
        cur.r++
        score += 1
        api.score(score)
        return true
      }
      lock()
      return false
    }
    function hardDrop() {
      let n = 0
      while (!collide(cur.m, cur.r + 1, cur.c)) {
        cur.r++
        n++
      }
      score += n * 2
      api.score(score)
      lock()
    }
    function doHold() {
      if (!canHold) return
      const t = cur.type
      if (hold) cur = spawn(hold)
      else {
        cur = spawn(queue.shift())
        queue.push(fromBag())
      }
      hold = t
      canHold = false
    }
    const ghostR = () => {
      let r = cur.r
      while (!collide(cur.m, r + 1, cur.c)) r++
      return r
    }

    const drawCell = (x, y, color, ghost) => {
      roundRect(ctx, BX + x * CELL + 1, BY + y * CELL + 1, CELL - 2, CELL - 2, 5)
      ctx.globalAlpha = ghost ? 0.18 : 1
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 1
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()
      // 棋盘格
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        roundRect(ctx, BX + c * CELL + 1, BY + r * CELL + 1, CELL - 2, CELL - 2, 5)
        ctx.fillStyle = 'rgba(255,255,255,0.035)'
        ctx.fill()
      }
      // 已锁定
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) drawCell(c, r, board[r][c], false)
      // 幽灵 + 当前块
      if (!over) {
        const gr = ghostR()
        cur.m.forEach((row, r) => row.forEach((v, c) => { if (v && gr + r >= 0) drawCell(cur.c + c, gr + r, PIECES[cur.type].color, true) }))
        cur.m.forEach((row, r) => row.forEach((v, c) => { if (v && cur.r + r >= 0) drawCell(cur.c + c, cur.r + r, PIECES[cur.type].color, false) }))
      }
      // 右侧信息
      const sx = BX + COLS * CELL + 16
      centerText(ctx, '分数', sx + 40, BY + 12, 12, 'rgba(232,238,249,0.5)', '500')
      centerText(ctx, String(score), sx + 40, BY + 32, 18, '#FFFFFF')
      centerText(ctx, `等级 ${level}`, sx + 40, BY + 58, 12, 'rgba(232,238,249,0.6)', '500')
      centerText(ctx, `消行 ${lines}`, sx + 40, BY + 76, 12, 'rgba(232,238,249,0.6)', '500')
      centerText(ctx, '下一个', sx + 40, BY + 104, 12, 'rgba(232,238,249,0.5)', '500')
      const nt = PIECES[queue[0]]
      nt.m.forEach((row, r) => row.forEach((v, c) => {
        if (v) {
          roundRect(ctx, sx + 16 + c * 16, BY + 116 + r * 16, 14, 14, 3)
          ctx.fillStyle = nt.color; ctx.fill()
        }
      }))
      centerText(ctx, '暂存 (C)', sx + 40, BY + 186, 12, 'rgba(232,238,249,0.5)', '500')
      if (hold) {
        const ht = PIECES[hold]
        ht.m.forEach((row, r) => row.forEach((v, c) => {
          if (v) {
            roundRect(ctx, sx + 16 + c * 16, BY + 198 + r * 16, 14, 14, 3)
            ctx.fillStyle = ht.color; ctx.fill()
          }
        }))
      }

      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, '堆到顶了', W / 2, H / 2 - 16, 32, '#FFFFFF')
        centerText(ctx, `本局 ${score} 分 · 消行 ${lines}`, W / 2, H / 2 + 24, 17, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 重开', W / 2, H / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      } else if (paused) centerText(ctx, '已暂停', W / 2, H / 2, 26, '#FFFFFF')
    }

    const offKey = onKey((e) => {
      if (over) {
        if (e.key === 'r' || e.key === 'R') reset()
        return
      }
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); tryMove(-1); break
        case 'ArrowRight': e.preventDefault(); tryMove(1); break
        case 'ArrowDown': e.preventDefault(); softDrop(); break
        case 'ArrowUp': e.preventDefault(); tryRotate(); break
        case ' ': e.preventDefault(); hardDrop(); break
        case 'c': case 'C': doHold(); break
        case 'p': case 'P': paused = !paused; break
        case 'r': case 'R': reset(); break
      }
    })
    // 触屏：点按旋转，左右滑移动，下滑硬降
    const offTap = onPointer(canvas, (x, y, e) => {
      if (over) return
      e.preventDefault()
      tapX = x
      tapY = y
    })
    const offSwipe = onSwipe(canvas, (d) => {
      if (over) return
      if (d === 'left') tryMove(-1)
      else if (d === 'right') tryMove(1)
      else if (d === 'down') hardDrop()
      else if (d === 'up') tryRotate()
    })
    // 点按 = 旋转（区别于滑动）
    let tapX = 0
    let tapY = 0
    const offUp = (() => {
      const fn = () => {}
      canvas.addEventListener('pointerup', fn)
      return () => canvas.removeEventListener('pointerup', fn)
    })()

    const runner = createRunner()
    runner.start((dt) => {
      if (!over && !paused) {
        acc += dt
        while (acc > dropInterval) {
          acc -= dropInterval
          if (!softDrop()) break
        }
      }
      draw()
    })

    reset()

    return {
      restart: reset,
      pause() { paused = true },
      resume() { paused = false },
      destroy() {
        runner.stop(); offKey(); offTap(); offSwipe(); offUp()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
