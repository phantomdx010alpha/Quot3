import { describe, expect, it } from 'vitest'
import { validateTheme } from '../validateTheme'
import { contrastRatio } from '../contrast'
import { TOKEN_NAMES } from '../tokens'

const good = { id: 'my-theme', name: 'My Theme', base: 'navy-ember', tokens: { '--accent': '#FFB347', '--surface-base': '#101010' } }

describe('validateTheme', () => {
  it('accepts a valid theme and trims tokens', () => {
    const r = validateTheme(good)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.theme).toEqual({ ...good, builtin: false })
      expect(r.warnings).toEqual([])
    }
  })

  it('rejects url() values (whole file)', () => {
    for (const v of ['url(http://evil/x.png)', 'URL( "x" )', 'image-set(x)', 'expression(alert(1))', 'red; background: url(x)']) {
      const r = validateTheme({ ...good, tokens: { '--accent': v } })
      expect(r.ok, v).toBe(false)
    }
  })

  it('rejects braces, @import, backslashes, comments, javascript:', () => {
    for (const v of ['red}body{x:y', '@import "x"', 'a\\62', '/* hi */red', 'javascript:alert(1)', '<script>']) {
      expect(validateTheme({ ...good, tokens: { '--accent': v } }).ok, v).toBe(false)
    }
  })

  it('rejects unbalanced parens, empty and over-long values', () => {
    expect(validateTheme({ ...good, tokens: { '--accent': 'rgb(1,2,3' } }).ok).toBe(false)
    expect(validateTheme({ ...good, tokens: { '--accent': ')(' } }).ok).toBe(false)
    expect(validateTheme({ ...good, tokens: { '--accent': '' } }).ok).toBe(false)
    expect(validateTheme({ ...good, tokens: { '--font-ui': 'a'.repeat(201) } }).ok).toBe(false)
  })

  it('allows calc() / var() / rgba() / font stacks', () => {
    const r = validateTheme({
      ...good,
      tokens: {
        '--shadow-raised': '4px 4px 8px var(--shadow-dark), calc(var(--shadow-dist) * -1) 0 8px var(--shadow-light)',
        '--accent-soft': 'rgba(255, 123, 123, .14)',
        '--font-ui': "'Segoe UI', system-ui, sans-serif"
      }
    })
    expect(r.ok).toBe(true)
  })

  it('ignores unknown tokens with a warning', () => {
    const r = validateTheme({ ...good, tokens: { '--accent': '#fff', '--not-a-token': 'red', color: 'red' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.theme.tokens)).toEqual(['--accent'])
      expect(r.warnings).toHaveLength(2)
    }
  })

  it('clamps --row-height and font sizes into the safe range', () => {
    const r = validateTheme({ ...good, tokens: { '--row-height': '60px', '--grid-font-size': '4px', '--text-xl': '28' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.theme.tokens['--row-height']).toBe('32px')
      expect(r.theme.tokens['--grid-font-size']).toBe('11px')
      expect(r.theme.tokens['--text-xl']).toBe('28px')
      expect(r.warnings.some((w) => w.includes('--row-height'))).toBe(true)
    }
  })

  it('rejects non-numeric / wrong-unit values on clamped tokens', () => {
    expect(validateTheme({ ...good, tokens: { '--row-height': 'calc(100vh)' } }).ok).toBe(false)
    expect(validateTheme({ ...good, tokens: { '--row-height': '2em' } }).ok).toBe(false)
    expect(validateTheme({ ...good, tokens: { '--dur-base': '10px' } }).ok).toBe(false)
  })

  it('validates the envelope', () => {
    for (const bad of [null, 5, [], 'x', {}, { id: 'A B', name: 'x' }, { id: 'ok', name: '' }, { id: 'ok', name: 'x', base: 'nope' },
      { id: 'navy-ember', name: 'x' }, { id: 'ok', name: 'x', tokens: [] }, { id: 'ok', name: 'x', tokens: { '--accent': 5 } }]) {
      expect(validateTheme(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })

  it('a theme with no tokens and no base is valid', () => {
    expect(validateTheme({ id: 'plain', name: 'Plain' }).ok).toBe(true)
  })

  it('token whitelist has no duplicates', () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length)
  })
})

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
  })
})

describe('Phase 96 tokens through the sanitiser', () => {
  const mk = (tokens: Record<string, string>): unknown => ({ id: 'glass-test', name: 'Glass test', base: 'navy-ember', tokens })
  it('accepts url-free gradients for --bg-image and rgba glass colours', () => {
    const r = validateTheme(mk({ '--bg-image': 'linear-gradient(135deg, #0b1424 0%, #1b2f52 60%, rgba(255, 123, 123, 0.2) 100%)', '--surface-glass': 'rgba(20, 35, 61, 0.6)' }))
    expect(r.ok).toBe(true)
  })
  it('rejects url() backgrounds', () => {
    expect(validateTheme(mk({ '--bg-image': 'url(https://example.com/x.png)' })).ok).toBe(false)
  })
  it('clamps blur, scrollbar size and title bar height', () => {
    const r = validateTheme(mk({ '--glass-blur': '200px', '--scrollbar-size': '1px', '--titlebar-height': '90px' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.theme.tokens).toMatchObject({ '--glass-blur': '24px', '--scrollbar-size': '6px', '--titlebar-height': '40px' })
  })
})
