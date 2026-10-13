import { randomUUID } from 'node:crypto'
import type { PartyRepo } from '../db/partyRepo'
import { normalizePartyName, type PartyLite } from '../../shared/party/partyLite'
import { SAMPLE_PARTIES } from '../../shared/party/sampleParties'
import { AppError } from '../ipc/envelope'

export interface PartyInput {
  id?: string
  name: string
  phone?: string
  address?: string
  transport?: string
}

export interface PartyService {
  list(): PartyLite[]
  upsert(input: PartyInput): { id: string }
  /** Dev only: inserts the sample parties once, into a table that has never had a row. Returns how many were added. */
  seedSamples(): number
}

const nullIfBlank = (s: string | undefined): string | null => (s === undefined || s.trim() === '' ? null : s.trim())

export function createPartyService(
  repo: PartyRepo,
  opts: { writable?: boolean; now?: () => Date; newId?: () => string; newPartyId?: (nameNorm: string) => string; partyChanged?: (partyId: string) => void } = {}
): PartyService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }

  return {
    list: () => repo.list(),

    upsert(input) {
      guard()
      const name = input.name.replace(/\s+/g, ' ').trim()
      const nameNorm = normalizePartyName(name)
      if (nameNorm === '') throw new AppError('VALIDATION', 'A party needs a name')
      const at = now().toISOString()
      return repo.transaction(() => {
        if (input.id !== undefined) {
          // Explicit update: the caller's values are authoritative (blank = cleared).
          const ok = repo.update({ id: input.id, name, nameNorm, phone: nullIfBlank(input.phone), address: nullIfBlank(input.address), transport: nullIfBlank(input.transport), at })
          if (!ok) throw new AppError('NOT_FOUND', 'Party not found')
          return { id: input.id }
        }
        const existing = repo.findByNorm(nameNorm)
        if (existing) {
          // Same name already saved: fill in what the bill knows, never wipe what is stored.
          const pick = (given: string | undefined, stored: string): string | null => nullIfBlank(given) ?? nullIfBlank(stored)
          repo.update({
            id: existing.id, name: existing.name, nameNorm,
            phone: pick(input.phone, existing.phone), address: pick(input.address, existing.address), transport: pick(input.transport, existing.transport), at
          })
          opts.partyChanged?.(existing.id)
          return { id: existing.id }
        }
        const id = opts.newPartyId ? opts.newPartyId(nameNorm) : newId()
        repo.insert({ id, name, nameNorm, phone: nullIfBlank(input.phone), address: nullIfBlank(input.address), transport: nullIfBlank(input.transport), at }, 'manual')
        opts.partyChanged?.(id)
        return { id }
      })
    },

    seedSamples() {
      guard()
      return repo.transaction(() => {
        if (repo.countAll() > 0) return 0
        const at = now().toISOString()
        for (const p of SAMPLE_PARTIES) {
          repo.insert({ id: newId(), name: p.name, nameNorm: normalizePartyName(p.name), phone: nullIfBlank(p.phone), address: nullIfBlank(p.address), transport: nullIfBlank(p.transport), at }, 'manual')
        }
        return SAMPLE_PARTIES.length
      })
    }
  }
}
