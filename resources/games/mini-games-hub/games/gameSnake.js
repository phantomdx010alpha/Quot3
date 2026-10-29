/**
 * 贪吃蛇 —— Canvas 网格追逐。吃食物变长加速，撞墙或撞自己结束。
 */
import { setupCanvas, createRunner, onKey, onSwipe, roundRect, centerText, cssVar, randInt } from './canvasKit.js'

const SIZE = 460
const N = 20
const CELL = SIZE / N

export default {
  id: 'snake',
  name: '贪吃蛇',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, SIZE, SIZE)

    let snake, dir, nextDir, food, score, over, paused
    let acc = 0
    let speed = 8 // 步/秒，随分数提升

    function placeFood() {
      let f
      do {
        f = { r: randInt(0, N - 1), c: randInt(0, N - 1) }
      } while (snake.some((s) => s.r === f.r && s.c === f.c))
      food = f
    }

    function reset() {
      snake = [{ r: 10, c: 10 }, { r: 10, c: 9 }, { r: 10, c: 8 }]
      dir = { r: 0, c: 1 }
      nextDir = dir
      score = 0
      over = false
      paused = false
      acc = 0
      speed = 8
      placeFood()
      api.score(0)
      api.status('')
    }

    function step() {
      dir = nextDir
      const h = { r: snake[0].r + dir.r, c: snake[0].c + dir.c }
      if (h.r < 0 || h.r >= N || h.c < 0 || h.c >= N || snake.some((s) => s.r === h.r && s.c === h.c)) {
        over = true
        api.over(score)
        return
      }
      snake.unshift(h)
      if (h.r === food.r && h.c === food.c) {
        score += 10
        api.score(score)
        speed = Math.min(15, 8 + score / 50)
        placeFood()
      } else {
        snake.pop()
      }
    }

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE)
      roundRect(ctx, 0, 0, SIZE, SIZE, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      // 细网格
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'
      ctx.lineWidth = 1
      for (let i = 1; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke()
      }

      // 食物（呼吸）
      const pulse = 1 + Math.sin(performance.now() / 180) * 0.1
      ctx.fillStyle = '#F0D878'
      ctx.beginPath()
      ctx.arc(food.c * CELL + CELL / 2, food.r * CELL + CELL / 2, CELL * 0.32 * pulse, 0, Math.PI * 2)
      ctx.fill()

      // 蛇身：头亮尾暗的蓝青渐变
      snake.forEach((s, i) => {
        const k = i / Math.max(snake.length - 1, 1)
        ctx.fillStyle = i === 0 ? '#22D3EE' : `rgba(${Math.round(74 - 30 * k)},${Math.round(144 - 60 * k)},${Math.round(226 - 40 * k)},${0.95 - 0.45 * k})`
        roundRect(ctx, s.c * CELL + 1.5, s.r * CELL + 1.5, CELL - 3, CELL - 3, i === 0 ? 7 : 5)
        ctx.fill()
      })
      // 蛇眼
      const hd = snake[0]
      ctx.fillStyle = '#06283D'
      const ex = hd.c * CELL + CELL / 2 + dir.c * 4
      const ey = hd.r * CELL + CELL / 2 + dir.r * 4
      ctx.beginPath(); ctx.arc(ex - (dir.c ? 0 : 4), ey - (dir.r ? 0 : 4), 2.2, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(ex + (dir.c ? 0 : 4), ey + (dir.r ? 0 : 4), 2.2, 0, Math.PI * 2); ctx.fill()

      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, SIZE, SIZE, 16)
        ctx.fill()
        centerText(ctx, '撞到了！', SIZE / 2, SIZE / 2 - 16, 34, '#FFFFFF')
        centerText(ctx, `本局 ${score} 分`, SIZE / 2, SIZE / 2 + 24, 18, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 重开', SIZE / 2, SIZE / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      }
      if (paused && !over) centerText(ctx, '已暂停', SIZE / 2, SIZE / 2, 26, '#FFFFFF')
    }

    const DIRS = {
      ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 },
      w: { r: -1, c: 0 }, s: { r: 1, c: 0 }, a: { r: 0, c: -1 }, d: { r: 0, c: 1 },
      W: { r: -1, c: 0 }, S: { r: 1, c: 0 }, A: { r: 0, c: -1 }, D: { r: 0, c: 1 },
    }
    const offKey = onKey((e) => {
      const d = DIRS[e.key]
      if (d) {
        e.preventDefault()
        // 不允许直接 180° 掉头
        if (d.r !== -dir.r || d.c !== -dir.c) nextDir = d
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        paused = !paused
      }
      if (e.key === 'r' || e.key === 'R') reset()
    })
    const offSwipe = onSwipe(canvas, (d) => {
      const v = { left: { r: 0, c: -1 }, right: { r: 0, c: 1 }, up: { r: -1, c: 0 }, down: { r: 1, c: 0 } }[d]
      if (v && (v.r !== -dir.r || v.c !== -dir.c)) nextDir = v
    })

    const runner = createRunner()
    runner.start((dt) => {
      if (!over && !paused) {
        acc += dt
        const interval = 1 / speed
        while (acc > interval) {
          acc -= interval
          step()
          if (over) break
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
        runner.stop(); offKey(); offSwipe()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
