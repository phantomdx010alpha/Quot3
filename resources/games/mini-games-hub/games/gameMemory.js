/**
 * 记忆翻牌 —— 3D 翻转动画，配对消除；用时越短越好（bestLower）。
 */
const EMOJI = ['🍎', '🍌', '🍇', '🍓', '🍒', '🥝', '🍍', '🥑', '🌶️', '🌽', '🍄', '🐙', '🦊', '🐼', '🦄', '🐸', '🐳', '🌙', '⭐', '🔥', '⚡', '🍀', '🎯', '🎨', '🚀', '🎸', '⚽', '🏀', '🎲', '🧩']

const SIZES = {
  easy: { cols: 4, rows: 3, cs: 74 },
  mid: { cols: 4, rows: 4, cs: 64 },
  hard: { cols: 6, rows: 5, cs: 56 },
}

const STYLE = `
.gmm-wrap{display:flex;flex-direction:column;align-items:center;gap:10px}
.gmm-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--muted)}
.gmm-chip{background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:4px 12px}
.gmm-chip b{color:var(--text)}
.gmm-grid{display:grid;gap:8px}
.gmm-card{width:var(--cs,64px);height:var(--cs,64px);perspective:600px;cursor:pointer;border:none;background:none;padding:0}
.gmm-inner{position:relative;width:100%;height:100%;transition:transform .32s ease;transform-style:preserve-3d}
.gmm-card.open .gmm-inner,.gmm-card.done .gmm-inner{transform:rotateY(180deg)}
.gmm-face{position:absolute;inset:0;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:calc(var(--cs,64px)*0.52);backface-visibility:hidden;-webkit-backface-visibility:hidden}
.gmm-front{background:linear-gradient(160deg,hsl(268 55% 24%),var(--surface2));border:1px solid var(--border);color:transparent}
.gmm-back{background:var(--surface2);border:1px solid var(--border);transform:rotateY(180deg)}
.gmm-card.done .gmm-face{opacity:.4}
.gmm-card.done{cursor:default}
.gmm-over{font-weight:700;font-size:14px}
`

export default {
  id: 'memory',
  name: '记忆翻牌',
  bestLower: true,
  options: [{
    key: 'size',
    label: '规模',
    def: 'mid',
    values: [
      { v: 'easy', t: '轻松 4×3' },
      { v: 'mid', t: '标准 4×4' },
      { v: 'hard', t: '困难 6×5' },
    ],
  }],

  mount(container, api) {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)

    const wrap = document.createElement('div')
    wrap.className = 'gmm-wrap'
    container.appendChild(wrap)

    const cfg = SIZES[api.options.size] || SIZES.mid
    const pairs = (cfg.cols * cfg.rows) / 2

    const bar = document.createElement('div')
    bar.className = 'gmm-bar'
    const chipMove = document.createElement('span')
    chipMove.className = 'gmm-chip'
    const chipTime = document.createElement('span')
    chipTime.className = 'gmm-chip'
    const chipPair = document.createElement('span')
    chipPair.className = 'gmm-chip'
    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = 'gmm-chip'
    resetBtn.textContent = '🔄 重开'
    bar.append(chipMove, chipTime, chipPair, resetBtn)
    wrap.appendChild(bar)

    const grid = document.createElement('div')
    grid.className = 'gmm-grid'
    grid.style.gridTemplateColumns = `repeat(${cfg.cols}, var(--cs, ${cfg.cs}px))`
    grid.style.setProperty('--cs', cfg.cs + 'px')
    wrap.appendChild(grid)

    const status = document.createElement('div')
    status.className = 'gmm-over'
    wrap.appendChild(status)

    let deck, openIds, matched, moves, time, timer, lockBoard

    const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    const paint = () => {
      chipMove.innerHTML = `翻牌 <b>${moves}</b>`
      chipTime.innerHTML = `⏱ <b>${fmt(time)}</b>`
      chipPair.innerHTML = `配对 <b>${matched.size}/${pairs}</b>`
    }

    function build() {
      grid.innerHTML = ''
      const pool = EMOJI.slice().sort(() => Math.random() - 0.5).slice(0, pairs)
      deck = pool.concat(pool).sort(() => Math.random() - 0.5)
      deck.forEach((emo, i) => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'gmm-card'
        card.dataset.i = i
        card.innerHTML = `<span class="gmm-inner"><span class="gmm-face gmm-front">?</span><span class="gmm-face gmm-back">${emo}</span></span>`
        grid.appendChild(card)
      })
      openIds = []
      matched = new Set()
      moves = 0
      time = 0
      lockBoard = false
      status.textContent = ''
      clearInterval(timer)
      timer = setInterval(() => {
        if (matched.size < pairs) {
          time++
          paint()
          api.score(time)
        }
      }, 1000)
      paint()
      api.score(0)
      api.status('')
    }

    const cards = () => Array.from(grid.children)

    const offClick = addEvt(grid, 'click', (e) => {
      const card = e.target.closest('.gmm-card')
      if (!card || lockBoard) return
      const i = Number(card.dataset.i)
      if (matched.has(i) || card.classList.contains('open')) return
      card.classList.add('open')
      openIds.push(i)
      if (openIds.length < 2) return
      moves++
      paint()
      const [a, b] = openIds
      if (deck[a] === deck[b]) {
        matched.add(a)
        matched.add(b)
        cards().forEach((c) => {
          if (matched.has(Number(c.dataset.i))) c.classList.add('done')
        })
        openIds = []
        if (matched.size === pairs * 2) {
          clearInterval(timer)
          status.textContent = `🎉 全部配对！用时 ${fmt(time)}，共翻 ${moves} 次`
          api.win(time)
        }
      } else {
        lockBoard = true
        setTimeout(() => {
          cards().forEach((c) => {
            const j = Number(c.dataset.i)
            if (!matched.has(j) && (j === a || j === b)) c.classList.remove('open')
          })
          openIds = []
          lockBoard = false
        }, 620)
      }
    })
    const offReset = addEvt(resetBtn, 'click', build)

    build()

    return {
      restart: build,
      pause() {},
      resume() {},
      destroy() {
        clearInterval(timer)
        offClick(); offReset()
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
