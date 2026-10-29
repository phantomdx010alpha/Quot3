/**
 * 跑酷小恐龙 —— 无尽跑酷。可变高度跳跃（早松手跳得矮）、空中按下加速下落、
 * 下蹲缩小身位躲低空翼龙；每 800 分一次昼夜循环。距离即分数。
 */
import {
  setupCanvas, createRunner, onKey, onKeyUp, onPointer,
  roundRect, centerText, cssVar, rand, randInt, clamp,
} from './canvasKit.js'

const W = 760
const H = 300
const GY = 252 // 地面基线

export default {
  id: 'dino',
  name: '跑酷小恐龙',

  mount(container, api) {
    const boardBg = cssVar('--surface2', '#0F1730')
    const { canvas, ctx } = setupCanvas(container, W, H)

    /* ---------- 状态 ---------- */
    let dist, speed, score, over, paused, dead
    let y, vy, ducking, onGround // 恐龙纵向（y=脚底离地高度）
    let obstacles, sinceSpawn, nextGap, nextMile, mileFlash
    let clouds, grounds, stars
    let legPhase

    function initScenery() {
      clouds = Array.from({ length: 3 }, () => ({ x: rand(0, W), y: rand(28, 90), s: rand(0.6, 1) }))
      grounds = Array.from({ length: 26 }, () => ({ x: rand(0, W), w: rand(8, 30) }))
      stars = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, 150), a: rand(0.2, 0.9) }))
    }

    function spawn() {
      const pteroOK = score > 250 && Math.random() < 0.28
      if (pteroOK) {
        const hy = [GY - 92, GY - 58, GY - 150][randInt(0, 2)] // 中低要下蹲/跳、高处无忧
        obstacles.push({ type: 'ptero', x: W + 60, y: hy, flap: rand(0, 6) })
      } else {
        const n = randInt(1, 3)
        const stems = []
        for (let i = 0; i < n; i++) stems.push({ h: rand(40, 66), w: rand(14, 19) })
        const total = stems.reduce((s, t) => s + t.w + 3, -3)
        obstacles.push({ type: 'cactus', x: W + 60, stems, w: total, h: Math.max(...stems.map((s) => s.h)) })
      }
      nextGap = rand(260, 560) + speed * 0.4
    }

    function reset() {
      dist = 0
      speed = 330
      score = 0
      over = false
      paused = false
      dead = false
      y = 0
      vy = 0
      ducking = false
      onGround = true
      obstacles = []
      sinceSpawn = 0
      nextGap = 420
      nextMile = 100
      mileFlash = 0
      legPhase = 0
      initScenery()
      api.score(0)
      api.status('空格 / 点击起跑，↓ 下蹲')
    }

    function jump() {
      if (over) { reset(); return }
      if (onGround && !paused) {
        vy = 840
        onGround = false
        ducking = false
      }
    }

    function die() {
      over = true
      dead = true
      api.over(score)
    }

    /** 恐龙碰撞盒（站立/下蹲两套；空中不缩身） */
    function dinoBox() {
      const x = 70
      if (ducking && onGround) return { x: x + 4, y: GY - 32 + 4, w: 54, h: 28 }
      return { x: x + 8, y: GY - y - 58 + 6, w: 28, h: 50 }
    }
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

    function update(dt) {
      if (over || paused) return
      speed = Math.min(880, speed + 8 * dt)
      dist += speed * dt
      const ns = Math.floor(dist / 8)
      if (ns !== score) {
        score = ns
        api.score(score)
        if (score >= nextMile) {
          mileFlash = 0.9
          nextMile += 100
        }
      }
      if (mileFlash > 0) mileFlash -= dt

      /* 纵向物理：可变跳跃（松手截断）+ 空中按 ↓ 加速坠落 */
      if (!onGround) {
        const g = ducking ? 2500 * 2.2 : 2500
        vy -= g * dt
        y += vy * dt
        if (y <= 0) { y = 0; vy = 0; onGround = true }
      }
      legPhase += dt * (speed / 60)

      /* 障碍 */
      sinceSpawn += speed * dt
      if (sinceSpawn > nextGap) {
        sinceSpawn = 0
        spawn()
      }
      const db = dinoBox()
      obstacles = obstacles.filter((o) => {
        o.x -= (speed + (o.type === 'ptero' ? 60 : 0)) * dt
        if (o.type === 'ptero') o.flap += dt * 10
        const box = o.type === 'ptero'
          ? { x: o.x - 16, y: o.y - 10, w: 34, h: 20 }
          : { x: o.x - 3, y: GY - o.h + 3, w: o.w + 6, h: o.h }
        if (hit(db, box)) die()
        return o.x > -80
      })

      /* 滚动布景 */
      for (const c of clouds) {
        c.x -= speed * 0.22 * dt * c.s
        if (c.x < -90) { c.x = W + 60; c.y = rand(28, 90) }
      }
      for (const g of grounds) {
        g.x -= speed * dt
        if (g.x < -30) { g.x = W + rand(0, 40); g.w = rand(8, 30) }
      }
    }

    /* ---------- 绘制 ---------- */
    // 昼夜因子：0 白天 → 1 深夜，每 800 分一轮
    const nightK = () => 0.5 - 0.5 * Math.cos((Math.PI * 2 * score) / 800)

    function drawDino() {
      const x = 70
      const top = GY - y - (ducking && onGround ? 32 : 58)
      ctx.fillStyle = '#5B93F5'
      if (ducking && onGround) {
        roundRect(ctx, x, top, 58, 32, 12); ctx.fill() // 匍匐身位
        ctx.fillStyle = '#06283D'
        ctx.beginPath(); ctx.arc(x + 44, top + 11, 3, 0, Math.PI * 2); ctx.fill()
        return
      }
      const t = performance.now()
      roundRect(ctx, x, top + 16, 36, 34, 10); ctx.fill() // 身体
      roundRect(ctx, x + 18, top, 26, 22, 9); ctx.fill() // 头
      // 尾
      ctx.beginPath()
      ctx.moveTo(x, top + 24); ctx.lineTo(x - 14, top + 18); ctx.lineTo(x, top + 34); ctx.closePath(); ctx.fill()
      // 眼
      ctx.fillStyle = '#06283D'
      ctx.beginPath(); ctx.arc(x + 36, top + 8, 3.4, 0, Math.PI * 2); ctx.fill()
      if (dead) { // 惊恐眼
        ctx.strokeStyle = '#06283D'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(x + 33, top + 5); ctx.lineTo(x + 39, top + 11)
        ctx.moveTo(x + 39, top + 5); ctx.lineTo(x + 33, top + 11); ctx.stroke()
      }
      // 腿：地面奔跑交替，空中收起
      ctx.fillStyle = '#5B93F5'
      const f = Math.floor(legPhase * 2) % 2
      const legY = GY - y - 8
      if (onGround) {
        roundRect(ctx, x + 6 + (f ? 4 : 0), legY, 10, 8 + (f ? 4 : 0), 3); ctx.fill()
        roundRect(ctx, x + 22 - (f ? 4 : 0), legY, 10, 8 + (f ? 0 : 4), 3); ctx.fill()
      } else {
        roundRect(ctx, x + 8, legY, 10, 9, 3); ctx.fill()
        roundRect(ctx, x + 22, legY, 10, 7, 3); ctx.fill()
      }
    }

    function drawCactus(o) {
      ctx.fillStyle = '#3FBF8F'
      let cx = o.x
      for (const s of o.stems) {
        roundRect(ctx, cx, GY - s.h, s.w, s.h, s.w / 2); ctx.fill()
        roundRect(ctx, cx - 4, GY - s.h * 0.6, 5, 4, 2); ctx.fill()
        roundRect(ctx, cx + s.w - 1, GY - s.h * 0.75, 5, 4, 2); ctx.fill()
        cx += s.w + 3
      }
    }

    function drawPtero(o) {
      const up = Math.sin(o.flap) > 0
      ctx.fillStyle = '#F0A25A'
      ctx.beginPath(); ctx.ellipse(o.x, o.y, 15, 8, 0, 0, Math.PI * 2); ctx.fill() // 身体
      ctx.beginPath() // 喙
      ctx.moveTo(o.x + 13, o.y - 3); ctx.lineTo(o.x + 26, o.y); ctx.lineTo(o.x + 13, o.y + 3); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#D9822B'
      ctx.beginPath() // 翅膀上下拍
      if (up) { ctx.moveTo(o.x - 4, o.y - 2); ctx.lineTo(o.x - 2, o.y - 22); ctx.lineTo(o.x + 10, o.y - 4) }
      else { ctx.moveTo(o.x - 4, o.y + 2); ctx.lineTo(o.x - 2, o.y + 16); ctx.lineTo(o.x + 10, o.y + 4) }
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#06283D'
      ctx.beginPath(); ctx.arc(o.x + 8, o.y - 3, 1.8, 0, Math.PI * 2); ctx.fill()
    }

    function draw() {
      const nk = nightK()
      ctx.clearRect(0, 0, W, H)
      roundRect(ctx, 0, 0, W, H, 16)
      ctx.fillStyle = boardBg
      ctx.fill()

      // 日月同框淡入淡出
      if (nk < 0.98) {
        ctx.globalAlpha = 1 - nk
        ctx.fillStyle = '#F5D06A'
        ctx.beginPath(); ctx.arc(W - 110, 64, 20, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(245,208,106,0.25)'
        ctx.beginPath(); ctx.arc(W - 110, 64, 30, 0, Math.PI * 2); ctx.fill()
      }
      if (nk > 0.02) {
        ctx.globalAlpha = nk
        ctx.fillStyle = '#DCE5F5'
        ctx.beginPath(); ctx.arc(W - 110, 64, 16, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = boardBg
        ctx.beginPath(); ctx.arc(W - 103, 59, 13, 0, Math.PI * 2); ctx.fill()
        for (const s of stars) {
          ctx.globalAlpha = nk * s.a
          ctx.fillStyle = '#DCE5F5'
          ctx.fillRect(s.x, s.y, 2, 2)
        }
      }
      ctx.globalAlpha = 1

      for (const c of clouds) {
        ctx.fillStyle = `rgba(190,205,235,${0.5 - nk * 0.25})`
        roundRect(ctx, c.x, c.y, 52 * c.s, 12 * c.s, 8); ctx.fill()
        roundRect(ctx, c.x + 10 * c.s, c.y - 8 * c.s, 26 * c.s, 12 * c.s, 8); ctx.fill()
      }

      // 地面
      ctx.strokeStyle = 'rgba(160,180,215,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, GY + 1); ctx.lineTo(W, GY + 1); ctx.stroke()
      ctx.fillStyle = 'rgba(160,180,215,0.28)'
      for (const g of grounds) ctx.fillRect(g.x, GY + 10 + (g.w % 3) * 4, g.w, 2)

      for (const o of obstacles) o.type === 'cactus' ? drawCactus(o) : drawPtero(o)
      drawDino()

      // 夜幕叠加
      if (nk > 0.02) {
        ctx.fillStyle = `rgba(8,12,30,${nk * 0.4})`
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
      }

      if (mileFlash > 0) {
        ctx.globalAlpha = Math.min(mileFlash / 0.4, 1)
        centerText(ctx, `${score}!`, W / 2, 60, 26, '#7EE2B8')
        ctx.globalAlpha = 1
      }
      if (paused && !over) centerText(ctx, '已暂停 · P 继续', W / 2, H / 2, 24, '#FFFFFF')
      if (over) {
        ctx.fillStyle = 'rgba(6,10,24,0.72)'
        roundRect(ctx, 0, 0, W, H, 16)
        ctx.fill()
        centerText(ctx, '撞上了！', W / 2, H / 2 - 24, 32, '#E05B5B')
        centerText(ctx, `本局 ${score} 分`, W / 2, H / 2 + 16, 18, 'rgba(232,238,249,0.75)', '500')
        centerText(ctx, '按 R 或点击重跑', W / 2, H / 2 + 50, 15, 'rgba(232,238,249,0.55)', '500')
      }
    }

    /* ---------- 输入 ---------- */
    const offKey = onKey((e) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); jump() }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); ducking = true }
      if (e.key === 'p' || e.key === 'P') paused = !paused
      if (e.key === 'r' || e.key === 'R') reset()
    })
    const offKeyUp = onKeyUp((e) => {
      // 早松手 = 跳矮一截
      if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && vy > 260) vy = 260
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') ducking = false
    })
    const offDown = onPointer(canvas, () => jump())

    const runner = createRunner()
    runner.start((dt) => { update(dt); draw() })

    reset()

    return {
      restart: reset,
      pause() { paused = true },
      resume() { paused = false },
      destroy() {
        runner.stop(); offKey(); offKeyUp(); offDown()
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      },
    }
  },
}
