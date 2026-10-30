/**
 * Flappy Bird —— 点按/空格扑翅，穿管得分，10/20/30 分解锁铜银金奖牌。
 */
import { setupCanvas, createRunner, onKey, onPointer, roundRect, centerText, cssVar, clamp } from './canvasKit.js'

const W = 380
const H = 560
const GROUND = H - 56

export default {
  id: 'flappy',
  name: 'Bird Flight',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    let bird, pipes, score, over, started, paused, dist

    function reset() {
      bird = { x: 96, y: H / 2 - 40, vy: 0 }
      pipes = []
      score = 0
      over = false
      started = false
      paused = false
      dist = 0
      api.score(0)
      api.status('')
    }

    function flap() {
      if (over) return
      started = true
      bird.vy = -330
    }

    function spawnPipe() {
      const gap = Math.max(128, 168 - score * 2)
      const top = 60 + Math.random() * (GROUND - gap - 160)
      pipes.push({ x: W + 40, top, gap, passed: false })
    }

    function step(dt) {
      if (!started) return
      bird.vy += 1250 * dt
      bird.y += bird.vy * dt
      dist += dt

      if (dist > 1.55) {
        dist = 0
        spawnPipe()
      }
      const speed = 150 + score * 3
      for (const p of pipes) {
        p.x -= speed * dt
        if (!p.passed && p.x + 54 < bird.x) {
          p.passed = true
          score++
          api.score(score)
        }
      }
      pipes = pipes.filter((p) => p.x > -80)

      // 碰撞：地面 / 顶 / 管
      if (bird.y + 12 > GROUND || bird.y - 12 < 0) return die()
      for (const p of pipes) {
        if (bird.x + 11 > p.x && bird.x - 11 < p.x + 54) {
          if (bird.y - 11 < p.top || bird.y + 11 > p.top + p.gap) return die()
        }
      }
    }

    function die() {
      over = true
      api.over(score)
    }

    function drawPipe(p) {
      ctx.fillStyle = '#3FCFA8'
      roundRect(ctx, p.x, 0, 54, p.top, 6)
      ctx.fill()
      roundRect(ctx, p.x, p.top + p.gap, 54, GROUND - p.top - p.gap, 6)
      ctx.fill()
      // 管口加粗
      ctx.fillStyle = '#2FA57F'
      roundRect(ctx, p.x - 4, p.top - 16, 62, 16, 5)
      ctx.fill()
      roundRect(ctx, p.x - 4, p.top + p.gap, 62, 16, 5)
      ctx.fill()
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()
      // 星点背景
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      for (let i = 0; i < 24; i++) {
        const x = (i * 173 + 40) % W
        const y = (i * 97 + 30) % GROUND
        ctx.fillRect(x, y, 2, 2)
      }
      pipes.forEach(drawPipe)
      // 地面
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(0, GROUND, W, H - GROUND)
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke()
      // 小鸟
      ctx.save()
      ctx.translate(bird.x, bird.y)
      ctx.rotate(clamp(bird.vy / 600, -0.5, 0.9))
      ctx.fillStyle = '#F0D878'
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#F0A24F'
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(18, -4); ctx.lineTo(18, 4); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath(); ctx.arc(4, -4, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#06283D'
      ctx.beginPath(); ctx.arc(5.4, -4, 2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#F070B0'
      ctx.beginPath(); ctx.ellipse(-4, 3, 6, 4 - Math.sin(performance.now() / 90) * 2, -0.4, 0, Math.PI * 2); ctx.fill()
      ctx.restore()

      if (!started && !over) {
        centerText(ctx, 'Click / Space to flap', W / 2, H / 2 - 60, 18, '#FFFFFF')
        centerText(ctx, 'Pass through the pipe gaps to score', W / 2, H / 2 - 34, 13, 'rgba(232,238,249,0.6)', '500')
      }
      if (over) {
        const medal = score >= 30 ? '🥇' : score >= 20 ? '🥈' : score >= 10 ? '🥉' : ''
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, `${medal} fell`, W / 2, H / 2 - 16, 32, '#FFFFFF')
        centerText(ctx, `Score: ${score} pts`, W / 2, H / 2 + 24, 17, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, 'Press R or click to restart', W / 2, H / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      } else if (paused) centerText(ctx, 'Paused', W / 2, H / 2, 26, '#FFFFFF')
    }

    const offPointer = onPointer(canvas, (_x, _y, e) => {
      e.preventDefault()
      if (over) {
        reset()
        return
      }
      flap()
    })
    const offKey = onKey((e) => {
      if (e.key === ' ') {
        e.preventDefault()
        if (over) reset()
        else flap()
      } else if (e.key === 'r' || e.key === 'R') reset()
      else if (e.key === 'p' || e.key === 'P') paused = !paused
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
        runner.stop(); offKey(); offPointer()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
