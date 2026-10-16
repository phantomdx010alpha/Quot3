// Phase 166 (pure): turns the validated schema-2 sections of a theme into CSS custom-property values the renderer sets
// through CSSOM setProperty (never string-built CSS). Gradients / fonts / shape only; effects and scenes are Phases 167-169.
// Everything is derived from validated data + built-in tables, and re-checked with checkTokenValue as a second guard.
import { isTokenName } from './tokens'
import {
  FONT_STACKS,
  FONT_TOKEN,
  GRADIENT_TOKEN,
  SHAPE_BORDER_TOKENS,
  SHAPE_RADIUS_TOKENS,
  SHAPE_SHADOW_TOKENS,
  gradientToCss,
  type ThemeV2
} from './schemaV2'
import { checkTokenValue, type ThemeFile } from './validateTheme'

/** Tokens the v2 sections may set. Explicit `tokens` of the theme always win over these (A, Phase 165). */
export function v2ToTokens(v2: ThemeV2 | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v2) return out
  for (const [slot, g] of Object.entries(v2.gradients)) {
    if (g) out[GRADIENT_TOKEN[slot as keyof typeof GRADIENT_TOKEN]] = gradientToCss(g)
  }
  for (const [slot, f] of Object.entries(v2.fonts)) {
    const stack = f ? FONT_STACKS[f] : undefined
    if (stack) out[FONT_TOKEN[slot as keyof typeof FONT_TOKEN]] = stack
  }
  const { radius, border, shadow } = v2.shape
  if (radius && radius in SHAPE_RADIUS_TOKENS) Object.assign(out, SHAPE_RADIUS_TOKENS[radius as keyof typeof SHAPE_RADIUS_TOKENS])
  if (border && border in SHAPE_BORDER_TOKENS) Object.assign(out, SHAPE_BORDER_TOKENS[border as keyof typeof SHAPE_BORDER_TOKENS])
  if (shadow && shadow in SHAPE_SHADOW_TOKENS) Object.assign(out, SHAPE_SHADOW_TOKENS[shadow as keyof typeof SHAPE_SHADOW_TOKENS])
  for (const [k, v] of Object.entries(out)) if (!isTokenName(k) || checkTokenValue(v) !== null) delete out[k]
  return out
}

/** Everything the renderer sets inline for a theme: v2 values first, then the theme's own tokens on top. */
export function themeInlineTokens(theme: Pick<ThemeFile, 'tokens' | 'v2'>): Record<string, string> {
  return { ...v2ToTokens(theme.v2), ...theme.tokens }
}

export interface V2Preview {
  /** CSS gradient for the page behind the chrome, when the theme has one. */
  shell?: string
  panel?: string
  accent?: string
}
/** Gradients for the Settings preview (compiled from validated data only). */
export function v2Preview(theme: Pick<ThemeFile, 'v2'>): V2Preview {
  const out: V2Preview = {}
  const g = theme.v2?.gradients
  if (g?.shell) out.shell = gradientToCss(g.shell)
  if (g?.panel) out.panel = gradientToCss(g.panel)
  if (g?.accent) out.accent = gradientToCss(g.accent)
  return out
}

/** Short plain-words list of what a v2 theme carries, for the Settings list ("not applied yet" things are NOT listed). */
export function v2Summary(theme: Pick<ThemeFile, 'v2'>): string[] {
  const v = theme.v2
  if (!v) return []
  const out: string[] = []
  const n = Object.keys(v.gradients).length
  if (n > 0) out.push(n === 1 ? '1 gradient' : `${n} gradients`)
  if (Object.keys(v.fonts).length > 0) out.push('fonts')
  if (Object.keys(v.shape).length > 0) out.push('shape')
  return out
}

/** The theme's v2 sections back in FILE form (for "Export current theme as a starter file"); the result passes validateTheme. */
export function v2ToFileSections(v2: ThemeV2 | undefined): Record<string, unknown> {
  if (!v2) return {}
  const out: Record<string, unknown> = {}
  if (Object.keys(v2.gradients).length > 0) {
    out['gradients'] = Object.fromEntries(
      Object.entries(v2.gradients).map(([k, g]) => [k, { kind: g!.kind, angle: g!.angle, stops: g!.stops.map((s) => [s.color, s.at]) }])
    )
  }
  if (Object.keys(v2.fonts).length > 0) out['fonts'] = { ...v2.fonts }
  if (Object.keys(v2.shape).length > 0) out['shape'] = { ...v2.shape }
  if (Object.keys(v2.effects).length > 0) out['effects'] = JSON.parse(JSON.stringify(v2.effects))
  if (v2.background) out['background'] = { ...v2.background, colors: [...v2.background.colors] }
  return out
}
