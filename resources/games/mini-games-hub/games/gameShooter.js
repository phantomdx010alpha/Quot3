/**
 * 星空战机 —— 经典蜂群射击。敌机编队左右摆动并缓缓下压，随波次变多变快；
 * 击落整波有奖励分，敌弹与越线都会终结战局。手机端按住拖动 = 移动 + 自动开火。
 */
import {
  setupCanvas, createRunner, onKey, onKeyUp, onPointer, onPointerMove,
  roundRect, centerText, cssVar, rand, randInt, clamp,
} from './canvasKit.js'

const W = 460
const H = 580
const COLS = 8
const ESP = 46 // 敌机间距
const EX0 = (W - (COLS - 1) * ESP) / 2 // 编队最左中心
const EY0 = 96 // 编队起始纵坐标

export default {
  id: 'shooter',
  name: '星空战机',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    /* ---------- 状态 ---------- */
    let wave, score, lives, over, paused, banner
    let px // 玩家 x（W/2 起步）
    let vx = 0
    let keys = {} // 按键状态（按住连发）
    let touch = null // {x} 按住拖动时的目标位置
    let pBullets = [] // 玩家子弹
    let eBullets = []
    let enemies = [] // {c, r, alive}，位置由编队参数推算
    let phase, swayAmp, swaySpeed, baseY, fireTimer, invin, cool
    let stars = []
    let parts = [] // 爆炸粒子

    function initStars() {
      stars = Array.from({ length: 64 }, () => ({
        x: rand(0, W), y: rand(0, H), z: rand(0.3, 1),
      }))
    }

    function spawnWave() {
      enemies = []
      const rows = Math.min(3 + Math.floor((wave - 1) / 2), 5)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < COLS; c++) enemies.push({ c, r, alive: true })
      }
      phase = 0
      swayAmp = 26 + wave * 5
      swaySpeed = 0.9 + wave * 0.14 // rad/s
      baseY = EY0 + Math.min(wave - 1, 4) * 12
      fireTimer = rand(0.8, 1.4)
      banner = { text: `WAVE ${wave}`, t: 1.4 }
      api.status(`第 ${wave} 波 · 剩余 ${enemies.length} 架敌机`)
    }

    function reset() {
      wave = 1
      score = 0
      lives = 3
      over = false
      paused = false
      px = W / 2
      pBullets = []
      eBullets = []
      parts = []
      invin = 0
      cool = 0
      initStars()
      spawnWave()
      api.score(0)
    }

    const enemyXY = (e) => ({
      x: EX0 + e.c * ESP + Math.sin(phase + e.r * 0.35) * swayAmp * 0.4,
      y: baseY + e.r * 44,
    })
    const aliveCount = () => enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)

    function boom(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2)
        const s = rand(40, 240)
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0.3, 0.7), color })
      }
    }

    function hitPlayer() {
      if (invin > 0) return
      lives--
      boom(px, H - 46, '#5B93F5', 26)
      invin = 1.8
      if (lives <= 0) {
        over = true
        api.over(score)
      }
    }

    function update(dt) {
      // 星空滚动（两层视差）
      for (const s of stars) {
        s.y += (14 + s.z * 42) * dt
        if (s.y > H) { s.y = -2; s.x = rand(0, W) }
      }
      if (over || paused) return

      /* 玩家移动 */
      const SP = 320
      if (keys.left) vx = -SP
      else if (keys.right) vx = SP
      else vx = 0
      px += vx * dt
      if (touch) px += clamp(touch.x * W - px, -SP * 1.4 * dt, SP * 1.4 * dt) // 指针跟随，限速
      px = clamp(px, 26, W - 26)

      /* 自动/手动开火 */
      cool -= dt
      const firing = keys.fire || touch
      if (firing && cool <= 0 && pBullets.length < 4) {
        pBullets.push({ x: px, y: H - 62 })
        cool = 0.22
      }
      pBullets = pBullets.filter((b) => {
        b.y -= 560 * dt
        return b.y > -12
      })

      /* 编队运动 */
      phase += swaySpeed * dt
      const alive = aliveCount()
      baseY += (3.2 + wave * 0.5) * (1 + (enemies.length - alive) / enemies.length) * dt * 3
      if (banner) {
        banner.t -= dt
        if (banner.t <= 0) banner = null
      }

      /* 敌机开火 */
      fireTimer -= dt
      if (fireTimer <= 0 && alive) {
        fireTimer = rand(0.5, 1.25) / (1 + wave * 0.12)
        // 优先让每列最下方的敌机开火（更贴近经典）
        const byCol = {}
        for (const e of enemies) {
          if (!e.alive) continue
          if (!byCol[e.c] || e.r > byCol[e.c].r) byCol[e.c] = e
        }
        const shooter = byCol[Object.keys(byCol)[randInt(0, Object.keys(byCol).length - 1)]]
        const { x, y } = enemyXY(shooter)
        eBullets.push({ x, y: y + 12 })
      }
      eBullets = eBullets.filter((b) => {
        b.y += (150 + wave * 18) * dt
        return b.y < H + 12
      })

      /* 子弹 ↔ 敌机 */
      for (const e of enemies) {
        if (!e.alive) continue
        const { x, y } = enemyXY(e)
        for (const b of pBullets) {
          if (Math.abs(b.x - x) < 17 && Math.abs(b.y - y) < 15) {
            e.alive = false
            b.y = -99
            const gain = e.r === 0 ? 30 : e.r <= 1 ? 20 : 10
            score += gain
            api.score(score)
            boom(x, y, e.r === 0 ? '#F0C05A' : '#A78BFA', 12)
            break
          }
        }
      }
      pBullets = pBullets.filter((b) => b.y > -12)

      /* 敌弹 ↔ 玩家 */
      if (invin > 0) invin -= dt
      for (const b of eBullets) {
        if (Math.abs(b.x - px) < 15 && b.y > H - 64 && b.y < H - 30) {
          b.y = H + 99
          hitPlayer()
        }
      }
      eBullets = eBullets.filter((b) => b.y < H + 12)

      /* 敌机撞到玩家 / 越过防线 */
      for (const e of enemies) {
        if (!e.alive) continue
        const { x, y } = enemyXY(e)
        if (Math.abs(x - px) < 26 && Math.abs(y - (H - 46)) < 22) { hitPlayer(); e.alive = false; boom(x, y, '#F070B0', 12) }
        else if (y > H - 78) {
          over = true
          boom(x, y, '#E05B5B', 16)
          api.over(score)
          return
        }
      }

      /* 通关一波 */
      if (!aliveCount()) {
        score += 100 + wave * 25
        api.score(score)
        api.status(`第 ${wave} 波清空！奖励 +${100 + wave * 25}`)
        wave++
        spawnWave()
      }

      /* 粒子 */
      parts = parts.filter((p) => {
        p.t -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.96
        p.vy *= 0.96
        return p.t > 0
      })
    }

    /* ---------- 绘制 ---------- */
    const ROW_COLOR = ['#F0C05A', '#A78BFA', '#5B93F5', '#F070B0', '#22D3EE']

    function drawEnemy(x, y, r) {
      const color = ROW_COLOR[r % ROW_COLOR.length]
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath(); ctx.ellipse(x, y + 9, 13, 4, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = color
      roundRect(ctx, x - 13, y - 4, 26, 11, 5); ctx.fill() // 底盘
      ctx.beginPath(); ctx.arc(x, y - 4, 7.5, Math.PI, 0); ctx.fill() // 圆顶
      ctx.fillStyle = 'rgba(10,14,28,0.85)'
      ctx.beginPath(); ctx.arc(x, y - 5, 3, 0, Math.PI * 2); ctx.fill() // 舷窗
    }

    function drawPlayer() {
      if (invin > 0 && Math.floor(invin * 12) % 2 === 0) return // 受击闪烁
      const y = H - 46
      // 尾焰
      const f = 8 + Math.sin(performance.now() / 40) * 3
      ctx.fillStyle = 'rgba(122,162,255,0.85)'
      ctx.beginPath()
      ctx.moveTo(px - 6, y + 12); ctx.lineTo(px, y + 12 + f); ctx.lineTo(px + 6, y + 12); ctx.closePath(); ctx.fill()
      // 机身
      ctx.fillStyle = '#5B93F5'
      ctx.beginPath()
      ctx.moveTo(px, y - 18); ctx.lineTo(px + 17, y + 12); ctx.lineTo(px + 6, y + 8); ctx.lineTo(px, y + 12)
      ctx.lineTo(px - 6, y + 8); ctx.lineTo(px - 17, y + 12); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#E8F2FF'
      ctx.beginPath(); ctx.arc(px, y - 4, 3.2, 0, Math.PI * 2); ctx.fill() // 座舱
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      for (const s of stars) {
        ctx.fillStyle = `rgba(180,200,255,${0.18 + s.z * 0.5})`
        ctx.fillRect(s.x, s.y, s.z > 0.7 ? 2 : 1, s.z > 0.7 ? 2 : 1)
      }

      // 底部防线
      ctx.strokeStyle = 'rgba(224,91,91,0.35)'
      ctx.setLineDash([6, 6]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, H - 78); ctx.lineTo(W, H - 78); ctx.stroke()
      ctx.setLineDash([])

      for (const e of enemies) if (e.alive) { const { x, y } = enemyXY(e); drawEnemy(x, y, e.r) }

      for (const b of pBullets) {
        ctx.fillStyle = '#7EE2B8'
        roundRect(ctx, b.x - 2, b.y - 8, 4, 12, 2); ctx.fill()
        ctx.fillStyle = 'rgba(126,226,184,0.25)'
        roundRect(ctx, b.x - 4, b.y - 10, 8, 18, 4); ctx.fill()
      }
      for (const b of eBullets) {
        ctx.fillStyle = '#F070B0'
        ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill()
      }

      for (const p of parts) {
        ctx.globalAlpha = Math.max(p.t / 0.7, 0)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
      }
      ctx.globalAlpha = 1

      if (!over) drawPlayer()

      // HUD
      for (let i = 0; i < lives; i++) {
        const hx = 24 + i * 20
        ctx.fillStyle = '#F070B0'
        ctx.beginPath(); ctx.arc(hx, 26, 4, 0, Math.PI * 2); ctx.arc(hx + 8, 26, 4, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.moveTo(hx - 4, 28); ctx.lineTo(hx + 4, 38); ctx.lineTo(hx + 12, 28); ctx.closePath(); ctx.fill()
      }
      centerText(ctx, `WAVE ${wave}`, W - 40, 28, 13, 'rgba(232,238,249,0.7)', '600')

      if (banner) {
        ctx.globalAlpha = Math.min(banner.t / 0.4, 1)
        centerText(ctx, banner.text, W / 2, H / 2 - 40, 40, '#FFFFFF')
        ctx.globalAlpha = 1
      }

      if (paused && !over) centerText(ctx, '已暂停 · P 继续', W / 2, H / 2, 24, '#FFFFFF')
      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, '战机坠毁', W / 2, H / 2 - 30, 34, '#E05B5B')
        centerText(ctx, `本局 ${score} 分 · 抵达第 ${wave} 波`, W / 2, H / 2 + 12, 18, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 重开', W / 2, H / 2 + 48, 15, 'rgba(232,238,249,0.55)', '500')
      }
    }

    /* ---------- 输入 ---------- */
    const offKey = onKey((e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; e.preventDefault() }
      if (e.key === ' ' || e.key === 'j' || e.key === 'J') { keys.fire = true; e.preventDefault() }
      if (e.key === 'p' || e.key === 'P') paused = !paused
      if (e.key === 'r' || e.key === 'R') reset()
    })
    const offKeyUp = onKeyUp((e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false
      if (e.key === ' ' || e.key === 'j' || e.key === 'J') keys.fire = false
    })
    const offDown = onPointer(canvas, (x) => { touch = { x } })
    const offMove = onPointerMove(canvas, (x) => { if (touch) touch = { x } })
    const upFn = () => { touch = null }
    canvas.addEventListener('pointerup', upFn)
    canvas.addEventListener('pointercancel', upFn)

    const runner = createRunner()
    runner.start((dt) => { update(dt); draw() })

    reset()

    return {
      restart: reset,
      pause() { paused = true },
      resume() { paused = false },
      destroy() {
        runner.stop(); offKey(); offKeyUp(); offDown(); offMove()
        canvas.removeEventListener('pointerup', upFn)
        canvas.removeEventListener('pointercancel', upFn)
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
