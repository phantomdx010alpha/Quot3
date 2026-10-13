import { hostname } from 'node:os'
import type { BranchRepo } from '../db/branchRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import {
  DEACTIVATE_WORD, checkPrefixForServer, linkStateFor, maskLicenseKey, validateAnonKey, validateLicenseKey, validatePassphrase, validateSupabaseUrl,
  type ActivateInput, type Checked, type LicenseStatus, type LinkState, type RegisteredBranch
} from '../../shared/sync/license'
import { deriveKey, keyCheck, SYNC_KDF_ITERATIONS, unwrapStoredKey, verifyKeyCheck, wrapKeyForStorage } from './crypto'
import type { SecretStore } from './secretStore'
import { TransportError, type SyncTransport } from './transport'

/** `sync_state` keys written by this phase. Secrets are stored encrypted (`*Blob`). */
export const SYNC_KEYS = {
  url: 'license.url',
  anonKey: 'license.anonKey',
  licenseBlob: 'license.keyBlob',
  licenseHint: 'license.hint',
  /** Phase 52 stored the passphrase here; Phase 53 no longer writes it. Kept in the list so deactivate wipes old installs. */
  passphraseBlob: 'license.passphraseBlob',
  /** Phase 53: the PBKDF2-derived 32-byte key, wrapped by safeStorage. The passphrase itself is never stored. */
  encKeyBlob: 'license.encKeyBlob',
  /** Phase 53: 4-byte key check (hex) so a re-entered passphrase can be verified without decrypting anything. */
  encKeyCheck: 'license.encKeyCheck',
  orgId: 'license.orgId',
  kdfSalt: 'license.kdfSalt',
  branches: 'license.branches',
  registeredBranch: 'license.registeredBranch',
  activatedAt: 'license.activatedAt',
  link: 'license.link'
} as const
const ALL_KEYS = Object.values(SYNC_KEYS)

export interface LicenseService {
  status(opts?: { check?: boolean }): Promise<LicenseStatus>
  activate(input: ActivateInput): Promise<LicenseStatus>
  deactivate(input: { confirm: string }): Promise<LicenseStatus>
  /** For later sync phases: the stored credentials, or null while sync is not activated. Never sent to the renderer. */
  credentials(): { url: string; anonKey: string; license: string; branchId: string; orgId: string; kdfSalt: string } | null
  isActivated(): boolean
  /** Phase 53: the cached org encryption key for `crypto.seal/open`, or null when not activated or the cache is unreadable. Never sent to the renderer. */
  encryptionKey(): Buffer | null
  /** Phase 55: the ids of every OTHER branch registered for this license (the push fan-out list); empty when not activated. */
  recipients(): string[]
}

export interface LicenseDeps {
  sync: SyncStateRepo
  branches: BranchRepo
  secrets: SecretStore
  /** Builds the transport for a project (the real one wraps `SupabaseTransport`; tests return an `InMemoryTransport`). */
  makeTransport: (cfg: { url: string; anonKey: string }) => SyncTransport
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  deviceName?: () => string
  /** PBKDF2 rounds; production default 310 000. Tests lower it. */
  kdfIterations?: number
}

const json = <T>(raw: string | undefined, fallback: T): T => { if (raw === undefined) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }
/** Unwraps a checked value or refuses with its message. */
function need<T>(c: Checked<T>): T { if (!c.ok) throw new AppError('VALIDATION', c.message); return c.value }

/** Maps a transport failure to the IPC error the renderer shows (the license key never appears in a message). */
function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  if (e instanceof TransportError) {
    const code = e.kind === 'license' || e.kind === 'unknown_branch' ? 'LICENSE_INVALID' : e.kind === 'offline' || e.kind === 'timeout' || e.kind === 'server' ? 'SYNC_OFFLINE' : 'VALIDATION'
    return new AppError(code, e.message)
  }
  return new AppError('UNKNOWN', 'Something went wrong while contacting Supabase.')
}

