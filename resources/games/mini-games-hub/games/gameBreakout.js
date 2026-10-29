/**
 * 打砖块 —— 挡板反弹、击球角度随命中位置变化、多层砖（上两排要打两次）、3 条命、过关提速。
 */
import { setupCanvas, createRunner, onKey, onPointer, roundRect, centerText, cssVar, clamp } from './canvasKit.js'

const W = 460
const H = 560
const COLS = 8
const ROWS = 6
const BW = (W - 24 - (COLS - 1) * 6) / COLS
const BH = 20
const COLORS = ['#FF5C8A', '#F0A24F', '#F0D878', '#6FD3A5', '#22D3EE', '#3F7FBF']

export default {
  id: 'breakout',
  name: '打砖块',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    let paddle, ball, bricks, score, lives, level, over, launched, paused

    function buildBricks() {
      bricks = []
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          bricks.push({
            x: 12 + c * (BW + 6),
            y: 64 + r * (BH + 6),
            hp: r < 2 ? 2 : 1,
            color: COLORS[r % COLORS.length],
          })
        }
      }
    }

    function resetBall() {
      ball = { x: paddle.x + paddle.w / 2, y: paddle.y - 9, vx: 0, vy: 0, r: 7 }
      launched = false
    }

    function reset() {
      paddle = { x: W / 2 - 45, y: H - 40, w: 90, h: 12 }
      score = 0
      lives = 3
      level = 1
      over = false
      paused = false
      buildBricks()
      resetBall()
      api.score(0)
      api.status('')
    }

    function launch() {
      if (launched || over) return
      const a = (-60 - Math.random() * 60) * (Math.PI / 180)
      const sp = 300 + level * 30
      ball.vx = Math.cos(a) * sp
      ball.vy = Math.sin(a) * sp
      launched = true
    }

    function step(dt) {
      if (!launched) {
        ball.x = paddle.x + paddle.w / 2
        ball.y = paddle.y - 9
        return
      }
      ball.x += ball.vx * dt
      ball.y += ball.vy * dt
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) }
      if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx) }
      if (ball.y < 46 + ball.r) { ball.y = 46 + ball.r; ball.vy = Math.abs(ball.vy) }

      // 挡板：命中位置决定反弹角
      if (ball.vy > 0 && ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 10 &&
          ball.x >= paddle.x - 4 && ball.x <= paddle.x + paddle.w + 4) {
        const hit = clamp((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1)
        const a = hit * (Math.PI / 3) // 最大 60°
        const sp = Math.min(560, Math.hypot(ball.vx, ball.vy) * 1.015)
        ball.vx = Math.sin(a) * sp
        ball.vy = -Math.cos(a) * sp
        ball.y = paddle.y - ball.r
      }

      // 砖块
      for (const b of bricks) {
        if (b.hp <= 0) continue
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + BW && ball.y + ball.r > b.y && ball.y - ball.r < b.y + BH) {
          const overlapX = Math.min(ball.x + ball.r - b.x, b.x + BW - (ball.x - ball.r))
          const overlapY = Math.min(ball.y + ball.r - b.y, b.y + BH - (ball.y - ball.r))
          if (overlapX < overlapY) ball.vx = -ball.vx
          else ball.vy = -ball.vy
          b.hp--
          score += 10 * level
          api.score(score)
          break
        }
      }

      // 过关 / 掉命
      if (bricks.every((b) => b.hp <= 0)) {
        level++
        buildBricks()
        resetBall()
        api.status(`第 ${level} 关，球速提升`)
      }
      if (ball.y > H + 20) {
        lives--
        if (lives <= 0) {
          over = true
          api.over(score)
        } else {
          resetBall()
          api.status(`剩 ${lives} 条命`)
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()
      // 顶部信息
      centerText(ctx, `分数 ${score}`, W / 2 - 90, 30, 15, '#FFFFFF', '600')
      centerText(ctx, `命 ${'●'.repeat(Math.max(lives, 0))}`, W / 2 + 10, 30, 15, '#F070B0', '600')
      centerText(ctx, `第 ${level} 关`, W - 60, 30, 13, 'rgba(232,238,249,0.6)', '500')
      // 砖
      for (const b of bricks) {
        if (b.hp <= 0) continue
        roundRect(ctx, b.x, b.y, BW, BH, 5)
        ctx.globalAlpha = b.hp === 2 ? 1 : 0.62
        ctx.fillStyle = b.color
        ctx.fill()
        ctx.globalAlpha = 1
      }
      // 挡板
      roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 6)
      ctx.fillStyle = '#4A90E2'
      ctx.fill()
      // 球
      ctx.fillStyle = '#F0D878'
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
      ctx.fill()
      // 未发射提示
      if (!launched && !over) centerText(ctx, '点击 / 空格 发球', W / 2, H - 80, 14, 'rgba(232,238,249,0.6)', '500')

      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, 'Game Over', W / 2, H / 2 - 16, 34, '#FFFFFF')
        centerText(ctx, `本局 ${score} 分 · 第 ${level} 关`, W / 2, H / 2 + 24, 17, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 重开', W / 2, H / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      } else if (paused) centerText(ctx, '已暂停', W / 2, H / 2, 26, '#FFFFFF')
    }

    const movePaddle = (clientXRatio) => {
      const rect = canvas.getBoundingClientRect()
      const x = clientXRatio * rect.width
      paddle.x = clamp(x - paddle.w / 2, 0, W - paddle.w)
    }
    const offPointer = onPointer(canvas, (x, _y, e) => {
      e.preventDefault()
      if (over) return
      movePaddle(x)
      launch()
    })
    const offMove = (() => {
      const fn = (e) => {
        if (over || paused) return
        const r = canvas.getBoundingClientRect()
        movePaddle((e.clientX - r.left) / r.width)
      }
      canvas.addEventListener('pointermove', fn)
      return () => canvas.removeEventListener('pointermove', fn)
    })()

    const offKey = onKey((e) => {
      if (over) {
        if (e.key === 'r' || e.key === 'R') reset()
        return
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); paddle.x = clamp(paddle.x - 26, 0, W - paddle.w) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); paddle.x = clamp(paddle.x + 26, 0, W - paddle.w) }
      else if (e.key === ' ') { e.preventDefault(); launch() }
      else if (e.key === 'p' || e.key === 'P') paused = !paused
      else if (e.key === 'r' || e.key === 'R') reset()
    })

    const runner = createRunner()
    runner.start((dt) => {
      if (!over && !paused) step(dt)
      draw()
    })

    reset()

    return {
      restart: reset,
      pause() { paused = true },
      resume() { paused = false },
      destroy() {
        runner.stop(); offKey(); offPointer(); offMove()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
