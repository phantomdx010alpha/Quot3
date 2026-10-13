import type { PartySnapshot } from '../types'

/** What the renderer needs of a saved party (blank string = not given). */
export interface PartyLite {
  id: string
  name: string
  phone: string
  address: string
  transport: string
}

/** The ONE definition of `parties.name_norm`: NFC, trimmed, whitespace collapsed, lower-cased. */
export function normalizePartyName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function findPartyByName<P extends { name: string }>(parties: readonly P[], name: string): P | undefined {
  const n = normalizePartyName(name)
  if (n === '') return undefined
  return parties.find((p) => normalizePartyName(p.name) === n)
}

/**
 * A bill's party is NEW when it has a name and no saved party has the same normalised name.
 * Phase 27's `bills:save` upserts the party only when this is true — a bill never re-adds an existing party.
 */
export function isNewParty(name: string, parties: readonly { name: string }[]): boolean {
  return normalizePartyName(name) !== '' && findPartyByName(parties, name) === undefined
}

export function partyToSnapshot(p: PartyLite): PartySnapshot {
  return { name: p.name, phone: p.phone, address: p.address, transport: p.transport }
}
