/**
 * 小游戏公共底座：Canvas 高清适配、帧循环、键鼠 / 触摸事件的统一绑定与解绑。
 *
 * 所有游戏模块共用，目的是让「切游戏 / 离开页面」时资源能干净释放：
 * 每个 bind* 都返回 off 函数，游戏 destroy() 时逐个调用，避免残留 rAF 与 window 监听。
 */

const dpr = () => Math.min(window.devicePixelRatio || 1, 2)

/** 读 CSS 变量，让画布配色跟随站点深浅色主题（缓存一次，主题切换需重进游戏） */
export function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch (e) {
    return fallback
  }
}

/**
 * 建一块自适应画布：逻辑尺寸固定（游戏按 w×h 坐标绘制），
 * 实际像素按 DPR 放大，CSS 宽度 100% 自适应容器，省掉 ResizeObserver。
 */
export function setupCanvas(container, w, h) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const scale = dpr()
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.className = 'gm-canvas'
  container.style.setProperty('--gm-w', w + 'px')
  container.appendChild(canvas)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  return { canvas, ctx }
}

/** 帧循环：fn(dt 秒, 时间戳)。stop() 后不再调度 */
export function createRunner() {
  let id = 0
  let last = 0
  let stopped = false
  return {
    start(fn) {
      const step = (t) => {
        if (stopped) return
        const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016
        last = t
        fn(dt, t)
        id = requestAnimationFrame(step)
      }
      id = requestAnimationFrame(step)
    },
    stop() {
      stopped = true
      if (id) cancelAnimationFrame(id)
      id = 0
    },
  }
}

/** 键盘：返回 off。游戏内部按需 preventDefault（如方向键滚屏） */
export function onKey(handler) {
  const fn = (e) => handler(e)
  window.addEventListener('keydown', fn)
  return () => window.removeEventListener('keydown', fn)
}

/** 键盘抬起（按住连发 / 长按蓄力类游戏用）：返回 off */
export function onKeyUp(handler) {
  const fn = (e) => handler(e)
  window.addEventListener('keyup', fn)
  return () => window.removeEventListener('keyup', fn)
}

/** 指针按下：回调给的是画布内的 0~1 相对坐标，免去各游戏自己换算 */
export function onPointer(el, handler) {
  const fn = (e) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    handler((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e)
  }
  el.addEventListener('pointerdown', fn)
  return () => el.removeEventListener('pointerdown', fn)
}

/** 指针移动（拖拽类游戏用），同样是 0~1 相对坐标 */
export function onPointerMove(el, handler) {
  const fn = (e) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    handler((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e)
  }
  el.addEventListener('pointermove', fn)
  return () => el.removeEventListener('pointermove', fn)
}

/** 滑动手势：阈值 24px，超阈值才触发，避免误触 */
export function onSwipe(el, handler) {
  let sx = 0
  let sy = 0
  let active = false
  const down = (e) => {
    active = true
    sx = e.clientX
    sy = e.clientY
  }
  const up = (e) => {
    if (!active) return
    active = false
    const dx = e.clientX - sx
    const dy = e.clientY - sy
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    handler(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointerup', up)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointerup', up)
  }
}

/** 圆角矩形路径（老浏览器没有 ctx.roundRect） */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 居中文字（画布里所有数字/提示统一走它） */
export function centerText(ctx, text, x, y, size, color, weight = '700') {
  ctx.font = `${weight} ${size}px "Segoe UI", Inter, system-ui, sans-serif`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

export const rand = (a, b) => a + Math.random() * (b - a)
export const randInt = (a, b) => Math.floor(rand(a, b + 1))
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
/** 指数趋近，与帧率无关的平滑 */
export const lerp = (a, b, k) => a + (b - a) * (1 - Math.exp(-k))
