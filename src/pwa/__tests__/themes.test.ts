import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '../../shared/theme/tokens'
import { DEFAULT_THEME, PHONE_THEMES, THEME_IDS, isThemeName } from '../ui/themes'
import { SETTINGS_PAGES, isSettingsPage, settingsPageLabel } from '../ui/settingsPages'

// Phase 188b - the phone has every built-in theme of the Windows app; each is a complete set of the phone's tokens.
const read = (...p: string[]): string => readFileSync(resolve(__dirname, '..', ...p), 'utf8')
const PHONE_CSS = read('styles', 'pwa.css') + '\n' + read('ui', 'tokens.css') + '\n' + read('ui', 'themes.css')
const DESKTOP_CSS = readFileSync(resolve(__dirname, '..', '..', 'renderer', 'styles', 'tokens.css'), 'utf8')

/** Every `--name: value;` declared in any `:root[data-theme='<id>']` block (a block may also be combined with `:root,`). */
function varsOf(css: string, id: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([^{}]*)\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    if (!m[1]!.includes(`[data-theme='${id}']`)) continue
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1]!, d[2]!.trim())
  }
  return out
}

describe('phone themes', () => {
  it('has all six built-in themes of the Windows app, with the same ids and names, plus the phone Light', () => {
    for (const t of BUILTIN_THEMES) {
      const mine = PHONE_THEMES.find((x) => x.id === t.id)
      expect(mine, t.id).toBeTruthy()
      expect(mine!.name).toBe(t.name)
      expect(mine!.mode).toBe(t.mode)
    }
    expect(THEME_IDS).toContain('light')
    expect(THEME_IDS).toHaveLength(BUILTIN_THEMES.length + 1)
    expect(DEFAULT_THEME).toBe('navy-ember')
    expect(isThemeName('space')).toBe(true)
    expect(isThemeName('nope')).toBe(false)
  })

  it('every theme defines every token the phone uses (same set as Navy Ember)', () => {
    // Colour tokens only: spacing, radius and font tokens live once in the base `:root` block and every theme inherits them.
    const colour = (k: string): boolean => /^--(surface|text|accent|focus|border|status)-/.test(k) || k === '--focus-ring'
    const reference = new Set([...varsOf(PHONE_CSS, 'navy-ember').keys()].filter(colour))
    expect(reference.size).toBeGreaterThan(10)
    for (const t of PHONE_THEMES) {
      const have = varsOf(PHONE_CSS, t.id)
      const missing = [...reference].filter((k) => !have.has(k) && k !== '--bg-image')
      expect(missing, t.id).toEqual([])
    }
  })

  it('the colours are the Windows app\'s own values', () => {
    for (const t of BUILTIN_THEMES) {
      const phone = varsOf(PHONE_CSS, t.id)
      const desk = varsOf(DESKTOP_CSS, t.id)
      for (const k of ['--surface-base', '--surface-raised', '--surface-inset', '--surface-header', '--text-primary', '--text-secondary', '--text-muted', '--text-on-accent', '--accent', '--accent-hover', '--accent-soft', '--focus-ring']) {
        expect(phone.get(k), `${t.id} ${k}`).toBe(desk.get(k))
      }
      // Navy Ember keeps the phone's original soft border (Phase 174); the themes added later copy the desktop border colour.
      if (t.id !== 'navy-ember') expect(phone.get('--border-subtle'), `${t.id} border`).toBe(desk.get('--border-color'))
    }
  })

  it('every swatch has three colours that match the theme', () => {
    for (const t of PHONE_THEMES) {
      const v = varsOf(PHONE_CSS, t.id)
      expect(t.swatch).toEqual([v.get('--surface-base'), v.get('--surface-raised'), v.get('--accent')])
    }
  })
})

describe('settings pages', () => {
  it('has the home list pages in order and knows its ids', () => {
    expect(SETTINGS_PAGES.map((p) => p.id)).toEqual(['appearance', 'company', 'sync', 'share', 'storage', 'lock', 'about'])
    expect(isSettingsPage('about')).toBe(true)
    expect(isSettingsPage('x')).toBe(false)
    expect(settingsPageLabel('sync')).toBe('Branch and sync')
    expect(settingsPageLabel(undefined)).toBe('Settings')
  })
})
