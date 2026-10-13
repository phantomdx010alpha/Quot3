// Phase 103: swatch colours for the Settings theme picker, so every theme can be previewed without applying it.
// Built-in values mirror tokens.css (themePreview.test.ts enforces that); custom themes start from their `base` and
// override a swatch only when the theme sets that token to a plain #rrggbb colour.
import { BUILTIN_THEME_IDS, DEFAULT_THEME_ID } from './tokens'

export const PREVIEW_TOKENS = ['--surface-base', '--surface-raised', '--surface-grid', '--accent', '--text-primary'] as const
export type PreviewToken = (typeof PREVIEW_TOKENS)[number]
export type ThemePreview = Record<PreviewToken, string>

export const BUILTIN_PREVIEW: Record<string, ThemePreview> = {
  'navy-ember': { '--surface-base': '#0f1a2e', '--surface-raised': '#14233d', '--surface-grid': '#101c32', '--accent': '#ff7b7b', '--text-primary': '#e6ecf7' },
  paper: { '--surface-base': '#e9edf4', '--surface-raised': '#eef2f8', '--surface-grid': '#ffffff', '--accent': '#ba2f2f', '--text-primary': '#101a2e' },
  'glossy-glass': { '--surface-base': '#0b1b1f', '--surface-raised': '#11272c', '--surface-grid': '#0d1e22', '--accent': '#ffb454', '--text-primary': '#e9f5f3' },
  space: { '--surface-base': '#060a14', '--surface-raised': '#0d1424', '--surface-grid': '#080d18', '--accent': '#3fd8ff', '--text-primary': '#e8eefc' },
  'red-navy': { '--surface-base': '#0a1830', '--surface-raised': '#10264a', '--surface-grid': '#0a1a36', '--accent': '#ff4a5e', '--text-primary': '#f2f5ff' },
  'red-black': { '--surface-base': '#050505', '--surface-raised': '#0e0c0c', '--surface-grid': '#070606', '--accent': '#ff3b3b', '--text-primary': '#f5eeee' }
}

const HEX = /^#[0-9a-fA-F]{6}$/

export function themePreview(theme: { id: string; builtin?: boolean; base?: string; tokens: Record<string, string> }): ThemePreview {
  const baseId = theme.builtin ? theme.id : theme.base && BUILTIN_THEME_IDS.includes(theme.base) ? theme.base : DEFAULT_THEME_ID
  const out: ThemePreview = { ...(BUILTIN_PREVIEW[baseId] ?? BUILTIN_PREVIEW[DEFAULT_THEME_ID]!) }
  if (!theme.builtin) for (const k of PREVIEW_TOKENS) { const v = theme.tokens[k]; if (v !== undefined && HEX.test(v)) out[k] = v }
  return out
}