export function createLicenseService(deps: LicenseDeps, opts: { writable?: boolean; now?: () => Date } = {}): LicenseService {
  const now = opts.now ?? (() => new Date())
  const { sync, secrets } = deps
  const guard = (): void => { if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }

  const activated = (): boolean => sync.get(SYNC_KEYS.licenseBlob) !== undefined && sync.get(SYNC_KEYS.orgId) !== undefined

  function readLicense(): string | null {
    const blob = sync.get(SYNC_KEYS.licenseBlob)
    if (blob === undefined) return null
    try { return secrets.decrypt(blob) } catch { return null }
  }

  function credentials(): ReturnType<LicenseService['credentials']> {
    if (!activated()) return null
    const license = readLicense()
    const reg = json<{ branchId: string } | null>(sync.get(SYNC_KEYS.registeredBranch), null)
    const url = sync.get(SYNC_KEYS.url), anonKey = sync.get(SYNC_KEYS.anonKey), orgId = sync.get(SYNC_KEYS.orgId), kdfSalt = sync.get(SYNC_KEYS.kdfSalt)
    if (!license || !reg || !url || !anonKey || !orgId || !kdfSalt) return null
    return { url, anonKey, license, branchId: reg.branchId, orgId, kdfSalt }
  }

  function encryptionKey(): Buffer | null {
    if (!activated()) return null
    const blob = sync.get(SYNC_KEYS.encKeyBlob)
    if (blob === undefined) return null
    const key = unwrapStoredKey(secrets, blob)
    const check = sync.get(SYNC_KEYS.encKeyCheck)
    return key !== null && check !== undefined && verifyKeyCheck(key, check) ? key : null
  }

  function setLink(state: LinkState, message: string): void {
    sync.set(SYNC_KEYS.link, JSON.stringify({ state, at: now().toISOString(), message }))
  }

  function snapshot(): LicenseStatus {
    const local = deps.branches.local()
    const isOn = activated()
    const reg = json<RegisteredBranch | null>(sync.get(SYNC_KEYS.registeredBranch), null)
    const url = sync.get(SYNC_KEYS.url) ?? ''
    let host = ''
    try { host = url === '' ? '' : new URL(url).host } catch { host = '' }
    const link = json<{ state: LinkState; at: string; message: string }>(sync.get(SYNC_KEYS.link), { state: 'unchecked', at: '', message: '' })
    const localInfo = local ? { branchId: local.id, name: local.name, poPrefix: local.poPrefix } : null
    return {
      state: isOn ? 'activated' : 'not_activated',
      secretsAvailable: secrets.available(),
      readOnly: opts.writable === false,
      host,
      licenseHint: isOn ? (sync.get(SYNC_KEYS.licenseHint) ?? '') : '',
      orgId: isOn ? (sync.get(SYNC_KEYS.orgId) ?? '') : '',
      registered: isOn && reg ? { branchId: reg.branchId, name: reg.name, poPrefix: reg.poPrefix } : null,
      local: localInfo,
      prefixInSync: !isOn || !reg || !local || reg.poPrefix === local.poPrefix.toUpperCase(),
      branches: isOn ? json<RegisteredBranch[]>(sync.get(SYNC_KEYS.branches), []) : [],
      passphraseSaved: isOn && encryptionKey() !== null,
      activatedAt: isOn ? (sync.get(SYNC_KEYS.activatedAt) ?? '') : '',
      link: isOn ? link : { state: 'unchecked', at: '', message: '' }
    }
  }

  async function check(): Promise<void> {
    const c = credentials()
    if (!c) { setLink('license_problem', 'The stored license could not be read. Activate again.'); return }
    const t = deps.makeTransport({ url: c.url, anonKey: c.anonKey })
    try {
      await t.touch({ license: c.license, branchId: c.branchId })
      const list = await t.listBranches({ license: c.license, branchId: c.branchId })
      sync.set(SYNC_KEYS.branches, JSON.stringify(list.map(({ branchId, name, poPrefix }) => ({ branchId, name, poPrefix }))))
      setLink('ok', 'Connected.')
    } catch (e) {
      const err = e instanceof TransportError ? e : new TransportError('server')
      setLink(linkStateFor(err.kind), err.message)
    }
  }

  return {
    credentials,
    isActivated: activated,
    encryptionKey,
    recipients() {
      const c = credentials()
      if (!c) return []
      return json<RegisteredBranch[]>(sync.get(SYNC_KEYS.branches), []).map((b) => b.branchId).filter((id) => id !== c.branchId)
    },
    async status(o = {}) {
      if (o.check === true && activated() && opts.writable !== false) await check()
      return snapshot()
    },

    async activate(input) {
      guard()
      if (!secrets.available()) throw new AppError('IO_ERROR', 'This computer cannot protect the license key (Windows secure storage is unavailable), so sync cannot be activated here.')
      const u = need(validateSupabaseUrl(input.supabaseUrl))
      const a = need(validateAnonKey(input.anonKey))
      const k = need(validateLicenseKey(input.licenseKey))
      const p = need(validatePassphrase(input.passphrase))
      const local = deps.branches.local()
      if (!local) throw new AppError('DB_ERROR', 'No local branch is set up yet.')
      const px = need(checkPrefixForServer(local.poPrefix))

      let res
      try {
        res = await deps.makeTransport({ url: u, anonKey: a }).registerBranch({ license: k, branchId: local.id, name: local.name, poPrefix: px, device: (deps.deviceName ?? hostname)().slice(0, 80) })
      } catch (e) {
        const err = toAppError(e)
        deps.log.warn('License activation failed', { code: err.code, kind: e instanceof TransportError ? e.kind : 'other' })
        throw err
      }
      let encKey: Buffer
      try { encKey = await deriveKey(p, res.kdfSalt, deps.kdfIterations ?? SYNC_KDF_ITERATIONS) } catch {
        throw new AppError('VALIDATION', 'The organisation salt from the server is unusable, so the encryption key could not be made.')
      }
      // Everything or nothing: a crash in the middle cannot leave a half-activated database.
      sync.setMany({
        [SYNC_KEYS.url]: u,
        [SYNC_KEYS.anonKey]: a,
        [SYNC_KEYS.licenseBlob]: secrets.encrypt(k),
        [SYNC_KEYS.licenseHint]: maskLicenseKey(k),
        [SYNC_KEYS.encKeyBlob]: wrapKeyForStorage(secrets, encKey),
        [SYNC_KEYS.encKeyCheck]: keyCheck(encKey),
        [SYNC_KEYS.orgId]: res.orgId,
        [SYNC_KEYS.kdfSalt]: res.kdfSalt,
        [SYNC_KEYS.branches]: JSON.stringify(res.branches),
        [SYNC_KEYS.registeredBranch]: JSON.stringify({ branchId: local.id, name: local.name, poPrefix: px }),
        [SYNC_KEYS.activatedAt]: now().toISOString(),
        [SYNC_KEYS.link]: JSON.stringify({ state: 'ok', at: now().toISOString(), message: 'Connected.' })
      })
      deps.branches.audit({ at: now().toISOString(), branchId: local.id, entity: 'license', entityId: res.orgId, action: 'activate', detailJson: JSON.stringify({ host: new URL(u).host, prefix: px }) })
      deps.log.info('License activated', { branches: res.branches.length })
      return snapshot()
    },

    async deactivate(input) {
      guard()
      if (input.confirm.trim().toUpperCase() !== DEACTIVATE_WORD) throw new AppError('VALIDATION', `Type ${DEACTIVATE_WORD} to confirm.`)
      const local = deps.branches.local()
      const org = sync.get(SYNC_KEYS.orgId) ?? null
      sync.remove(ALL_KEYS)
      sync.remove(sync.keys('sync.')) // Phase 56: the pull cursor, unacknowledged ids and held changes belong to this license
      deps.branches.audit({ at: now().toISOString(), branchId: local?.id ?? null, entity: 'license', entityId: org, action: 'deactivate', detailJson: null })
      deps.log.info('License deactivated')
      return snapshot()
    }
  }
}
