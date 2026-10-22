/** The phone's themes (Phase 188b): the six built-in themes of the Windows app (same ids, names and colours as `src/renderer/styles/tokens.css`)
 *  plus the phone's own earlier "Light". Colours only: the desktop's blur, glass and 3D effects are not on the phone (they cost battery).
 *  The colours themselves live in `themes.css` / `styles/pwa.css` / `tokens.css` as `:root[data-theme='<id>']` blocks; a test checks each id has one. */
export const PHONE_THEMES = [
  { id: 'navy-ember', name: 'Navy Ember', mode: 'dark', swatch: ['#0f1a2e', '#14233d', '#ff7b7b'] },
  { id: 'paper', name: 'Paper', mode: 'light', swatch: ['#e9edf4', '#eef2f8', '#ba2f2f'] },
  { id: 'glossy-glass', name: 'Glossy Glass', mode: 'dark', swatch: ['#0b1b1f', '#11272c', '#ffb454'] },
  { id: 'space', name: 'Space', mode: 'dark', swatch: ['#060a14', '#0d1424', '#3fd8ff'] },
  { id: 'red-navy', name: 'Red and Navy Blue', mode: 'dark', swatch: ['#0a1830', '#10264a', '#ff4a5e'] },
  { id: 'red-black', name: 'Red Deep-Black', mode: 'dark', swatch: ['#050505', '#0e0c0c', '#ff3b3b'] },
  { id: 'light', name: 'Light (phone)', mode: 'light', swatch: ['#f4f6fa', '#ffffff', '#ba2f2f'] }
] as const

export type ThemeName = (typeof PHONE_THEMES)[number]['id']
export const DEFAULT_THEME: ThemeName = 'navy-ember'
export const THEME_IDS: readonly string[] = PHONE_THEMES.map((t) => t.id)
export const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && THEME_IDS.includes(v)
export const themeLabel = (id: string): string => PHONE_THEMES.find((t) => t.id === id)?.name ?? 'Navy Ember'
