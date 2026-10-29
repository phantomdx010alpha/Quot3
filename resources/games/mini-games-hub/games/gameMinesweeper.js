/**
 * 扫雷 —— 首点保证安全（雷在首点后生成）、左开右旗、空白连锁展开。
 * 计时制：越快越好，最高分走「更低更好」通道（模块标记 bestLower）。
 * DOM 实现：注入一次性 <style>，destroy 时移除。
 */
import { randInt } from './canvasKit.js'

const LEVELS = {
  easy: { r: 9, c: 9, m: 10, cs: 30 },
  mid: { r: 16, c: 16, m: 40, cs: 26 },
  hard: { r: 16, c: 30, m: 99, cs: 22 },
}
const NUM_COLOR = ['', '#4A90E2', '#2FA57F', '#E05B5B', '#8B7CF0', '#C084FC', '#22A7D3', '#E8EEF9', '#9AA7BD']

const STYLE = `
.gms-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}
.gms-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--muted)}
.gms-chip{background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:4px 12px}
.gms-chip b{color:var(--text)}
.gms-flag-btn{cursor:pointer;user-select:none}
.gms-flag-btn.on{border-color:#F070B0;color:#F070B0}
.gms-grid{display:grid;gap:2px;background:var(--border);padding:4px;border-radius:10px}
.gms-cell{width:var(--cs,26px);height:var(--cs,26px);border:none;border-radius:4px;background:rgba(255,255,255,0.09);color:var(--text);font-size:calc(var(--cs,26px)*0.52);font-weight:700;cursor:pointer;padding:0;line-height:1;display:flex;align-items:center;justify-content:center;font-family:inherit}
.gms-cell:not(.open):hover{background:rgba(255,255,255,0.18)}
.gms-cell.open{background:var(--surface2);cursor:default}
.gms-cell.boom{background:#6E2438}
.gms-cell.flagged{background:rgba(240,112,176,0.28)}
.gms-over{font-weight:700;font-size:14px}
`

