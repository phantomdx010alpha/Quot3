/**
 * 打地鼠 —— 30 秒限时：普通地鼠连击翻倍、金鼠 +5、炸弹 -3 并清空连击。
 */
import { setupCanvas, createRunner, onKey, onPointer, roundRect, centerText, cssVar, rand, randInt, clamp } from './canvasKit.js'

const W = 420
const H = 500
const ROUND = 30
const HOLES = []
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) HOLES.push({ x: 70 + c * 140, y: 190 + r * 105 })

export default {
  id: 'whack',
  name: '打地鼠',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    let moles, score, combo, left, over, paused, spawnAcc

    function reset() {
      moles = [] // {hole, kind, t, life, up(0~1), hit}
      score = 0
      combo = 1
      left = ROUND
      over = false
      paused = false
      spawnAcc = 0
      api.score(0)
      api.status('')
    }

    function spawn() {
      const taken = new Set(moles.map((m) => m.hole))
      const free = HOLES.map((_, i) => i).filter((i) => !taken.has(i))
      if (!free.length) return
      const hole = free[randInt(0, free.length - 1)]
      const roll = Math.random()
      const kind = roll < 0.14 ? 'gold' : roll < 0.3 ? 'bomb' : 'normal'
      const life = kind === 'gold' ? 0.75 : kind === 'bomb' ? 1.1 : rand(0.8, 1.25)
      moles.push({ hole, kind, t: 0, life, up: 0, hit: false })
    }

    function whack(x, y) {
      if (over || paused) return
      // 命中判定：离哪个洞口近且地鼠已冒头
      let best = null
      let bestD = 1e9
      for (const m of moles) {
        if (m.hit) continue
        const h = HOLES[m.hole]
        const d = Math.hypot(h.x - x, h.y - m.up * 34 - y)
        if (d < 52 && d < bestD) {
          bestD = d
          best = m
        }
      }
      const idx = HOLES.findIndex((h) => Math.hypot(h.x - x, h.y - y) < 55)
      if (best) {
        best.hit = true
        if (best.kind === 'bomb') {
          score = Math.max(0, score - 3)
          combo = 1
          api.status('💥 炸弹！连击清零')
        } else {
          const base = best.kind === 'gold' ? 5 : 1
          score += base * combo
          combo = Math.min(8, combo + 1)
        }
        api.score(score)
      } else if (idx >= 0) {
        combo = 1
      }
    }

    function step(dt) {
      left -= dt
      if (left <= 0) {
        left = 0
        over = true
        api.over(score)
        return
      }
      spawnAcc += dt
      const interval = Math.max(0.34, 0.85 - (ROUND - left) * 0.015)
      if (spawnAcc > interval) {
        spawnAcc = 0
        spawn()
      }
      moles.forEach((m) => {
        m.t += dt
        m.up = m.hit ? Math.max(0, m.up - dt * 8) : clamp(m.t / 0.14, 0, 1) * (m.t > m.life ? clamp(1 - (m.t - m.life) / 0.12, 0, 1) : 1)
      })
      moles = moles.filter((m) => m.t < m.life + 0.14)
    }

    function drawMole(h, m) {
      if (m.up <= 0.02) return
      const y = h.y - m.up * 34
      ctx.save()
      // 从洞口冒出（裁剪）
      ctx.beginPath()
      ctx.rect(h.x - 46, h.y - 90, 92, 92)
      ctx.clip()
      const body = m.kind === 'gold' ? '#F0D878' : m.kind === 'bomb' ? '#20242E' : '#8A5A3B'
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.ellipse(h.x, y + 8, 30 * m.up, 34 * m.up, 0, 0, Math.PI * 2)
      ctx.fill()
      if (m.kind === 'bomb') {
        ctx.strokeStyle = '#F0A24F'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(h.x + 6, y - 26 * m.up)
        ctx.quadraticCurveTo(h.x + 16, y - 40 * m.up, h.x + 10, y - 46 * m.up)
        ctx.stroke()
        ctx.fillStyle = '#FF5C8A'
        ctx.beginPath(); ctx.arc(h.x + 10, y - 48 * m.up, 4, 0, Math.PI * 2); ctx.fill()
      } else {
        // 脸
        ctx.fillStyle = '#2B1A10'
        ctx.beginPath(); ctx.arc(h.x - 10 * m.up, y - 4 * m.up, 3.4 * m.up, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(h.x + 10 * m.up, y - 4 * m.up, 3.4 * m.up, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.ellipse(h.x, y + 10 * m.up, 8 * m.up, 5 * m.up, 0, 0, Math.PI * 2); ctx.fill()
        if (m.kind === 'gold') {
          centerText(ctx, '★', h.x, y - 22 * m.up, 14 * m.up, '#FFFFFF')
        }
      }
      ctx.restore()
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()
      // 顶栏
      centerText(ctx, `⏱ ${left.toFixed(1)}s`, W / 2 - 110, 52, 20, left < 6 ? '#FF5C8A' : '#FFFFFF', '700')
      centerText(ctx, `连击 x${combo}`, W / 2, 52, 18, '#22D3EE', '700')
      centerText(ctx, `${score} 分`, W / 2 + 110, 52, 20, '#F0D878', '700')

      // 洞
      HOLES.forEach((h) => {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.beginPath()
        ctx.ellipse(h.x, h.y + 26, 48, 16, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'
        ctx.lineWidth = 2
        ctx.stroke()
      })
      moles.forEach((m) => drawMole(HOLES[m.hole], m))
      // 洞前沿（遮住地鼠下半身）
      HOLES.forEach((h) => {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.beginPath()
        ctx.ellipse(h.x, h.y + 26, 48, 12, 0, 0, Math.PI)
        ctx.fill()
      })

      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, '时间到！', W / 2, H / 2 - 16, 34, '#FFFFFF')
        centerText(ctx, `本局 ${score} 分`, W / 2, H / 2 + 24, 18, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 再来一局', W / 2, H / 2 + 58, 15, 'rgba(232,238,249,0.55)', '500')
      } else if (paused) centerText(ctx, '已暂停', W / 2, H / 2, 26, '#FFFFFF')
    }

    // 画布内相对坐标 → 逻辑坐标（onPointer 给的是 0~1 比例）
    const offPointer = onPointer(canvas, (rx, ry, e) => {
      e.preventDefault()
      whack(rx * W, ry * H)
    })
    const offKey = onKey((e) => {
      if (e.key === 'r' || e.key === 'R') reset()
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
        runner.stop(); offPointer(); offKey()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
