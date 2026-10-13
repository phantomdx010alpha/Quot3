import Fuse from 'fuse.js'
import { normalizePartyName, type PartyLite } from './partyLite'

export const PARTY_SEARCH_LIMIT = 8
/** Fuse threshold from the contract (0 = exact, 1 = anything). */
export const PARTY_FUZZY_THRESHOLD = 0.35
/** A query made only of digits / space / + / - is a phone search; it needs at least this many digits (fewer → no suggestions). */
export const PHONE_QUERY_MIN = 3

export interface PartyIndex {
  search(query: string, limit?: number): PartyLite[]
}

const PHONE_QUERY_RE = /^[\d\s+-]+$/
const digits = (s: string): string => s.replace(/\D/g, '')

interface Entry { party: PartyLite; norm: string; phoneDigits: string }

/**
 * Pure fuzzy index over the saved parties. Ranking is a stable tier sort so the obvious match is always first:
 * exact name → name prefix → a word of the name starts with the query → Fuse score → name A–Z.
 */
export function createPartyIndex(parties: readonly PartyLite[]): PartyIndex {
  const entries: Entry[] = parties.map((party) => ({ party, norm: normalizePartyName(party.name), phoneDigits: digits(party.phone) }))
  const fuse = new Fuse(entries, {
    keys: ['norm'], // phone numbers are searched by digit substring below, never fuzzily (a fuzzy digit match is noise)
    threshold: PARTY_FUZZY_THRESHOLD,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2
  })

  return {
    search(query, limit = PARTY_SEARCH_LIMIT) {
      const q = normalizePartyName(query)
      if (q === '' || limit <= 0) return []

      if (PHONE_QUERY_RE.test(q)) {
        const d = digits(q)
        if (d.length < PHONE_QUERY_MIN) return []
        return entries
          .filter((e) => e.phoneDigits.includes(d))
          .sort((a, b) => Number(b.phoneDigits.startsWith(d)) - Number(a.phoneDigits.startsWith(d)) || a.norm.localeCompare(b.norm))
          .slice(0, limit)
          .map((e) => e.party)
      }

      const scored = new Map<Entry, number>()
      for (const r of fuse.search(q)) scored.set(r.item, r.score ?? 1)
      // Anything that literally contains the query always qualifies (Fuse can miss very short needles).
      for (const e of entries) if (!scored.has(e) && e.norm.includes(q)) scored.set(e, 0.3)

      const tier = (e: Entry): number => {
        if (e.norm === q) return 0
        if (e.norm.startsWith(q)) return 1
        if (e.norm.split(' ').some((w) => w.startsWith(q))) return 2
        return 3
      }
      return [...scored.entries()]
        .sort(([a, sa], [b, sb]) => tier(a) - tier(b) || sa - sb || a.norm.localeCompare(b.norm) || a.party.id.localeCompare(b.party.id))
        .slice(0, limit)
        .map(([e]) => e.party)
    }
  }
}