export default {
  id: 'minesweeper',
  name: '扫雷',
  bestLower: true,
  options: [{
    key: 'level',
    label: '难度',
    def: 'mid',
    values: [
      { v: 'easy', t: '简单 9×9' },
      { v: 'mid', t: '标准 16×16' },
      { v: 'hard', t: '困难 16×30' },
    ],
  }],

  mount(container, api) {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)

    const wrap = document.createElement('div')
    wrap.className = 'gms-wrap'
    container.appendChild(wrap)

    const level = LEVELS[api.options.level] || LEVELS.mid
    const R = level.r
    const C = level.c
    const M = level.m
    const total = R * C

    const bar = document.createElement('div')
    bar.className = 'gms-bar'
    const chipMine = document.createElement('span')
    chipMine.className = 'gms-chip'
    const chipTime = document.createElement('span')
    chipTime.className = 'gms-chip'
    const flagBtn = document.createElement('button')
    flagBtn.type = 'button'
    flagBtn.className = 'gms-chip gms-flag-btn'
    flagBtn.textContent = '🚩 插旗模式'
    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = 'gms-chip'
    resetBtn.textContent = '🙂 重开'
    bar.append(chipMine, chipTime, flagBtn, resetBtn)
    wrap.appendChild(bar)

    const grid = document.createElement('div')
    grid.className = 'gms-grid'
    grid.style.gridTemplateColumns = `repeat(${C}, var(--cs, ${level.cs}px))`
    grid.style.setProperty('--cs', level.cs + 'px')
    wrap.appendChild(grid)

    const status = document.createElement('div')
    status.className = 'gms-over'
    wrap.appendChild(status)

    let mines, revealed, flagged, started, ended, openedCount, time, timer

    const cellEls = []
    for (let i = 0; i < total; i++) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gms-cell'
      grid.appendChild(b)
      cellEls.push(b)
    }

    const neighbors = (i) => {
      const r = Math.floor(i / C)
      const c = i % C
      const out = []
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && rr < R && cc >= 0 && cc < C) out.push(rr * C + cc)
        }
      }
      return out
    }

    const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    const paintBar = () => {
      chipMine.innerHTML = `💣 剩余 <b>${Math.max(M - flagged.size, 0)}</b>`
      chipTime.innerHTML = `⏱ <b>${fmt(time)}</b>`
    }

    function reset() {
      mines = new Set()
      revealed = new Set()
      flagged = new Set()
      started = false
      ended = false
      openedCount = 0
      time = 0
      status.textContent = ''
      flagBtn.classList.remove('on')
      cellEls.forEach((b) => {
        b.className = 'gms-cell'
        b.textContent = ''
        b.style.color = ''
      })
      clearInterval(timer)
      paintBar()
      api.score(0)
      api.status('')
    }

    function placeMines(safe) {
      const forbidden = new Set([safe, ...neighbors(safe)])
      while (mines.size < Math.min(M, total - forbidden.size)) {
        const i = randInt(0, total - 1)
        if (!forbidden.has(i)) mines.add(i)
      }
    }

    function startTimer() {
      clearInterval(timer)
      timer = setInterval(() => {
        if (ended) return
        time++
        paintBar()
        api.score(time)
      }, 1000)
    }

    function paintCell(i) {
      const b = cellEls[i]
      if (revealed.has(i)) {
        b.classList.add('open')
        if (mines.has(i)) {
          b.classList.add('boom')
          b.textContent = '💣'
        } else {
          const n = neighbors(i).filter((j) => mines.has(j)).length
          if (n) {
            b.textContent = String(n)
            b.style.color = NUM_COLOR[n]
          }
        }
      } else if (flagged.has(i)) {
        b.classList.add('flagged')
        b.textContent = '🚩'
      } else {
        b.textContent = ''
      }
    }

    function open(i) {
      if (ended || revealed.has(i) || flagged.has(i)) return
      if (!started) {
        started = true
        placeMines(i)
        startTimer()
      }
      if (mines.has(i)) {
        ended = true
        revealed.add(i)
        mines.forEach((j) => revealed.add(j))
        cellEls.forEach((_, j) => paintCell(j))
        status.textContent = '💥 踩雷了，按重开再来'
        api.over(time)
        clearInterval(timer)
        return
      }
      // BFS 连锁展开
      const queue = [i]
      while (queue.length) {
        const j = queue.pop()
        if (revealed.has(j) || flagged.has(j) || mines.has(j)) continue
        revealed.add(j)
        openedCount++
        paintCell(j)
        const n = neighbors(j).filter((k) => mines.has(k)).length
        if (!n) neighbors(j).forEach((k) => queue.push(k))
      }
      if (openedCount === total - mines.size) {
        ended = true
        clearInterval(timer)
        status.textContent = `🎉 排雷成功！用时 ${fmt(time)}`
        api.win(time)
      }
    }

    function toggleFlag(i) {
      if (ended || revealed.has(i)) return
      if (flagged.has(i)) flagged.delete(i)
      else flagged.add(i)
      paintCell(i)
      paintBar()
    }

    let flagMode = false
    const offGridClick = addEvt(grid, 'click', (e) => {
      const idx = cellEls.indexOf(e.target)
      if (idx < 0) return
      flagMode ? toggleFlag(idx) : open(idx)
    })
    const offCtx = addEvt(grid, 'contextmenu', (e) => {
      e.preventDefault()
      const idx = cellEls.indexOf(e.target)
      if (idx >= 0) toggleFlag(idx)
    })
    const offFlagBtn = addEvt(flagBtn, 'click', () => {
      flagMode = !flagMode
      flagBtn.classList.toggle('on', flagMode)
    })
    const offReset = addEvt(resetBtn, 'click', reset)

    reset()

    return {
      restart: reset,
      pause() {},
      resume() {},
      destroy() {
        clearInterval(timer)
        offGridClick(); offCtx(); offFlagBtn(); offReset()
        wrap.remove()
        style.remove()
      },
    }
  },
}

function addEvt(el, type, fn) {
  el.addEventListener(type, fn)
  return () => el.removeEventListener(type, fn)
}
