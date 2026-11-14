import type { PhoneDb } from '../data/db'
import { getBranchLink, linkPhoneToOrganisation, validateLinkInput, type LinkInput, type LinkResult } from './branch'
import { createPhoneConnect } from './connect'
import { MASTER_ANON, MASTER_URL } from '../../shared/master/config'
import { createProfileRefresher, storeMasterProfile } from './companyProfile'
import { createPhoneMasterClient, redeemCode, type PhoneMasterClient, type RedeemResult } from './master'
import { clearSeatRemoved, createPhoneRecredential } from './recredential'
import { createPhoneSyncEngine, type PhoneSyncEngine, type PhoneSyncEngineDeps } from './engine'
import { PhoneSyncError } from './errors'
import { createSessionVault, persistSessionChanges, signOutPhone, type SessionVault } from './session'
import { PhoneSupabaseTransport, type PhoneSupabaseFactory } from './supabaseTransport'
import type { PhoneBranchInfo, PhoneBranchScope, PhoneManifestRow, PhonePullResult, PhonePushItem, PhonePushResult, PhoneSession, PhoneSharedPort } from './transport'
import type { RecordKind } from '../../shared/sync/codecV2'
import { readCachedPerms, readRightsAsk, writeCachedPerms, writeRightsAsk } from '../data/priceRights'
import { autoRefreshDue } from '../../shared/pricelist/perms'

/**
 * Wires the phone's sync together for the running app: ONE port that talks to the real Supabase once the phone knows the URL and key,
 * the encrypted login vault, the engine (push / pull / doorbell / first sync) and the sign-in / sign-out Settings calls.
 *
 * Why a "lazy" port: the Supabase URL and anon key are typed by the person at sign-in (nothing is built into the app) and afterwards come
 * from the vault at start. Until one of those exists every call answers "sign in again".
 */

export interface LazyPort extends PhoneSharedPort {
  /** (Re)build the real transport for this project. Safe to call again (a new URL or key). */
  configure(url: string, anonKey: string): void
  isConfigured(): boolean
}

export function createLazyPort(factory?: PhoneSupabaseFactory, makeTransport?: (url: string, anonKey: string) => PhoneSharedPort): LazyPort {
  let inner: PhoneSharedPort | null = null
  let offInner: (() => void) | null = null
  const listeners = new Set<(s: PhoneSession) => void>()
  const need = (): PhoneSharedPort => {
    if (!inner) throw new PhoneSyncError('auth_failed', 'Sign in again to keep syncing.')
    return inner
  }
  return {
    configure(url, anonKey) {
      offInner?.()
      inner = makeTransport ? makeTransport(url, anonKey) : new PhoneSupabaseTransport({ url, anonKey, factory })
      offInner = inner.onSessionChange((s) => { for (const cb of listeners) cb(s) })
    },
    isConfigured: () => inner !== null,
    signIn: async (a) => need().signIn(a),
    restoreSession: async (s) => need().restoreSession(s),
    onSessionChange(cb) { listeners.add(cb); return () => void listeners.delete(cb) },
    signOut: async () => { if (inner) await inner.signOut() },
    activate: async (a) => need().activate(a),
    branchNameFree: async (a) => need().branchNameFree(a),
    now: async () => need().now(),
    listBranches: async (a: PhoneBranchScope): Promise<PhoneBranchInfo[]> => need().listBranches(a),
    manifest: async (a: PhoneBranchScope & { kind: RecordKind; afterRecId?: string; limit?: number }): Promise<PhoneManifestRow[]> => need().manifest(a),
    push: async (a: PhoneBranchScope & { items: PhonePushItem[] }): Promise<PhonePushResult[]> => need().push(a),
    pricePermsGet: async (a) => {
      const p = need()
      if (typeof p.pricePermsGet !== 'function') throw new PhoneSyncError('server', 'This connection cannot read Price List rights.')
      return p.pricePermsGet(a)
    },
    pull: async (a: PhoneBranchScope & { afterSeq: number; limit?: number }): Promise<PhonePullResult> => need().pull(a),
    subscribeDoorbell(a, onRing, onLive) {
      if (!inner) { onLive?.(false); return () => undefined }
      return inner.subscribeDoorbell(a, onRing, onLive)
    }
  }
}

export interface PhoneSyncRuntime {
  readonly engine: PhoneSyncEngine
  readonly port: LazyPort
  readonly vault: SessionVault
  /** Put a saved login back and start the engine (only does anything in the writer tab). Never throws. */
  init(): Promise<void>
  link(input: LinkInput): Promise<LinkResult>
  /** Phase 269: false until the owner fills the master address into `shared/master/config.ts` (then the one-code screen never shows). */
  masterReady(): boolean
  /** Phase 269: one code -> linked phone (Phase 268 `redeemCode`), then the existing first-sync flow starts. Never throws. */
  redeem(code: string, opts?: { branchName?: string; poPrefix?: string }): Promise<RedeemResult>
  signOut(): Promise<void>
  /** Tell the engine a bill or customer changed. */
  notifySaved(): void
  /** Phase 246: ask the server for this seat's Price List rights and cache the answer. Never throws; a failure keeps the last known rights. */
  refreshPriceRights(): Promise<void>
  /** Phase 255: the automatic refresh (start / each sync cycle / after a refused push). Throttled (60 s; 10 s after a refusal), skipped for seat 1 and an unlinked phone. Never throws. */
  autoRefreshPriceRights(afterRefused: boolean): Promise<void>
}

