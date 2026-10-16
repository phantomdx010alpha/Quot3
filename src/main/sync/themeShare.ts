import type { SyncStateRepo } from '../db/syncStateRepo'
import type { Logger } from '../logger'
import { AppError } from '../ipc/envelope'
import type { ThemeService } from '../services/themeService'
import {
  THEME_PULL_PAGE, THEME_PUSH_BATCH, THEME_SHARE_KEY, THEME_STATE_KEYS, chunk, decideIncoming, planPush, themeContentHash, tooNewNotice,
  type IncomingTheme, type ThemeAside, type ThemeRemoved, type ThemeShareLast, type ThemeShareRunResult, type ThemeShareState, type ThemeShareStatus
} from '../../shared/theme/themeShare'
import { SharedTransportError, type SharedBranch, type SharedStoreTransport, type ThemeShareCalls } from './sharedTransport'
import { ensureClockOffset } from './sharedState'

/**
 * Phase 171 - theme sharing client (Milestone 16). Rides the existing shared-notebook connection (`sharedActivation.connect()`), the same
 * Supabase transport and the same doorbell kick as the bill workers: no second channel. Server rules are `supabase/sql/17_themes.sql`.
 *
 *  - Switch `themes.share` OFF (default) => nothing is sent, nothing is pulled, nothing is written.
 *  - Push: custom theme files whose content changed since they were last exchanged (never built-ins). Edit time = file mtime, skew-corrected.
 *  - Pull: by `server_seq` cursor. A received theme is validated like a file in the folder (`decideIncoming` -> `validateTheme`) and written to
 *    the themes folder only when valid; bad / too-new / oversize ones are set aside and listed. Newest `edited_at` wins; a local file that a
 *    received theme replaces is moved to `themes/history/`, never deleted. A cursor never stops for a bad theme.
 *  - Removing a shared theme is local to this PC (the file goes to `themes/history/`); a NEWER version from another PC brings it back.
 *  - Logs and status carry ids and counts only, never theme contents.
 */

export interface ThemeShareDeps {
  themes: Pick<ThemeService, 'localCustom' | 'writeShared' | 'removeLocal'>
  sync: Pick<SyncStateRepo, 'get' | 'set' | 'remove' | 'keys'>
  settings: { get(key: string): unknown; set(key: string, value: unknown): void }
  connect: () => Promise<{ transport: SharedStoreTransport; creds: { license: string; branchId: string } }>
  isSignedIn: () => boolean
  appVer: string
  log: Pick<Logger, 'info' | 'warn'>
  /** A theme file was written or removed here: the renderer reloads its list. */
  onChanged?: () => void
}
export interface ThemeShareOptions {
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  pollMs?: number
  firstMs?: number
}

export interface ThemeShareService {
  status(): ThemeShareStatus
  setEnabled(enabled: boolean): Promise<ThemeShareStatus>
  /** One push + pull now (single flight). Returns zeros when the switch is off or this PC is not signed in. */
  runNow(): Promise<ThemeShareRunResult>
  /** Ask for a run soon (doorbell / poll); never throws. */
  kick(): void
  removeShared(id: string): ThemeShareStatus
  start(): void
  stop(): void
}

export const THEME_SHARE_POLL_MS = 60_000
const MAX_PULL_PAGES = 20
const RETRY_WITH_PAYLOAD = new Set(['too_new', 'io'])

const parse = <T,>(raw: string | undefined): T | null => {
  if (raw === undefined) return null
  try { const v = JSON.parse(raw) as unknown; return typeof v === 'object' && v !== null ? (v as T) : null } catch { return null }
}
const hasThemeCalls = (t: unknown): t is SharedStoreTransport & ThemeShareCalls =>
  typeof t === 'object' && t !== null && typeof (t as ThemeShareCalls).themePush === 'function' && typeof (t as ThemeShareCalls).themePull === 'function'

