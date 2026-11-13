/**
 * Phase 235 (M23) - Price List types and limits (pure: no DOM, no Electron, no Node). MILESTONE23_DESIGN 4.1 / 7.5.
 * Everything here is user DATA: tiers, categories, tabs, columns and rows. Money-like values are canonical decimal strings.
 */
import type { Dec, Runs } from '../types'

export const PRICELIST_LIMITS = {
  maxColumns: 12,
  maxTiers: 20,
  nameMax: 120,
  labelMax: 40,
  tierKeyMax: 30,
  cellMax: 200,
  choiceMax: 20,
  choicesMax: 30,
  widthMin: 40,
  widthMax: 600
} as const

export type ColumnType = 'text' | 'number' | 'choice'
export type ColumnRole = 'name' | 'price' | 'unit' | 'note' | 'other'
export type ColumnAlign = 'left' | 'center' | 'right'
export const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'choice']
export const COLUMN_ROLES: readonly ColumnRole[] = ['name', 'price', 'unit', 'note', 'other']

export interface PriceColumn {
  key: string
  label: string
  type: ColumnType
  role: ColumnRole
  /** Tier key; only meaningful for role 'price'. */
  tier?: string
  widthPx: number
  align: ColumnAlign
  hidden: boolean
  frozen: boolean
  choices?: string[]
}

export interface PriceTier { id: string; key: string; label: string; position: number }
export interface PriceCategory { id: string; name: string; color: string | null; position: number }
export interface PriceTab { id: string; categoryId: string; name: string; position: number; columns: PriceColumn[] }

export type RowKind = 'item' | 'section'
export interface PriceRow {
  id: string
  tabId: string
  idx: number
  kind: RowKind
  nameRuns: Runs
  /** columnKey -> text. Price / number columns hold canonical decimal strings or ''. The name column is NOT in cells. */
  cells: Record<string, string>
}

/** The key of the always-present first (item name) column. */
export const NAME_COLUMN_KEY = 'name'

export type { Dec }
