/**
 * Phase 235 (M23) - Price List permissions (pure). Seat 1 = main branch for the Price List ONLY (CLAUDE_MUST_READ 10r).
 * Flags are [A]: add / edit / overwrite / delete / structure. The server re-implements the same diff in SQL (Phase 241-242); this is
 * the contract and the client-side mirror. Without shared sync this PC has full rights.
 */
export const PERM_FLAGS = ['add', 'edit', 'overwrite', 'delete', 'structure'] as const
export type PermFlag = (typeof PERM_FLAGS)[number]
export type PermFlags = Record<PermFlag, boolean>

export const NO_RIGHTS: Readonly<PermFlags> = { add: false, edit: false, overwrite: false, delete: false, structure: false }
export const ALL_RIGHTS: Readonly<PermFlags> = { add: true, edit: true, overwrite: true, delete: true, structure: true }

/** Stored / received flags -> a complete flag set; anything but a real `true` is false. */
export function normalizeFlags(raw: unknown): PermFlags {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { add: r.add === true, edit: r.edit === true, overwrite: r.overwrite === true, delete: r.delete === true, structure: r.structure === true }
}

/** Seat 1 always has every right and cannot lose them; other seats have what was granted; no sync -> full rights. */
export function effectiveFlags(seatNo: number | null, granted: unknown, syncActive: boolean): PermFlags {
  if (!syncActive || seatNo === 1) return { ...ALL_RIGHTS }
  if (seatNo === null) return { ...NO_RIGHTS }
  return normalizeFlags(granted)
}

/** What seat 1 is allowed to store for any seat: for seat 1 the flags are forced to all-true. */
export const flagsToStore = (seatNo: number, flags: unknown): PermFlags => (seatNo === 1 ? { ...ALL_RIGHTS } : normalizeFlags(flags))

export type PriceKind = 'price_tier' | 'price_category' | 'price_tab' | 'price_row'
/** A record payload as the diff sees it. `deleted` = tombstone / soft-deleted. */
export interface PermRecord {
  kind: PriceKind
  deleted?: boolean
  /** price_row */
  rowKind?: 'item' | 'section'
  idx?: number
  name?: string
  cells?: Record<string, string>
  /** category / tab / tier: names, positions, tab columns, parent. */
  position?: number
  columnsKey?: string
  parentId?: string
  label?: string
  /** price_tier: the stable key; a change counts as structure (Phase 242, mirrors qt_price_required in 19_price_perms.sql). */
  key?: string
}

/** The flags a change needs, comparing the old payload (null = new record) with the new one. Empty list = nothing changed. */
export function requiredFlags(oldRec: PermRecord | null, newRec: PermRecord): PermFlag[] {
  const need = new Set<PermFlag>()
  const wasDeleted = oldRec?.deleted === true
  if (newRec.deleted === true) { if (oldRec && !wasDeleted) need.add('delete'); return [...need] }
  if (newRec.kind !== 'price_row') {
    // tiers, categories, tabs: creating / restoring / renaming / reordering / changing columns are all structure
    if (!oldRec || wasDeleted) need.add('structure')
    else if (oldRec.name !== newRec.name || oldRec.label !== newRec.label || oldRec.position !== newRec.position || oldRec.columnsKey !== newRec.columnsKey || oldRec.parentId !== newRec.parentId || oldRec.key !== newRec.key) need.add('structure')
    return [...need]
  }
  if (!oldRec || wasDeleted) { need.add('add'); return [...need] }
  if (oldRec.name !== newRec.name || oldRec.rowKind !== newRec.rowKind || oldRec.idx !== newRec.idx) need.add('edit')
  const a = oldRec.cells ?? {}
  const b = newRec.cells ?? {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const before = a[k] ?? ''
    const after = b[k] ?? ''
    if (before === after) continue
    need.add(before === '' ? 'edit' : 'overwrite') // filling an empty cell is an edit; changing or clearing a value is an overwrite
  }
  return [...need]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Key-order independent text of a JSON value (jsonb equality in SQL ignores key order). */
function stableText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableText).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableText(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}
const cellText = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? stableText(v) : String(v))
const optText = (v: unknown): string | undefined => (v === undefined ? undefined : stableText(v))

/**
 * A synced record payload (`{ row: {...} }`, `{ tab }`, `{ category }`, `{ tier }`) as the diff sees it. Mirrors what
 * `qt_price_required` reads in SQL: row name = the `t` of every `nameRuns` entry joined; cell values compared as text; tier / category /
 * tab fields `name`, `label`, `key`, `position`, `columns`, `categoryId`. Anything unreadable becomes an empty record (never throws).
 */
export function permRecordFromPayload(kind: PriceKind, payload: unknown, deleted = false): PermRecord {
  const slot = kind === 'price_row' ? 'row' : kind === 'price_tab' ? 'tab' : kind === 'price_category' ? 'category' : 'tier'
  const o = isObj(payload) && isObj(payload[slot]) ? (payload[slot] as Record<string, unknown>) : {}
  if (kind === 'price_row') {
    const runs = Array.isArray(o.nameRuns) ? o.nameRuns : []
    const cellsIn = isObj(o.cells) ? o.cells : {}
    const cells: Record<string, string> = {}
    for (const k of Object.keys(cellsIn)) cells[k] = cellText(cellsIn[k])
    return {
      kind, deleted, rowKind: o.kind === 'section' ? 'section' : 'item', idx: typeof o.idx === 'number' ? o.idx : undefined,
      name: runs.map((r) => (isObj(r) && typeof r.t === 'string' ? r.t : '')).join(''), cells
    }
  }
  return { kind, deleted, name: optText(o.name), label: optText(o.label), key: optText(o.key), position: typeof o.position === 'number' ? o.position : undefined, columnsKey: optText(o.columns), parentId: optText(o.categoryId) }
}

