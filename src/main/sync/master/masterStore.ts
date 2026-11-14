/**
 * Phase 263 - what the desktop remembers about the master (API_CONTRACTS.md M24-0 C6, desktop column): the namespace `master.` in the
 * existing local key-value table (`sync_state`), with the device token wrapped by the OS secret store exactly like the other secrets of
 * `activationV2.ts`. NEVER stored: the seat password after first sign-in, the service_role key at all, an enrol token, a seat code.
 * The service_role key and the enrol token live in memory for the one `link` call only.
 */
import type { SecretStore } from '../secretStore'

/** The part of `SyncStateRepo` used here (tests pass a Map-backed one). */
export interface MasterKv {
  get(key: string): string | undefined
  set(key: string, value: string): void
  setMany(entries: Record<string, string>): void
  remove(keys: readonly string[]): void
  keys(prefix: string): string[]
}

export const MASTER_KEYS = {
  deviceToken: 'master.deviceToken',
  companyId: 'master.companyId',
  companyLabel: 'master.companyLabel',
  seatNo: 'master.seatNo',
  seatLabel: 'master.seatLabel',
  profileVersion: 'master.profileVersion',
  lastError: 'master.lastError'
} as const

export interface MasterLink {
  deviceToken: string
  companyId: string
  companyLabel: string
  seatNo: number
  seatLabel: string
  profileVersion: number | null
}

export interface MasterStore {
  /** Null when never linked, or when the stored token cannot be read (another Windows user): treated as not linked. */
  link(): MasterLink | null
  save(link: MasterLink): void
  setSeat(no: number, label: string): void
  setProfileVersion(version: number): void
  lastError(): string
  setLastError(words: string): void
  clear(): void
}

export function createMasterStore(deps: { kv: MasterKv; secrets: SecretStore }): MasterStore {
  const { kv, secrets } = deps
  return {
    link() {
      const blob = kv.get(MASTER_KEYS.deviceToken)
      const companyId = kv.get(MASTER_KEYS.companyId)
      const companyLabel = kv.get(MASTER_KEYS.companyLabel)
      const seatNo = Number(kv.get(MASTER_KEYS.seatNo))
      if (blob === undefined || !companyId || companyLabel === undefined || !Number.isInteger(seatNo) || seatNo < 1) return null
      let deviceToken: string
      try { deviceToken = secrets.decrypt(blob) } catch { return null }
      if (!deviceToken) return null
      const pv = kv.get(MASTER_KEYS.profileVersion)
      const n = pv === undefined ? NaN : Number(pv)
      return { deviceToken, companyId, companyLabel, seatNo, seatLabel: kv.get(MASTER_KEYS.seatLabel) ?? `Seat ${seatNo}`, profileVersion: Number.isInteger(n) && n >= 0 ? n : null }
    },
    save(l) {
      if (!secrets.available()) throw new Error('secret store unavailable')
      const entries: Record<string, string> = {
        [MASTER_KEYS.deviceToken]: secrets.encrypt(l.deviceToken), [MASTER_KEYS.companyId]: l.companyId, [MASTER_KEYS.companyLabel]: l.companyLabel,
        [MASTER_KEYS.seatNo]: String(l.seatNo), [MASTER_KEYS.seatLabel]: l.seatLabel
      }
      kv.setMany(entries)
      if (l.profileVersion === null) kv.remove([MASTER_KEYS.profileVersion])
      else kv.set(MASTER_KEYS.profileVersion, String(l.profileVersion))
    },
    setSeat(no, label) { kv.setMany({ [MASTER_KEYS.seatNo]: String(no), [MASTER_KEYS.seatLabel]: label }) },
    setProfileVersion(v) { kv.set(MASTER_KEYS.profileVersion, String(v)) },
    lastError: () => kv.get(MASTER_KEYS.lastError) ?? '',
    setLastError(words) { if (words) kv.set(MASTER_KEYS.lastError, words); else kv.remove([MASTER_KEYS.lastError]) },
    clear() { kv.remove(kv.keys('master.')) }
  }
}
