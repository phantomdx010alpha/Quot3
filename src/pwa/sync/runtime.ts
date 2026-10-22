import type { PhoneDb } from '../data/db'
import { linkPhoneToOrganisation, validateLinkInput, type LinkInput, type LinkResult } from './branch'
import { createPhoneConnect } from './connect'
import { createPhoneSyncEngine, type PhoneSyncEngine, type PhoneSyncEngineDeps } from './engine'
import { PhoneSyncError } from './errors'
import { createSessionVault, persistSessionChanges, signOutPhone, type SessionVault } from './session'
import { PhoneSupabaseTransport, type PhoneSupabaseFactory } from './supabaseTransport'
import type { PhoneBranchInfo, PhoneBranchScope, PhoneManifestRow, PhonePullResult, PhonePushItem, PhonePushResult, PhoneSession, PhoneSharedPort } from './transport'
import type { RecordKind } from '../../shared/sync/codecV2'

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
  signOut(): Promise<void>
  /** Tell the engine a bill or customer changed. */
  notifySaved(): void
}

export interface PhoneSyncRuntimeOptions {
  db: PhoneDb
  appVer: string
  factory?: PhoneSupabaseFactory
  /** Tests inject a ready-made port / engine settings. */
  makeTransport?: (url: string, anonKey: string) => PhoneSharedPort
  engine?: Partial<PhoneSyncEngineDeps>
  vault?: SessionVault
}

export function createPhoneSyncRuntime(o: PhoneSyncRuntimeOptions): PhoneSyncRuntime {
  const { db } = o
  const vault = o.vault ?? createSessionVault(db)
  const port = createLazyPort(o.factory, o.makeTransport)
  const connection = createPhoneConnect(db, vault, port)
  const engine = createPhoneSyncEngine({
    db, connect: connection.connect, appVer: o.appVer,
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
    async signOut() {
      engine.stop()
      await signOutPhone(vault, port)
      connection.reset()
    },
    notifySaved() { engine.notifySaved() }
  }
}
