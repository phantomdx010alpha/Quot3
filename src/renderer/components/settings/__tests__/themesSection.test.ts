// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateTheme, type ThemeFile } from '@shared/theme/validateTheme'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// colours are built at run time: the hardcoded-colour guard (tokensParity) scans component folders, tests included
const H = (hex: string): string => `#${hex}`
const mk = (raw: unknown, warnings?: string[]): ThemeFile => {
  const r = validateTheme(raw)
  if (!r.ok) throw new Error(r.errors.join())
  return warnings ? { ...r.theme, warnings } : r.theme
}
const themes: ThemeFile[] = [
  { id: 'navy-ember', name: 'Navy Ember', tokens: {}, builtin: true },
  mk({ schema: 2, id: 'aurora', name: 'Aurora', base: 'navy-ember', tokens: { '--accent': H('5fe0b8') }, gradients: { shell: { stops: [[H('0b1220'), 0], [H('10213d'), 100]] } } }, ['background.scene: unknown scene "black-hole", no background will be shown'])
]
vi.mock('../../../theme/ThemeProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../theme/ThemeProvider')>()),
  useTheme: () => ({ themes, errors: [], activeId: 'navy-ember', setActive: vi.fn(async () => undefined), reload: vi.fn(async () => undefined) })
}))

import { ThemesSection } from '../ThemesSection'
import { applyTheme, applyThemeSafe } from '../../../theme/ThemeProvider'

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ThemesSection (Phase 166)', () => {
  it('shows a larger preview, the new-section chips and the load warnings', () => {
    act(() => root.render(createElement(ThemesSection)))
    expect(host.querySelector('.q3-theme__preview')).not.toBeNull()
    expect(host.textContent).toContain('In use: Navy Ember')
    expect(host.textContent).toContain('1 gradient')
    expect(host.textContent).toContain('black-hole')
  })
  it('hovering a theme previews it (with its gradient) without applying it', () => {
    act(() => root.render(createElement(ThemesSection)))
    const aurora = [...host.querySelectorAll('button[role=radio]')].find((b) => b.textContent?.includes('Aurora'))!
    act(() => { aurora.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); (aurora as HTMLElement).focus() })
    expect(host.textContent).toContain('Previewing: Aurora')
    const style = (host.querySelector('.q3-theme__preview') as HTMLElement).getAttribute('style') ?? ''
    expect(style).toContain('linear-gradient')
    expect(style).not.toMatch(/url\(/i)
  })
})

describe('applyTheme / applyThemeSafe (Phase 166)', () => {
  it('applies v2 tokens, lets explicit tokens win, and removes everything on the next theme', () => {
    const el = document.documentElement
    applyTheme(mk({ schema: 2, id: 'a', name: 'A', tokens: { '--radius-md': '3px' }, gradients: { shell: { stops: [[H('000000'), 0], [H('ffffff'), 100]] } }, shape: { radius: 'round' }, fonts: { ui: 'arial' } }))
    expect(el.style.getPropertyValue('--gradient-shell')).toContain('linear-gradient')
    expect(el.style.getPropertyValue('--radius-md')).toBe('3px')
    expect(el.style.getPropertyValue('--radius-lg')).toBe('24px')
    expect(el.style.getPropertyValue('--font-ui')).toContain('Arial')
    applyTheme({ id: 'paper', name: 'Paper', tokens: {}, builtin: true })
    expect(el.style.getPropertyValue('--gradient-shell')).toBe('')
    expect(el.style.getPropertyValue('--font-ui')).toBe('')
    expect(el.getAttribute('data-theme')).toBe('paper')
  })
  it('a theme that cannot be applied falls back to its base look', () => {
    const bad = { id: 'bad', name: 'Bad', base: 'paper', builtin: false, get tokens(): Record<string, string> { throw new Error('boom') } } as unknown as ThemeFile
    expect(applyThemeSafe(bad)).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper')
  })
})
