/**
 * Format registry — the Golden Rule (CLAUDE_MUST_READ §4.4): formats are DATA. Grid, calc, paper and print
 * read `FormatDef`s from here; nothing may branch on a format id. Adding a format = one `registerFormat` call.
 */
import type { FormatDef } from '../types'
import { GST_FORMAT } from './gst'
import { NON_GST_FORMAT } from './nonGst'

const formats = new Map<string, FormatDef>()
const builtInIds = new Set<string>()

/** Shallow-frozen deep copy so callers can't mutate registry state. */
function freeze(def: FormatDef): FormatDef {
  return Object.freeze({ ...def, columns: Object.freeze(def.columns.map((c) => Object.freeze({ ...c }))) as FormatDef['columns'] })
}

/** Structural checks only (no format-name logic). Throws with a readable message. */
export function validateFormat(def: FormatDef): void {
  if (!def.id || !/^[a-z][a-z0-9_]*$/.test(def.id)) throw new Error(`Format id must be snake_case: "${def.id}"`)
  if (!def.label.trim()) throw new Error(`Format "${def.id}" needs a label`)
  if (def.columns.length === 0) throw new Error(`Format "${def.id}" needs columns`)
  const seen = new Set<string>()
  for (const c of def.columns) {
    if (seen.has(c.key)) throw new Error(`Format "${def.id}" repeats column "${c.key}"`)
    seen.add(c.key)
    if (c.widthPx <= 0 || c.printWidthPct <= 0) throw new Error(`Format "${def.id}" column "${c.key}" needs positive widths`)
  }
  if (!seen.has('name')) throw new Error(`Format "${def.id}" needs a "name" column`)
  if (!Number.isInteger(def.a5ExtraColLimit) || def.a5ExtraColLimit < 0) throw new Error(`Format "${def.id}": a5ExtraColLimit must be an integer ≥ 0`)
  const pct = def.columns.reduce((n, c) => n + c.printWidthPct, 0)
  if (pct > 100) throw new Error(`Format "${def.id}" print widths total ${pct}% (> 100)`)
}

export function registerFormat(def: FormatDef): void {
  validateFormat(def)
  if (formats.has(def.id)) throw new Error(`Format "${def.id}" is already registered`)
  if (def.isDefault && [...formats.values()].some((f) => f.isDefault)) throw new Error(`A default format already exists; "${def.id}" cannot also be default`)
  if (def.shortcut && [...formats.values()].some((f) => f.shortcut === def.shortcut)) throw new Error(`Shortcut ${def.shortcut} already used by a format`)
  formats.set(def.id, freeze(def))
}

/** Removes a non-built-in format (used by tests and, later, any user-defined formats). Returns whether it existed. */
export function unregisterFormat(id: string): boolean {
  if (builtInIds.has(id)) throw new Error(`Built-in format "${id}" cannot be unregistered`)
  return formats.delete(id)
}

export function hasFormat(id: string): boolean {
  return formats.has(id)
}

/** Throws on an unknown id. Use `resolveFormat` for ids read from storage. */
export function getFormat(id: string): FormatDef {
  const f = formats.get(id)
  if (!f) throw new Error(`Unknown format: "${id}"`)
  return f
}

export function listFormats(): FormatDef[] {
  return [...formats.values()]
}

export function defaultFormatId(): string {
  for (const f of formats.values()) if (f.isDefault) return f.id
  throw new Error('No default format registered')
}

/** Tolerant lookup for stored ids: unknown → the default format (never loses row data). */
export function resolveFormat(id: string | null | undefined): FormatDef {
  return (id && formats.get(id)) || getFormat(defaultFormatId())
}

for (const def of [NON_GST_FORMAT, GST_FORMAT]) {
  registerFormat(def)
  builtInIds.add(def.id)
}
