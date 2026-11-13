import type { PermRecord } from './perms'
import { csvField } from './csv'

/** Phase 235 (M23) - Price List activity log entries (pure). One entry per saved batch, never per keystroke. Author is NEVER taken from here on the server (design 4.5). */
export const LOG_OPS = ['add', 'edit', 'overwrite', 'delete', 'restore', 'import', 'bulk', 'structure', 'permission'] as const
export type LogOp = (typeof LOG_OPS)[number]
export type LogEntity = 'tier' | 'category' | 'tab' | 'row' | 'column' | 'perms' | 'list'
export type DeviceKind = 'pc' | 'phone'

export const LOG_LIMITS = { valueMax: 200, pathMax: 300, changesMax: 50 } as const

export interface LogChange { column: string; before: string; after: string }
export interface PriceLogEntry {
  at: string
  seatNo: number | null
  branchId: string
  deviceKind: DeviceKind
  entity: LogEntity
  entityId: string
  op: LogOp
  /** "Category > Tab > Item" */
  path: string
  /** Old / new values of edited cells (capped); null for ops without values. */
  changes: LogChange[] | null
  /** How many records a batch / import / bulk touched. */
  count: number
}

const cut = (s: string, n: number): string => { const a = Array.from(s); return a.length <= n ? s : `${a.slice(0, n - 1).join('')}\u2026` }
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function pathOf(parts: readonly (string | null | undefined)[]): string {
  return cut(parts.filter((p): p is string => !!p && oneLine(p) !== '').map(oneLine).join(' \u203A '), LOG_LIMITS.pathMax)
}

export interface LogEntryInput {
  now: Date
  seatNo: number | null
  branchId: string
  deviceKind: DeviceKind
  entity: LogEntity
  entityId: string
  op: LogOp
  path: string[]
  changes?: readonly LogChange[]
  count?: number
}

export function makeLogEntry(i: LogEntryInput): PriceLogEntry {
  const changes = (i.changes ?? []).filter((c) => c.before !== c.after).slice(0, LOG_LIMITS.changesMax)
    .map((c) => ({ column: cut(oneLine(c.column), 40), before: cut(c.before, LOG_LIMITS.valueMax), after: cut(c.after, LOG_LIMITS.valueMax) }))
  return {
    at: i.now.toISOString(), seatNo: i.seatNo, branchId: i.branchId, deviceKind: i.deviceKind, entity: i.entity, entityId: i.entityId, op: i.op,
    path: pathOf(i.path), changes: changes.length > 0 ? changes : null, count: Math.max(1, i.count ?? 1)
  }
}

/** One plain-words line for the Activity list ("Seat 2 (Branch A, phone) changed cash w/o: 110 -> 120 in Panna > Small"). */
export function describeEntry(e: PriceLogEntry, branchName?: string): string {
  const who = `Seat ${e.seatNo ?? '?'}${branchName ? ` (${branchName}, ${e.deviceKind})` : ` (${e.deviceKind})`}`
  const verb: Record<LogOp, string> = { add: 'added', edit: 'edited', overwrite: 'changed', delete: 'deleted', restore: 'restored', import: 'imported', bulk: 'bulk-changed', structure: 'changed the structure of', permission: 'changed permissions for' }
  const c = e.changes?.[0]
  const what = c ? ` ${c.column}: ${c.before === '' ? '(empty)' : c.before} \u2192 ${c.after === '' ? '(empty)' : c.after}` : e.count > 1 ? ` ${e.count} records` : ''
  return `${who} ${verb[e.op]}${what}${e.path ? ` in ${e.path}` : ''}`
}

/** Entries older than this instant are due for removal (`retentionDays` clamped 30..3650, like the audit log). */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  const d = Math.max(30, Math.min(3650, Math.round(Number.isFinite(retentionDays) ? retentionDays : 365)))
  return new Date(now.getTime() - d * 86_400_000)
}
export const isExpired = (e: Pick<PriceLogEntry, 'at'>, cutoff: Date): boolean => Date.parse(e.at) < cutoff.getTime()

