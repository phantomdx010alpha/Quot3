/** Phone Price List rights (Phase 246, M23). Pure rules from `shared/pricelist/perms.ts` plus three small `meta` rows:
 *  - `pricelist.perms`   the LAST server answer for this seat `{ seatNo, flags, at }` (cached, so an offline phone keeps the last known rights);
 *  - `pricelist.refused` the kept-list of changes the main branch refused: ids, kind, code and the MISSING RIGHTS only, never content (like the desktop);
 *  - `pricelist.draft`   one unsaved edit (survives a closed tab).
 *  A linked phone that has never heard from the server has NO rights until the first answer [A]; a phone without sync has full rights (shared rule).
 *  The server is the real gate (`sn_push` answers `refused`); this module only lets the screen say so early. Data only: nothing here executes a record. */
import {
  PERM_FLAGS, effectiveFlags, isAllowed, missingFlags, normalizeFlags, notAllowedText, permRecordFromPayload, requiredFlags,
  type PermFlag, type PermFlags, type PermRecord
} from '../../shared/pricelist/perms'
import type { PriceKind } from '../../shared/sync/priceListRecords'
import { getRecord, putRecord, reqToPromise, type PhoneDb } from './db'

export const PERMS_KEY = 'pricelist.perms'
export const REFUSED_KEY = 'pricelist.refused'
export const DRAFT_KEY = 'pricelist.draft'
export const REFUSED_KEEP_MAX = 200

interface MetaRow { key: string; value: unknown }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---- cached rights ---------------------------------------------------------------------------------------------------

export interface CachedPerms { seatNo: number; flags: PermFlags; at: string }

/** Anything unreadable is "nothing cached". */
export function parseCachedPerms(raw: unknown): CachedPerms | null {
  if (!isObj(raw) || typeof raw.seatNo !== 'number' || !Number.isInteger(raw.seatNo) || raw.seatNo < 1) return null
  return { seatNo: raw.seatNo, flags: normalizeFlags(raw.flags), at: typeof raw.at === 'string' ? raw.at : '' }
}
export async function readCachedPerms(db: PhoneDb): Promise<CachedPerms | null> {
  return parseCachedPerms((await getRecord<MetaRow>(db, 'meta', PERMS_KEY))?.value)
}
export async function writeCachedPerms(db: PhoneDb, answer: { seatNo: number; flags: unknown }, at: string): Promise<void> {
  await putRecord(db, 'meta', { key: PERMS_KEY, value: { seatNo: answer.seatNo, flags: normalizeFlags(answer.flags), at } satisfies CachedPerms } satisfies MetaRow)
}

/** This phone's rights now: no sync = full; seat 1 = full; another seat = the cached flags; none cached = none [A]. */
export function rightsFor(linked: boolean, cached: CachedPerms | null): PermFlags {
  return effectiveFlags(cached?.seatNo ?? null, cached?.flags, linked)
}

// ---- the check every control and every save goes through -------------------------------------------------------------------

export type Guard = { ok: true; required: PermFlag[] } | { ok: false; required: PermFlag[]; missing: PermFlag[]; text: string }

const SLOT: Readonly<Record<PriceKind, string>> = { price_tier: 'tier', price_category: 'category', price_tab: 'tab', price_row: 'row' }
/** A stored record as the shared diff sees it (null = the record is new). */
export const permRecordOf = (kind: PriceKind, rec: unknown, deleted = false): PermRecord => permRecordFromPayload(kind, { [SLOT[kind]]: rec }, deleted)

/** May these flags make this change? `oldRec` null = a new record. A change that alters nothing needs no flag and is allowed. */
export function guardChange(flags: PermFlags, kind: PriceKind, oldRec: unknown | null, newRec: unknown, deleted = false): Guard {
  const required = requiredFlags(oldRec === null ? null : permRecordOf(kind, oldRec, (oldRec as { deletedAt?: unknown }).deletedAt != null), permRecordOf(kind, newRec, deleted))
  if (isAllowed(flags, required)) return { ok: true, required }
  const missing = missingFlags(flags, required)
  return { ok: false, required, missing, text: notAllowedText(missing) }
}

