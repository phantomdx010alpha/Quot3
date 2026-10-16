// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateTheme, type ThemeFile } from '@shared/theme/validateTheme'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const r = validateTheme({ schema: 2, id: 'fx', name: 'FX', effects: { pageTransition: { preset: 'fade', intensity: 0.5 }, accentGlow: { intensity: 0.4 } } })
if (!r.ok) throw new Error('bad')
const themes: ThemeFile[] = [r.theme]
vi.mock('../../../theme/ThemeProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../theme/ThemeProvider')>()),
  useTheme: () => ({ themes, errors: [], activeId: 'fx', setActive: vi.fn(), reload: vi.fn() })
}))

import { EffectsSection } from '../EffectsSection'
import { getEffectsPrefs, resetEffectsPrefs } from '../../../theme/effects'
import { getSceneSnapshot } from '../../../theme/scenes/sceneState'

const set = vi.fn(async () => ({ ok: true, data: {} }))
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  (window as unknown as { quot3: unknown }).quot3 = { settings: { set, get: vi.fn() } }
  set.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root.render(createElement(EffectsSection)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); resetEffectsPrefs(); delete (window as unknown as { quot3?: unknown }).quot3 })

const box = (label: string): HTMLInputElement => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
const click = (el: HTMLElement): void => { act(() => { el.click() }) }

describe('EffectsSection (Phase 168)', () => {
  it('master switch off disables the per-effect controls and is saved', () => {
    const master = host.querySelector('input[type=checkbox]') as HTMLInputElement
    expect(master.checked).toBe(true)
    click(master)
    expect(getEffectsPrefs().enabled).toBe(false)
    expect(set).toHaveBeenCalledWith('effects.enabled', false)
    expect(box('Page transitions').disabled).toBe(true)
  })
  it('a strength change is saved as an override; the unused effect says so', () => {
    const range = box('Page transitions strength')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(range, '0.8'); range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(getEffectsPrefs().overrides.pageTransition?.intensity).toBe(0.8)
    expect(set).toHaveBeenCalledWith('effects.overrides', { pageTransition: { intensity: 0.8 } })
    expect(host.textContent).toContain('The current theme does not use this one.')
  })
  it('the reset button clears overrides and turns effects back on', () => {
    click(box('Accent glow'))
    expect(getEffectsPrefs().overrides.accentGlow?.enabled).toBe(false)
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Reset effects')) as HTMLButtonElement
    click(btn)
    expect(getEffectsPrefs()).toMatchObject({ enabled: true, overrides: {} })
    expect(box('Accent glow').checked).toBe(true)
  })
  it('the 3D backgrounds switch is saved, follows the master switch, and reset turns it back on (Phase 169)', () => {
    const three = Array.from(host.querySelectorAll('input[type=checkbox]')).find((i) => i.parentElement?.textContent?.includes('3D backgrounds')) as HTMLInputElement
    expect(three.checked).toBe(true)
    click(three)
    expect(getSceneSnapshot().scenesEnabled).toBe(false)
    expect(set).toHaveBeenCalledWith('effects.scenes3d', false)
    expect(host.textContent).toContain('no 3D background')
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Reset effects')) as HTMLButtonElement
    click(btn)
    expect(getSceneSnapshot().scenesEnabled).toBe(true)
  })
})