export const isAllowed = (flags: PermFlags, required: readonly PermFlag[]): boolean => required.every((f) => flags[f] === true)
/** The flags still missing (for the plain-words refusal). */
export const missingFlags = (flags: PermFlags, required: readonly PermFlag[]): PermFlag[] => required.filter((f) => !flags[f])

export const PERM_LABELS: Readonly<Record<PermFlag, string>> = {
  add: 'Add new items', edit: 'Edit names, notes and fill empty prices', overwrite: 'Change existing prices', delete: 'Delete items, tabs and categories', structure: 'Change categories, tabs, columns and price levels'
}

/** Phase 256: the flag a refusal names, in the words the owner sees in Settings > Price List > Who can edit ("needs Overwrite"). */
export const PERM_NEEDS: Readonly<Record<PermFlag, string>> = { add: 'needs Add', edit: 'needs Edit', overwrite: 'needs Overwrite', delete: 'needs Delete', structure: 'needs Structure' }
export const needsWord = (f: PermFlag): string => PERM_NEEDS[f]
/** "needs Overwrite, needs Edit" (one phrase for several flags). */
export const needsWords = (flags: readonly PermFlag[]): string => flags.map(needsWord).join(', ')
/** The flags named by a kept-list of refused changes (any entry shape with `missing`), without repeats, in the order of the settings page. Unknown names are dropped. */
export function refusedNeeds(entries: readonly { missing?: readonly string[] }[]): PermFlag[] {
  const seen = new Set<string>()
  for (const e of entries) for (const m of e.missing ?? []) seen.add(m)
  return PERM_FLAGS.filter((f) => seen.has(f))
}

/** The plain-words refusal for a local change this seat may not make (Phase 242; the server answers `Q3P01` with its own text). */
export const notAllowedText = (missing: readonly PermFlag[]): string =>
  `This seat is not allowed to do that (${missing.map((f) => `${needsWord(f)}: ${PERM_LABELS[f]}`).join('; ')}). Ask the main branch (seat 1) to allow it in Settings > Price List > Who can edit.`

/** Phase 242 - the plain-words lines the Price List page shows for this seat (empty = full rights, nothing to say). `refused` = local changes the main branch did not accept. */
export function rightsNotice(flags: PermFlags, refused: number, needs: readonly PermFlag[] = []): string[] {
  const missing = PERM_FLAGS.filter((f) => !flags[f])
  const out: string[] = []
  if (missing.length === PERM_FLAGS.length) out.push('Read only: this seat can look at the Price List and search it, but cannot change it. Ask the main branch (seat 1) to allow it in Settings > Price List > Who can edit.')
  else if (missing.length > 0) out.push(`This seat is not allowed to: ${missing.map((f) => PERM_LABELS[f].toLowerCase()).join('; ')}. Ask the main branch (seat 1) in Settings > Price List > Who can edit.`)
  if (refused > 0) out.push(`${refused === 1 ? '1 change' : `${refused} changes`} made on this PC ${refused === 1 ? 'was' : 'were'} not accepted by the main branch${needs.length > 0 ? ` (${needsWords(needs)})` : ''} and ${refused === 1 ? 'stays' : 'stay'} only on this PC.`)
  return out
}

/** Phase 255 - what the "Rights" status block shows (desktop Settings > Price List and the phone sync status). Pure words, no clock: `when` turns an ISO time into text. */
export interface RightsStatusInput { seatNo: number | null; syncActive: boolean; flags: PermFlags; checkedAt: string | null; answeredAt: string | null; lastError: string }
export interface RightsStatusView { seat: string; rights: string; checked: string; error: string }
export function rightsStatusView(i: RightsStatusInput, when: (iso: string) => string = (s) => s): RightsStatusView {
  const seat = !i.syncActive ? 'Shared sync is off: this PC can change everything.' : i.seatNo === null ? 'This PC has no seat number yet.' : `Seat ${i.seatNo}${i.seatNo === 1 ? ' (main branch)' : ''}`
  const on = PERM_FLAGS.filter((f) => i.flags[f])
  const rights = !i.syncActive || i.seatNo === 1 ? 'Everything is allowed.'
    : i.answeredAt === null ? 'Nothing is allowed yet: the main branch has not answered. Press Check again.'
    : on.length === 0 ? 'Read only (nothing may be changed).'
    : `Allowed: ${on.map((f) => PERM_LABELS[f].toLowerCase()).join('; ')}.`
  const checked = i.checkedAt === null ? 'Not checked yet.' : `Last checked ${when(i.checkedAt)}${i.answeredAt === null ? '' : `; last answer ${when(i.answeredAt)}`}.`
  return { seat, rights, checked, error: i.lastError }
}

/** Phase 255 - automatic refresh throttle shared by desktop and phone: start / each sync cycle at most once a minute; after a refused push at most once per 10 s. */
export const AUTO_REFRESH_MS = 60_000
export const REFUSED_REFRESH_MS = 10_000
/** Is an automatic refresh due? `lastIso` = when the last ask happened ('' / unreadable = never). */
export function autoRefreshDue(lastIso: string, nowMs: number, afterRefused: boolean): boolean {
  const last = Date.parse(lastIso)
  return !Number.isFinite(last) || nowMs - last >= (afterRefused ? REFUSED_REFRESH_MS : AUTO_REFRESH_MS)
}