export interface PhoneSyncRuntimeOptions {
  db: PhoneDb
  appVer: string
  factory?: PhoneSupabaseFactory
  /** Tests inject a ready-made port / engine settings. */
  makeTransport?: (url: string, anonKey: string) => PhoneSharedPort
  engine?: Partial<PhoneSyncEngineDeps>
  vault?: SessionVault
  /** Tests inject a master client built on a fake fetch. Default: the real one from the build constants (not configured while they are empty). */
  master?: PhoneMasterClient
}

export function createPhoneSyncRuntime(o: PhoneSyncRuntimeOptions): PhoneSyncRuntime {
  const { db } = o
  const vault = o.vault ?? createSessionVault(db)
  const port = createLazyPort(o.factory, o.makeTransport)
  const master = o.master ?? createPhoneMasterClient({
    url: MASTER_URL, anon: MASTER_ANON, appVersion: o.appVer,
    fetchImpl: (url, init) => fetch(url, init).then((r) => ({ status: r.status, text: () => r.text() }))
  })
  const profileRefresher = createProfileRefresher({ db, vault, master }) // Phase 272: company default for the phone's share output (throttled, never throws)
  const recredential = createPhoneRecredential({ db, vault, port, master })
  const connection = createPhoneConnect(db, vault, port, recredential)
  // Phase 255: ask the server for this seat's Price List rights. The answer is cached; a failure keeps the last flags AND is recorded (plain words) so the sync status can show it.
  const nowIso = (): string => new Date().toISOString()
  async function refreshRights(): Promise<void> {
    try {
      const c = await connection.connect()
      if (typeof c.port.pricePermsGet !== 'function') { await writeRightsAsk(db, { at: nowIso(), error: 'This connection cannot read Price List rights.' }); return }
      const r = await c.port.pricePermsGet({ license: c.creds.license })
      await writeCachedPerms(db, r, nowIso())
      await writeRightsAsk(db, { at: nowIso(), error: '' })
    } catch (e) {
      const msg = e instanceof PhoneSyncError && e.message !== '' ? e.message : 'The main branch could not be reached.'
      try { await writeRightsAsk(db, { at: nowIso(), error: msg }) } catch { /* the last known rights stay */ }
    }
  }
  async function autoRefreshRights(afterRefused: boolean): Promise<void> {
    try {
      if (!(await getBranchLink(db)).linked) return
      const cached = await readCachedPerms(db)
      if (cached?.seatNo === 1) return // seat 1 always has everything
      if (!autoRefreshDue((await readRightsAsk(db)).at, Date.now(), afterRefused)) return
      await refreshRights()
    } catch { /* best effort */ }
  }
  const engine = createPhoneSyncEngine({
    db, connect: connection.connect, appVer: o.appVer,
    onPushRun: (r) => { void autoRefreshRights((r.refused ?? 0) > 0); void profileRefresher.refresh() },
    onRing: () => { void autoRefreshRights(true) }, // Phase 256: a ring may be a rights change (10 s throttle)
    storage: async () => {
      try {
        const e = await navigator.storage.estimate()
        return { quota: e.quota ?? null, usage: e.usage ?? null }
      } catch { return { quota: null, usage: null } }
    },
    ...o.engine
  })
  // Refresh tokens are single-use: every refreshed pair must reach the vault (also while linking and while the engine runs).
  persistSessionChanges(port, vault)

  return {
    engine, port, vault,
    async init() {
      try {
        const saved = await vault.load()
        if (saved) port.configure(saved.supabaseUrl, saved.anonKey)
        await engine.start()
      } catch { /* a start problem never stops the app: Settings shows the state and the person can sign in again */ }
      void profileRefresher.refresh(true) // Phase 272: on start
    },
    async link(input) {
      const checked = validateLinkInput(input)
      if (checked.ok) port.configure(checked.value.supabaseUrl, checked.value.anonKey) // a bad field returns VALIDATION below, with no network call
      const r = await linkPhoneToOrganisation(db, port, vault, input)
      if (r.ok) {
        connection.reset()
        try { await engine.start() } catch { /* shown by Settings as "first sync needed" or an error on the next try */ }
      }
      return r
    },
    masterReady: () => master.configured(),
    async redeem(code, opts) {
      try {
        const r = await redeemCode({ db, vault, port, master, deviceLabel: () => 'Phone', onBundle: (b) => port.configure(b.supabaseUrl, b.anonKey) }, code, opts)
        if (r.ok) {
          await clearSeatRemoved(db).catch(() => undefined)
          if (r.profile) await storeMasterProfile(db, r.profile).catch(() => undefined) // Phase 272: the bundle already carries the company default
          connection.reset()
          try { await engine.start() } catch { /* shown as "first sync needed" or on the next try */ }
        }
        return r
      } catch {
        return { ok: false, code: 'Q3M99', message: 'Something went wrong. Try again.' }
      }
    },
    async signOut() {
      engine.stop()
      await signOutPhone(vault, port)
      connection.reset()
    },
    notifySaved() { engine.notifySaved() },
    refreshPriceRights: refreshRights,
    autoRefreshPriceRights: autoRefreshRights
  }
}
