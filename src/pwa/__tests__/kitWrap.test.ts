import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '../ui/kit/Button'
import { SegmentedControl } from '../ui/kit/SegmentedControl'

// Phase 190 - the wrap rule, touch size and naming, scanned in the NEW css / components only (classic is locked by classicParity.test.ts).
const ui = (...p: string[]): string => resolve(__dirname, '..', 'ui', ...p)
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const KIT_CSS = strip(readFileSync(ui('kit', 'kit.css'), 'utf8'))
const LAYOUT_CSS = strip(readFileSync(ui('layouts', 'layouts.css'), 'utf8'))

interface Rule { selector: string; body: string }
const rules = (css: string): Rule[] => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!.trim() }))
const decl = (r: Rule, prop: string): string | undefined => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(r.body)?.[1]?.trim()
const ALL = [...rules(KIT_CSS), ...rules(LAYOUT_CSS)]

describe('wrap rule', () => {
  it('no ellipsis anywhere in the new css', () => {
    for (const r of ALL) expect(r.body, r.selector).not.toMatch(/text-overflow\s*:\s*ellipsis/)
  })
  it('name / title / detail / label classes wrap: no nowrap, no hidden overflow', () => {
    const names = ALL.filter((r) => /(name|title|detail|label|party|dt\b|text)/.test(r.selector.replace(/\.q3x-btn-text\b/g, '')))
    expect(names.length).toBeGreaterThan(3)
    for (const r of names) {
      expect(decl(r, 'white-space'), r.selector).not.toBe('nowrap')
      expect(decl(r, 'overflow'), r.selector).not.toBe('hidden')
    }
    const itemName = ALL.find((r) => r.selector === '.q3x-item-name')!
    expect(decl(itemName, 'white-space')).toBe('normal')
    expect(decl(itemName, 'overflow-wrap')).toBe('anywhere')
    expect(decl(itemName, 'min-width')).toBe('0')
  })
  it('amount classes are never clipped and never shrink', () => {
    const amounts = ALL.filter((r) => /amount/.test(r.selector))
    expect(amounts.length).toBeGreaterThanOrEqual(2)
    for (const r of amounts) {
      expect(r.body, r.selector).not.toMatch(/text-overflow|overflow\s*:\s*hidden/)
      expect(decl(r, 'font-variant-numeric'), r.selector).toBe('tabular-nums')
    }
    for (const sel of ['.q3x-amount', '.q3x-amount-grand']) expect(decl(ALL.find((r) => r.selector === sel)!, 'flex')).toBe('none')
  })
})

describe('touch size and tokens', () => {
  it('tappable classes use the touch token, and the new layouts set it to at least 48 px', () => {
    for (const sel of ['.q3x-btn', '.q3x-seg-btn', '.q3x-pill', '.q3x-date-input']) expect(decl(ALL.find((r) => r.selector === sel)!, 'min-height'), sel).toBe('var(--touch-min)')
    const scoped = rules(LAYOUT_CSS).find((r) => r.selector.includes("[data-layout='tidy']"))!
    for (const id of ['tidy', 'guided', 'inbox']) expect(scoped.selector).toContain(`[data-layout='${id}']`)
    expect(Number.parseInt(decl(scoped, '--touch-min')!, 10)).toBeGreaterThanOrEqual(48)
    expect(decl(scoped, '--nav-height')).toBe('60px')
    expect(decl(scoped, '--font-size-base')).toBe('16px')
    expect(decl(scoped, '--font-size-title')).toBe('17px')
    expect(decl(scoped, '--font-size-amount')).toBe('17px')
    expect(decl(scoped, '--font-weight-amount')).toBe('600')
  })
  it('the larger tokens are scoped to the new layouts only (no :root / classic rule here)', () => {
    for (const r of rules(LAYOUT_CSS)) expect(r.selector).toMatch(/\[data-layout=/)
    expect(LAYOUT_CSS).not.toMatch(/data-layout='classic'/)
  })
  it('no raw colours in the new css (tokens only)', () => {
    expect(KIT_CSS + LAYOUT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })
})

describe('Phase 191 css', () => {
  it('sheet, snackbar, pill, share bar and date classes exist, wrap, and the sheet sits above the snackbar below nothing raw', () => {
    for (const sel of ['.q3x-sheet-title', '.q3x-snack-text', '.q3x-pill-label', '.q3x-status-text', '.q3x-sharebar-text', '.q3x-saved-text', '.q3x-date-label']) {
      const r = ALL.find((x) => x.selector === sel)!
      expect(r, sel).toBeTruthy()
      expect(decl(r, 'white-space'), sel).toBe('normal')
      expect(decl(r, 'overflow-wrap'), sel).toBe('anywhere')
    }
    expect(Number(decl(ALL.find((r) => r.selector === '.q3x-snack')!, 'z-index'))).toBeGreaterThan(Number(decl(ALL.find((r) => r.selector === '.q3x-sheet-root')!, 'z-index')))
  })
})

describe('every button is named', () => {
  it('Button always has a text or an aria-label, and SegmentedControl choices are named', () => {
    expect(renderToStaticMarkup(createElement(Button, { label: 'Save' }))).toContain('>Save<')
    const iconOnly = renderToStaticMarkup(createElement(Button, { label: 'Close', hideLabel: true, icon: 'x' }))
    expect(iconOnly).toContain('aria-label="Close"')
    const seg = renderToStaticMarkup(createElement(SegmentedControl, { ariaLabel: 'Bill type', options: [{ id: 'a', label: 'GST' }, { id: 'b', label: 'Non-GST' }], value: 'a', onChange: () => undefined }))
    expect(seg).toContain('aria-label="Bill type"')
    expect(seg).toContain('aria-pressed="true"')
    expect(seg).toContain('>Non-GST<')
  })
  it('only Button and SegmentedControl draw a <button> in the kit, and nothing in the kit has an emoji', () => {
    for (const f of readdirSync(ui('kit')).filter((n) => /\.tsx?$/.test(n))) {
      const src = readFileSync(ui('kit', f), 'utf8')
      // Phase 191: StatusPill draws its own pill <button> (named by its text; checked in kitSheets.test.ts).
      if (!['Button.tsx', 'SegmentedControl.tsx', 'StatusPill.tsx'].includes(f)) expect(src, f).not.toMatch(/<button/)
      expect(src, f).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})
