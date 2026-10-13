import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clampTitleBarHeight, parseOverlayColor, titleBarOverlayFrom } from '../titleBar'

describe('title bar overlay (pure)', () => {
  it('normalises hex and rgb colours to #rrggbb, drops alpha', () => {
    expect(parseOverlayColor('#0B1424')).toBe('#0b1424')
    expect(parseOverlayColor('#abc')).toBe('#aabbcc')
    expect(parseOverlayColor('rgb(11, 20, 36)')).toBe('#0b1424')
    expect(parseOverlayColor('rgba(11, 20, 36, 0.5)')).toBe('#0b1424')
  })
  it('rejects anything else (names, var(), gradients, out-of-range, injection)', () => {
    for (const bad of ['red', 'var(--x)', 'linear-gradient(red, blue)', 'rgb(300, 0, 0)', '#12345', '#0b1424; x', '', 'url(x)']) expect(parseOverlayColor(bad), bad).toBeNull()
  })
  it('clamps the height to the token range', () => {
    expect(clampTitleBarHeight(10)).toBe(28)
    expect(clampTitleBarHeight(200)).toBe(40)
    expect(clampTitleBarHeight(Number.NaN)).toBe(28)
    expect(titleBarOverlayFrom({ bg: '#000', symbol: '#fff', height: '32px' })).toEqual({ color: '#000000', symbolColor: '#ffffff', height: 32 })
  })
  it('an unusable colour gives null (previous overlay is kept)', () => {
    expect(titleBarOverlayFrom({ bg: 'var(--a)', symbol: '#fff', height: '32px' })).toBeNull()
  })
})

describe('overlay colour equals the theme token for every built-in theme', () => {
  const css = readFileSync(resolve(__dirname, '../../../renderer/styles/tokens.css'), 'utf8')
  const block = (sel: string): string => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
  for (const [id, sel] of [['navy-ember', ":root[data-theme='navy-ember']"], ['paper', ":root[data-theme='paper']"], ['glossy-glass', ":root[data-theme='glossy-glass']"], ['space', ":root[data-theme='space']"], ['red-navy', ":root[data-theme='red-navy']"], ['red-black', ":root[data-theme='red-black']"]] as const) {
    it(id, () => {
      const b = block(sel)
      const get = (n: string): string => new RegExp(`${n}:\\s*([^;]+);`).exec(b)![1]!.trim()
      const o = titleBarOverlayFrom({ bg: get('--titlebar-bg'), symbol: get('--titlebar-symbol'), height: '32px' })
      expect(o).toEqual({ color: get('--titlebar-bg').toLowerCase(), symbolColor: get('--titlebar-symbol').toLowerCase(), height: 32 })
    })
  }
  it('the window default (before the renderer reports) is the Navy Ember strip', () => {
    const w = readFileSync(resolve(__dirname, '../../../main/window.ts'), 'utf8')
    expect(w).toContain("color: '#0b1424'")
    expect(w).toContain("symbolColor: '#e6ecf7'")
  })
})
