// Phase 98 - pure helpers for the themed title bar strip (Windows `titleBarOverlay`). No DOM, no Electron.
// The renderer reads --titlebar-bg / --titlebar-symbol / --titlebar-height from the live theme and sends them to main;
// main re-parses them with the same code, so only a plain opaque #rrggbb colour and a clamped height ever reach Electron.
import { CLAMPS } from './tokens'

export interface TitleBarOverlay {
  /** Opaque #rrggbb. */
  color: string
  /** Opaque #rrggbb. */
  symbolColor: string
  height: number
}

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(r, g, b, a)` -> `#rrggbb` (alpha dropped: the overlay is opaque). Anything else -> null. */
export function parseOverlayColor(value: string): string | null {
  const v = value.trim()
  let m = /^#([0-9a-fA-F]{3})$/.exec(v)
  if (m) return `#${[...m[1]!].map((c) => c + c).join('').toLowerCase()}`
  m = /^#([0-9a-fA-F]{6})$/.exec(v)
  if (m) return `#${m[1]!.toLowerCase()}`
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(v)
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (r > 255 || g > 255 || b > 255) return null
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`
  }
  return null
}

export function clampTitleBarHeight(h: number): number {
  const rule = CLAMPS['--titlebar-height']!
  if (!Number.isFinite(h)) return rule.min
  return Math.min(rule.max, Math.max(rule.min, Math.round(h)))
}

/** Build the overlay from raw token text; null when a colour is unusable (the caller keeps the previous overlay). */
export function titleBarOverlayFrom(input: { bg: string; symbol: string; height: string | number }): TitleBarOverlay | null {
  const color = parseOverlayColor(input.bg)
  const symbolColor = parseOverlayColor(input.symbol)
  if (!color || !symbolColor) return null
  const h = typeof input.height === 'number' ? input.height : Number.parseFloat(input.height)
  return { color, symbolColor, height: clampTitleBarHeight(h) }
}
