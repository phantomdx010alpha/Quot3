/** Phone party directory (Phase 177): the light in-memory list behind the party-name autocomplete.
 *  The ranking is the SAME pure code the desktop uses (`shared/party/fuzzy.createPartyIndex`: exact, prefix, word-prefix, Fuse score, A-Z;
 *  phone queries match by digits), so the phone suggests in the same order as the PC. Nothing here touches IndexedDB except
 *  `loadPartyDirectory` / `refreshPartyInDirectory`. The Fuse index is rebuilt lazily, once, after the list changed (never per keystroke). */
import { createPartyIndex, PARTY_SEARCH_LIMIT, type PartyIndex } from '../../shared/party/fuzzy'
import { normalizePartyName, type PartyLite } from '../../shared/party/partyLite'
import type { PhoneDb } from './db'
import { getParty, listPartyLites } from './partiesRepo'

export interface PartyDirectory {
  /** Number of live customers. */
  size(): number
  /** The whole list, `name_norm` then id. The SAME array object until something changes (safe for a store / `useMemo`). */
  all(): readonly PartyLite[]
  /** Ranked suggestions for what the user typed (`limit` defaults to 8). Empty / too-short phone queries give none. */
  search(query: string, limit?: number): PartyLite[]
  /** The customer whose normalised name equals this name, if any. */
  find(name: string): PartyLite | undefined
  /** True when the name is non-blank and no customer has the same normalised name (a save would create one). */
  isNew(name: string): boolean
  /** Adds or replaces one customer (after a save / a sync change). */
  upsert(p: PartyLite): void
  /** Removes one customer (deleted or merged away). */
  remove(id: string): void
}

const order = (a: PartyLite, b: PartyLite): number => {
  const x = normalizePartyName(a.name)
  const y = normalizePartyName(b.name)
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function createPartyDirectory(initial: readonly PartyLite[] = []): PartyDirectory {
  const byId = new Map<string, PartyLite>()
  for (const p of initial) byId.set(p.id, p)
  let list: PartyLite[] | null = null
  let norms: Map<string, PartyLite> | null = null
  let index: PartyIndex | null = null
  const dirty = (): void => { list = null; norms = null; index = null }
  const getList = (): PartyLite[] => (list ??= [...byId.values()].sort(order))
  const getNorms = (): Map<string, PartyLite> => {
    if (!norms) {
      norms = new Map()
      for (const p of getList()) { const n = normalizePartyName(p.name); if (n !== '' && !norms.has(n)) norms.set(n, p) }
    }
    return norms
  }
  return {
    size: () => byId.size,
    all: getList,
    search: (query, limit = PARTY_SEARCH_LIMIT) => (index ??= createPartyIndex(getList())).search(query, limit),
    find: (name) => getNorms().get(normalizePartyName(name)),
    isNew: (name) => { const n = normalizePartyName(name); return n !== '' && !getNorms().has(n) },
    upsert: (p) => { byId.set(p.id, p); dirty() },
    remove: (id) => { if (byId.delete(id)) dirty() }
  }
}

/** Reads every live customer once and builds the directory (call at app start; keep it in memory). */
export async function loadPartyDirectory(db: PhoneDb): Promise<PartyDirectory> {
  return createPartyDirectory(await listPartyLites(db))
}

/** Re-reads ONE customer from the database into the directory (after a save that may have created or changed it, or a sync change). */
export async function refreshPartyInDirectory(db: PhoneDb, dir: PartyDirectory, id: string): Promise<void> {
  const r = await getParty(db, id)
  if (!r || r.deletedAt !== null || r.mergedInto !== null) { dir.remove(id); return }
  dir.upsert({ id: r.id, name: r.name, phone: r.phone ?? '', address: r.address ?? '', transport: r.transport ?? '' })
}