// ---- Phase 243 (M23): the shared (server) log, design 4.5 ------------------------------------------------------------------
/** What one accepted Price List record change means for the log. Mirrors `qt_price_log_change` in supabase/sql/20_price_log.sql (keep the two in step). */
export interface ServerChange { entity: LogEntity; op: LogOp; path: string[]; changes: LogChange[] }
export interface ServerChangeCtx { categoryName?: string; tabName?: string; colLabel?: (key: string) => string }
const ENTITY: Readonly<Record<PermRecord['kind'], LogEntity>> = { price_row: 'row', price_tab: 'tab', price_category: 'category', price_tier: 'tier' }

/** `permRecordFromPayload` keeps tab / category / tier text in its stable JSON form ("Panna" with quotes) for comparing; the log shows the plain text. */
const unquote = (t: string): string => { if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) { try { const v: unknown = JSON.parse(t); if (typeof v === 'string') return v } catch { /* keep as is */ } } return t }

/**
 * Turns (stored record, accepted record) into a log entry, or null when nothing worth logging changed (a bare reorder of rows, a resave with
 * the same content). Row: new = add, back from the trash = restore, text change = edit, a changed non-empty cell = overwrite. Tab: new = add.
 * Category / tier: new or changed = structure. Tombstone of a live record = delete. Never per keystroke: the app already batches per save.
 */
export function deriveServerChange(oldRec: PermRecord | null, newRec: PermRecord, ctx: ServerChangeCtx = {}): ServerChange | null {
  const wasDeleted = oldRec?.deleted === true
  const entity = ENTITY[newRec.kind]
  const label = ctx.colLabel ?? ((k: string): string => k)
  const own = unquote(newRec.kind === 'price_tier' ? (newRec.label ?? oldRec?.label ?? '') : (newRec.name ?? oldRec?.name ?? ''))
  const path = newRec.kind === 'price_row' ? [ctx.categoryName, ctx.tabName, own] : newRec.kind === 'price_tab' ? [ctx.categoryName, own] : [own]
  const out = (op: LogOp, changes: LogChange[] = []): ServerChange => ({ entity, op, path: path.filter((x): x is string => typeof x === 'string'), changes })
  if (newRec.deleted === true) return oldRec && !wasDeleted ? out('delete') : null
  if (newRec.kind === 'price_row') {
    if (!oldRec) return out('add')
    if (wasDeleted) return out('restore')
    const changes: LogChange[] = []
    if ((oldRec.name ?? '') !== (newRec.name ?? '')) changes.push({ column: 'Name', before: oldRec.name ?? '', after: newRec.name ?? '' })
    const a = oldRec.cells ?? {}
    const b = newRec.cells ?? {}
    let overwrite = false
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const before = a[k] ?? ''
      const after = b[k] ?? ''
      if (before === after) continue
      if (before !== '') overwrite = true
      changes.push({ column: label(k), before, after })
    }
    return changes.length === 0 ? null : out(overwrite ? 'overwrite' : 'edit', changes)
  }
  if (!oldRec) return out(newRec.kind === 'price_tab' ? 'add' : 'structure')
  if (wasDeleted) return out('restore')
  const same = oldRec.name === newRec.name && oldRec.label === newRec.label && oldRec.position === newRec.position && oldRec.columnsKey === newRec.columnsKey &&
    oldRec.parentId === newRec.parentId && oldRec.key === newRec.key
  return same ? null : out('structure')
}

/** A log row as the Activity list shows it: the pure entry, its paging id and (shared log only) the branch name. */
export interface ActivityRow extends PriceLogEntry { id: number; branchName?: string }

/** One CSV line per changed value (or one line for an entry without values). Text that a spreadsheet could run as a formula is neutralised (`csvField`). */
export function activityToCsv(rows: readonly ActivityRow[], opts: { bom?: boolean } = {}): string {
  const head = ['When', 'Seat', 'Branch', 'Device', 'Action', 'Where', 'Column', 'Before', 'After', 'Records']
  const lines = [head.join(',')]
  for (const r of rows) {
    const base = [r.at, r.seatNo === null ? '' : String(r.seatNo), r.branchName ?? '', r.deviceKind, r.op, r.path]
    const cs = r.changes && r.changes.length > 0 ? r.changes : [null]
    for (const c of cs) lines.push([...base, c?.column ?? '', c?.before ?? '', c?.after ?? '', String(r.count)].map((f, i) => csvField(f, i === 1 || i === 9)).join(','))
  }
  return `${opts.bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`
}
