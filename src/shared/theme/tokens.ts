// Token whitelist + clamp table (pure). tokens.css must define exactly these names
// (enforced by src/__tests__/tokensParity.test.ts). Spec: docs/design/DESIGN_TOKENS.md.

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)

/** Tokens a theme MAY set. Names include the leading `--`. */
export const TOKEN_NAMES: readonly string[] = [
  // surfaces
  '--surface-base', '--surface-raised', '--surface-inset', '--surface-grid', '--surface-grid-alt', '--surface-header',
  // text
  '--text-primary', '--text-secondary', '--text-muted', '--text-on-accent', '--text-danger',
  // accent
  '--accent', '--accent-hover', '--accent-active', '--accent-soft', '--focus-ring',
  // semantic
  '--ok', '--warn', '--danger', '--info',
  // grid
  '--grid-line', '--grid-active-border', '--grid-active-bg', '--grid-active-row-bg', '--grid-range-bg', '--grid-override-marker',
  '--grid-marked-underline', '--grid-adjustment-bg', '--grid-total-bg',
  // rich text
  '--rt-red', '--rt-highlight',
  // chrome
  '--border-color', '--overlay',
  // Phase 96: scrollbars, title bar strip, glass / background helpers (chrome only - never the grid)
  '--scrollbar-track', '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-size',
  '--titlebar-bg', '--titlebar-fg', '--titlebar-symbol', '--titlebar-hover', '--titlebar-height',
  '--surface-glass', '--glass-blur', '--glass-border', '--bg-image',
  // Phase 165 (Themes 2.0): set by schema-2 gradients / effects (chrome only, defaults in the bare :root block)
  '--gradient-shell', '--gradient-panel', '--gradient-accent', '--accent-glow',
  // neumorphic shadows
  '--shadow-light', '--shadow-dark', '--shadow-dist', '--shadow-blur', '--shadow-raised', '--shadow-inset', '--shadow-pressed',
  // shape
  '--radius-sm', '--radius-md', '--radius-lg', '--border-width',
  // spacing
  ...range('--space-', 1, 8),
  // density
  '--row-height', '--grid-font-size', '--bar-height', '--bottom-bar-height',
  // type
  '--font-ui', '--font-grid', '--font-print', '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl',
  // icons
  '--icon-sm', '--icon-md', '--icon-lg',
  // motion
  '--ease-out', '--dur-fast', '--dur-base',
  // z-index
  '--z-grid', '--z-popover', '--z-modal', '--z-toast'
]

const TOKEN_SET: ReadonlySet<string> = new Set(TOKEN_NAMES)
export function isTokenName(name: string): boolean {
  return TOKEN_SET.has(name)
}

export interface ClampRule {
  min: number
  max: number
  unit: 'px' | 'ms'
}

/** Numeric tokens a theme cannot push outside a safe range (e.g. keeps >= 20 rows visible). */
export const CLAMPS: Readonly<Record<string, ClampRule>> = {
  '--row-height': { min: 22, max: 32, unit: 'px' },
  '--grid-font-size': { min: 11, max: 16, unit: 'px' },
  '--bar-height': { min: 40, max: 72, unit: 'px' },
  '--bottom-bar-height': { min: 32, max: 44, unit: 'px' },
  '--text-xs': { min: 9, max: 14, unit: 'px' },
  '--text-sm': { min: 10, max: 16, unit: 'px' },
  '--text-base': { min: 11, max: 18, unit: 'px' },
  '--text-lg': { min: 13, max: 24, unit: 'px' },
  '--text-xl': { min: 15, max: 32, unit: 'px' },
  '--icon-sm': { min: 12, max: 24, unit: 'px' },
  '--icon-md': { min: 14, max: 28, unit: 'px' },
  '--icon-lg': { min: 16, max: 40, unit: 'px' },
  '--radius-sm': { min: 0, max: 24, unit: 'px' },
  '--radius-md': { min: 0, max: 24, unit: 'px' },
  '--radius-lg': { min: 0, max: 32, unit: 'px' },
  '--border-width': { min: 0, max: 3, unit: 'px' },
  '--shadow-dist': { min: 0, max: 16, unit: 'px' },
  '--shadow-blur': { min: 0, max: 40, unit: 'px' },
  // Phase 96: blur is capped so a custom theme cannot make chrome repaint expensive; sizes keep the strip and bars usable.
  '--glass-blur': { min: 0, max: 24, unit: 'px' },
  '--scrollbar-size': { min: 6, max: 16, unit: 'px' },
  '--titlebar-height': { min: 28, max: 40, unit: 'px' },
  '--dur-fast': { min: 0, max: 400, unit: 'ms' },
  '--dur-base': { min: 0, max: 600, unit: 'ms' },
  ...Object.fromEntries(range('--space-', 1, 8).map((n) => [n, { min: 0, max: 48, unit: 'px' } as ClampRule]))
}

export const BUILTIN_THEMES = [
  { id: 'navy-ember', name: 'Navy Ember', mode: 'dark' },
  { id: 'paper', name: 'Paper', mode: 'light' },
  { id: 'glossy-glass', name: 'Glossy Glass', mode: 'dark' },
  { id: 'space', name: 'Space', mode: 'dark' },
  { id: 'red-navy', name: 'Red and Navy Blue', mode: 'dark' },
  { id: 'red-black', name: 'Red Deep-Black', mode: 'dark' }
] as const
export const DEFAULT_THEME_ID = 'navy-ember'
export const BUILTIN_THEME_IDS: readonly string[] = BUILTIN_THEMES.map((t) => t.id)

export const THEME_FILE_MAX_BYTES = 64 * 1024
export const THEME_MAX_FILES = 50