export function createThemeShare(deps: ThemeShareDeps, opts: ThemeShareOptions = {}): ThemeShareService {
  const { sync, log } = deps
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let kickTimer: unknown = null
  let started = false
  let current: Promise<ThemeShareRunResult> | null = null
  let again = false

  const enabled = (): boolean => deps.settings.get(THEME_SHARE_KEY) === true
  const zero = (): ThemeShareRunResult => ({ sent: 0, received: 0, setAside: 0, skipped: 0 })
  const stateKey = (id: string): string => THEME_STATE_KEYS.state + id
  const asideKey = (id: string): string => THEME_STATE_KEYS.aside + id
  const removedKey = (id: string): string => THEME_STATE_KEYS.removed + id
  const idOf = (key: string, prefix: string): string => key.slice(prefix.length)
  const getState = (id: string): ThemeShareState | null => parse<ThemeShareState>(sync.get(stateKey(id)))
  const putState = (id: string, s: ThemeShareState): void => sync.set(stateKey(id), JSON.stringify(s))
  const readCursor = (): number => { const n = Number(sync.get(THEME_STATE_KEYS.cursor)); return Number.isInteger(n) && n > 0 ? n : 0 }
  const lastRun = (): ThemeShareLast | null => parse<ThemeShareLast>(sync.get(THEME_STATE_KEYS.last))

  function status(): ThemeShareStatus {
    const local = new Map(deps.themes.localCustom().map((l) => [l.id, l]))
    const shared = sync.keys(THEME_STATE_KEYS.state).flatMap((k) => {
      const id = idOf(k, THEME_STATE_KEYS.state)
      const st = getState(id)
      const l = local.get(id)
      return st && l ? [{ id, name: l.name, origin: st.origin, editedAt: st.editedAt }] : []
    }).sort((a, b) => a.name.localeCompare(b.name))
    const asideRows = sync.keys(THEME_STATE_KEYS.aside).flatMap((k) => {
      const a = parse<ThemeAside>(sync.get(k))
      return a ? [{ id: idOf(k, THEME_STATE_KEYS.aside), reason: a.reason, message: a.message, origin: a.origin }] : []
    }).sort((a, b) => a.id.localeCompare(b.id))
    const tooNew = asideRows.filter((a) => a.reason === 'too_new').length
    return { enabled: enabled(), available: deps.isSignedIn(), shared, aside: asideRows, tooNew, notice: tooNewNotice(tooNew), last: lastRun(), running: current !== null }
  }

  async function run(): Promise<ThemeShareRunResult> {
    const r = zero()
    const at = now().toISOString()
    let error: string | null = null
    try {
      const { transport, creds } = await deps.connect()
      if (!hasThemeCalls(transport)) throw new SharedTransportError('server')
      const scope = { license: creds.license, branchId: creds.branchId }
      const offset = await ensureClockOffset(sync, transport, () => now().getTime())

      // Branch names for the "origin" column: asked once per run, and only when a received theme names a branch.
      let names: Map<string, string> | null = null
      const originOf = async (from: string | null): Promise<string | null> => {
        if (!from) return null
        if (from === creds.branchId) return 'This PC'
        if (!names) {
          names = new Map()
          try { for (const b of await transport.listBranches(scope) as SharedBranch[]) names.set(b.branchId, b.name) } catch { /* the origin just stays unknown */ }
        }
        return names.get(from) ?? null
      }

      const localInfo = (id: string): { hash: string; editedAtMs: number } | null => {
        const l = deps.themes.localCustom().find((c) => c.id === id)
        if (!l) return null
        const hash = themeContentHash(l.json)
        const st = getState(id)
        // An unchanged file keeps the edit time it was exchanged with; a changed one counts from its modified time, skew-corrected.
        return { hash, editedAtMs: st && st.hash === hash ? Date.parse(st.editedAt) : l.mtimeMs + (offset ?? 0) }
      }

      const apply = (item: IncomingTheme): void => {
        const st = getState(item.themeId)
        const d = decideIncoming({ item, state: st, removed: parse<ThemeRemoved>(sync.get(removedKey(item.themeId))), local: localInfo(item.themeId) })
        if (d.action === 'skip') {
          r.skipped++
          if (d.why === 'same' && (!st || st.version < item.version)) putState(item.themeId, { hash: item.payloadHash, version: item.version, editedAt: item.editedAt, serverSeq: st?.serverSeq ?? 0, origin: item.origin ?? st?.origin ?? null })
          return
        }
        const keepAside = (reason: ThemeAside['reason'], message: string): void => {
          const a: ThemeAside = { reason, message, version: item.version, minReaderVer: item.minReaderVer, editedAt: item.editedAt, origin: item.origin, payloadHash: item.payloadHash, ...(RETRY_WITH_PAYLOAD.has(reason) ? { payload: item.payload } : {}) }
          sync.set(asideKey(item.themeId), JSON.stringify(a))
          r.setAside++
        }
        if (d.action === 'aside') { keepAside(d.reason, d.message); return }
        try {
          deps.themes.writeShared(item.themeId, item.payload)
        } catch {
          keepAside('io', 'Could not be saved on this PC; it will be tried again.')
          return
        }
        putState(item.themeId, { hash: themeContentHash(item.payload), version: item.version, editedAt: item.editedAt, serverSeq: st?.serverSeq ?? 0, origin: item.origin })
        sync.remove([asideKey(item.themeId), removedKey(item.themeId)])
        r.received++
      }

      // 1. earlier set-aside themes that can be tried again (a newer app, or a folder that was not writable)
      for (const k of sync.keys(THEME_STATE_KEYS.aside)) {
        const a = parse<ThemeAside>(sync.get(k))
        if (!a || !a.payload || !RETRY_WITH_PAYLOAD.has(a.reason)) continue
        sync.remove([k])
        const before = r.setAside
        apply({ themeId: idOf(k, THEME_STATE_KEYS.aside), version: a.version, payload: a.payload, payloadHash: a.payloadHash, minReaderVer: a.minReaderVer, editedAt: a.editedAt, origin: a.origin })
        if (r.setAside > before) r.setAside-- // the same theme set aside again is not a new one
      }

      // 2. pull (by cursor; the cursor moves past every theme, good or bad)
      let cursor = readCursor()
      for (let page = 0; page < MAX_PULL_PAGES; page++) {
        const res = await transport.themePull({ ...scope, afterSeq: cursor, limit: THEME_PULL_PAGE })
        for (const t of res.items) {
          apply({ themeId: t.themeId, version: t.version, payload: t.payload, payloadHash: t.payloadHash, minReaderVer: t.minReaderVer, editedAt: t.editedAt, origin: await originOf(t.fromBranch) })
          cursor = Math.max(cursor, t.serverSeq)
        }
        sync.set(THEME_STATE_KEYS.cursor, String(cursor))
        if (!res.hasMore || res.items.length === 0) break
      }

      // 3. push what changed here
      const states = new Map<string, ThemeShareState>()
      const locals = deps.themes.localCustom()
      for (const l of locals) { const s = getState(l.id); if (s) states.set(l.id, s) }
      const plan = planPush(locals.map((l) => ({ id: l.id, json: l.json, hash: themeContentHash(l.json), editedAtMs: l.mtimeMs })), states, offset)
      if (plan.tooBig.length > 0) log.warn('Theme sharing: themes larger than the limit were not sent', { count: plan.tooBig.length })
      for (const batch of chunk(plan.items, THEME_PUSH_BATCH)) {
        const results = await transport.themePush({ ...scope, items: batch.map((i) => ({ ...i, appVer: deps.appVer })) })
        results.forEach((res, i) => {
          const item = batch[i]
          if (!item) return
          putState(item.themeId, { hash: item.payloadHash, version: res.version, editedAt: item.editedAt, serverSeq: res.serverSeq, origin: 'This PC' })
          sync.remove([removedKey(item.themeId)]) // re-adding a removed theme by hand is a deliberate local edit
          r.sent++
        })
      }
      if (r.received > 0) { try { deps.onChanged?.() } catch { /* a listener never breaks a run */ } }
    } catch (e) {
      error = e instanceof SharedTransportError ? e.message : e instanceof AppError ? e.message : 'Themes could not be synced.'
      log.warn('Theme sharing: a run did not finish', { kind: e instanceof SharedTransportError ? e.kind : 'other' })
    }
    sync.set(THEME_STATE_KEYS.last, JSON.stringify({ at, sent: r.sent, received: r.received, setAside: r.setAside, error } satisfies ThemeShareLast))
    if (r.sent + r.received + r.setAside > 0) log.info('Theme sharing: run finished', { sent: r.sent, received: r.received, setAside: r.setAside })
    return r
  }

  function runNow(): Promise<ThemeShareRunResult> {
    if (!enabled() || !deps.isSignedIn()) return Promise.resolve(zero())
    if (current) { again = true; return current }
    const p = run().finally(() => { current = null; if (again) { again = false; scheduleKick() } })
    current = p
    return p
  }

  function scheduleKick(): void {
    if (kickTimer !== null || !enabled()) return
    kickTimer = setTimer(() => { kickTimer = null; void runNow() }, 500)
  }

  function schedule(ms: number): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runNow().finally(() => schedule(opts.pollMs ?? THEME_SHARE_POLL_MS)) }, ms)
  }

  return {
    status,
    async setEnabled(on) {
      deps.settings.set(THEME_SHARE_KEY, on === true)
      if (on) await runNow()
      return status()
    },
    runNow,
    kick: scheduleKick,
    removeShared(id) {
      const removed = deps.themes.removeLocal(id)
      const a = parse<ThemeAside>(sync.get(asideKey(id)))
      if (!removed && !a) throw new AppError('NOT_FOUND', 'Shared theme not found')
      const st = getState(id)
      sync.set(removedKey(id), JSON.stringify({ version: Math.max(st?.version ?? 0, a?.version ?? 0), hash: st?.hash ?? a?.payloadHash ?? '' } satisfies ThemeRemoved))
      sync.remove([stateKey(id), asideKey(id)])
      try { deps.onChanged?.() } catch { /* ignore */ }
      return status()
    },
    start() { if (started) return; started = true; schedule(opts.firstMs ?? 20_000) },
    stop() { started = false; if (timer !== null) clearTimer(timer); if (kickTimer !== null) clearTimer(kickTimer); timer = kickTimer = null }
  }
}