/** The plain-words reason a single control is off, or '' when it is on (used to disable buttons and inputs one by one). */
export const reasonFor = (flags: PermFlags, need: readonly PermFlag[]): string => (isAllowed(flags, need) ? '' : notAllowedText(missingFlags(flags, need)))

// ---- refused kept-list ----------------------------------------------------------------------------------------------------

export interface RefusedEntry { kind: string; recId: string; code: string; missing: PermFlag[]; at: string }

const KNOWN = new Set<string>(PERM_FLAGS)
function cleanEntry(x: unknown): RefusedEntry | null {
  if (!isObj(x) || typeof x.kind !== 'string' || typeof x.recId !== 'string') return null
  return {
    kind: x.kind.slice(0, 30), recId: x.recId.slice(0, 100), code: typeof x.code === 'string' ? x.code.slice(0, 12) : 'Q3P01',
    missing: Array.isArray(x.missing) ? (x.missing.filter((m) => typeof m === 'string' && KNOWN.has(m)) as PermFlag[]) : [],
    at: typeof x.at === 'string' ? x.at.slice(0, 40) : ''
  }
}
export function parseRefused(raw: unknown): RefusedEntry[] {
  return Array.isArray(raw) ? raw.map(cleanEntry).filter((e): e is RefusedEntry => e !== null) : []
}
export async function readRefused(db: PhoneDb): Promise<RefusedEntry[]> {
  return parseRefused((await getRecord<MetaRow>(db, 'meta', REFUSED_KEY))?.value)
}
/** Adds (or replaces) one entry. Called INSIDE the push transaction (the `meta` store must be in it). Content is never stored: only ids, code, missing rights. */
export async function keepRefusedTx(tx: IDBTransaction, e: { kind: string; recId: string; code?: string; missing?: readonly string[]; at: string }): Promise<void> {
  const store = tx.objectStore('meta')
  const cur = parseRefused(((await reqToPromise(store.get(REFUSED_KEY))) as MetaRow | undefined)?.value)
  const next = cleanEntry({ kind: e.kind, recId: e.recId, code: e.code ?? 'Q3P01', missing: e.missing ?? [], at: e.at })
  if (!next) return
  const list = cur.filter((x) => !(x.kind === next.kind && x.recId === next.recId))
  list.push(next)
  store.put({ key: REFUSED_KEY, value: list.slice(-REFUSED_KEEP_MAX) } satisfies MetaRow)
}
export async function clearRefused(db: PhoneDb): Promise<void> {
  await putRecord(db, 'meta', { key: REFUSED_KEY, value: [] } satisfies MetaRow)
}

// ---- unsaved edit (draft) ---------------------------------------------------------------------------------------------------

/** One unsaved row edit. Plain text only (name and cell text); never executed. */
export interface PriceDraft { rowId: string; name: string; cells: Record<string, string>; at: string }

export function parseDraft(raw: unknown): PriceDraft | null {
  if (!isObj(raw) || typeof raw.rowId !== 'string' || typeof raw.name !== 'string' || !isObj(raw.cells)) return null
  const cells: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.cells)) if (typeof v === 'string') cells[k.slice(0, 100)] = v.slice(0, 1000)
  return { rowId: raw.rowId.slice(0, 100), name: raw.name.slice(0, 1000), cells, at: typeof raw.at === 'string' ? raw.at : '' }
}
export async function readDraft(db: PhoneDb): Promise<PriceDraft | null> {
  return parseDraft((await getRecord<MetaRow>(db, 'meta', DRAFT_KEY))?.value)
}
/** Keeps the draft (a read-only tab keeps nothing: it cannot write). */
export async function saveDraft(db: PhoneDb, d: PriceDraft): Promise<void> {
  if (!db.canWrite()) return
  await putRecord(db, 'meta', { key: DRAFT_KEY, value: d } satisfies MetaRow)
}
export async function clearDraft(db: PhoneDb): Promise<void> {
  if (!db.canWrite()) return
  await putRecord(db, 'meta', { key: DRAFT_KEY, value: null } satisfies MetaRow)
}
