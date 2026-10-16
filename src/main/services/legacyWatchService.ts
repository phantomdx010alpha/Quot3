import { watch as fsWatch } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyCounts, readLegacyWatchSettings, type LegacyWatchCounts, type LegacyWatchSettings, type LegacyWatchState, type LegacyWatchStatus } from '../../shared/legacyWatch/watchConfig'
import { orderOldestFirst } from '../../shared/legacyWatch/order'
import type { LegacyWatchRepo } from '../db/legacyWatchRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import type { LegacyWatchApply, WatchFile, WatchResultKind } from './legacyWatchApply'

/**
 * Phase 160 - the legacy folder scanner (MILESTONE15_DESIGN 3.6). Finds new / changed `*.json` files and hands them, oldest
 * mtime first, to the apply engine (Phase 159), which does every write. This service never touches the database itself.
 *
 *   - `fs.watch` for speed (debounced) AND a timed rescan (default 2 min [A]) AND `scan()` for wake: `fs.watch` is unreliable on
 *     shared / synced Windows folders, so the timer is the safety net.
 *   - A file is read only when its (size, mtime) differs from the state table (`legacy_watch_files`); unchanged files are never re-read.
 *   - A file still changing (mtime younger than STABLE_MS, or size / mtime moved while reading) or not parseable yet is skipped and
 *     retried on the next scan; a file that stays unparseable for GIVE_UP_MS is remembered (not re-read) until it changes.
 *   - A missing / unreachable folder is a plain status, never a throw. Pause stops the timer, the watcher and automatic scans.
 *   - Settings are re-read on every `status()` / scan, so a change made in Settings takes effect without a restart.
 * Logs carry counts only, never file names, party names or bill content (the folder is private customer data).
 */
export const STABLE_MS = 2_000
export const GIVE_UP_MS = 60_000
export const DEBOUNCE_MS = 1_500
export const START_DELAY_MS = 5_000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
/** One apply batch = one `pre-import` backup; a first scan of a big folder is a handful of batches [A]. */
export const MAX_BATCH_FILES = 500

export interface WatchFs {
  readdir(dir: string): Promise<string[]>
  stat(path: string): Promise<{ size: number; mtimeMs: number; isFile: boolean }>
  readText(path: string): Promise<string>
  watch(dir: string, onEvent: () => void, onError: () => void): { close(): void }
}

export function createNodeWatchFs(): WatchFs {
  return {
    readdir: (dir) => readdir(dir),
    stat: async (p) => { const s = await stat(p); return { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile() } },
    readText: (p) => readFile(p, 'utf8'),
    watch: (dir, onEvent, onError) => {
      const w = fsWatch(dir, { persistent: false }, () => onEvent())
      w.on('error', () => onError())
      return { close: () => w.close() }
    }
  }
}

export interface LegacyWatchService {
  /** Read the settings and begin (first scan after a short delay). Safe to call when watching is off. */
  start(): void
  /** Stop timers and the watcher (app quit). */
  stop(): void
  /** Current status; re-reads the settings first so Settings changes apply. */
  status(): LegacyWatchStatus
  /** Automatic scan entry (also used on wake / unlock): does nothing while off or paused. Resolves with the status after the scan. */
  scan(): Promise<LegacyWatchStatus>
  /** The owner's "Scan now": runs even while paused, but needs watching on and a folder chosen (VALIDATION otherwise). */
  scanNow(): Promise<LegacyWatchStatus>
  /** Pause / resume watching (kept in memory only [A]: a restart watches again if it is enabled). */
  setPaused(paused: boolean): LegacyWatchStatus
}

export interface LegacyWatchServiceDeps {
  apply: Pick<LegacyWatchApply, 'applyBatch'>
  repo: Pick<LegacyWatchRepo, 'getFile'>
  settings: { getAll(): Record<string, unknown> }
  /** Whether the normal sync is running (shown as "sync is off" when false; the import works either way). */
  syncOn: () => boolean
  fs?: WatchFs
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => number
}

const lastSegment = (p: string): string => p.split(/[\\/]+/).filter((x) => x !== '').pop() ?? ''
const COUNTED: ReadonlyArray<WatchResultKind> = ['imported', 'updated', 'duplicate', 'older', 'review', 'error']

export function createLegacyWatchService(deps: LegacyWatchServiceDeps): LegacyWatchService {
  const fs = deps.fs ?? createNodeWatchFs()
  const now = deps.now ?? ((): number => Date.now())
  const log = deps.log

  let cfg: LegacyWatchSettings = { enabled: false, folder: '', intervalSeconds: 120 }
  let paused = false
  let scanning = false
  let stopped = false
  let folderMissing = false
  let problem: string | null = null
  let lastScanAt: string | null = null
  let filesSeen = 0
  let waiting = 0
  let lastCounts: LegacyWatchCounts = emptyCounts()
  const totals: LegacyWatchCounts = emptyCounts()
  let watcher: { close(): void } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let kickTimer: ReturnType<typeof setTimeout> | null = null
  let current: Promise<void> | null = null
  let rescanQueued = false
  /** True while the owner's "Scan now" runs (it ignores Pause). */
  let manualRun = false
  /** Files that stayed unparseable (or too big): name -> the (size, mtime) not to read again until it changes. */
  const bad = new Map<string, { size: number; mtimeMs: number }>()

  const configured = (): boolean => cfg.enabled && cfg.folder !== ''
  const active = (): boolean => !stopped && configured() && !paused

  const closeWatcher = (): void => { try { watcher?.close() } catch { /* already closed */ } watcher = null }
  const clearTimers = (): void => {
    if (timer) clearTimeout(timer)
    if (kickTimer) clearTimeout(kickTimer)
    timer = null
    kickTimer = null
  }

  function queueScan(ms: number): void {
    if (kickTimer) clearTimeout(kickTimer)
    kickTimer = setTimeout(() => { kickTimer = null; void scan() }, ms)
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (!active()) return
    timer = setTimeout(() => { timer = null; void scan().catch(() => undefined) }, cfg.intervalSeconds * 1000)
  }

  function ensureWatcher(): void {
    if (watcher || !active()) return
    try {
      watcher = fs.watch(cfg.folder, () => { if (active()) queueScan(DEBOUNCE_MS) }, () => { closeWatcher() })
    } catch {
      watcher = null // the timed rescan still runs and tries again
    }
  }

  /** Re-read the settings; react to a change of folder / on-off / interval. */
  function applySettings(first = false): void {
    const next = readLegacyWatchSettings(deps.settings.getAll())
    const was = cfg
    cfg = next
    if (!first && was.enabled === next.enabled && was.folder === next.folder && was.intervalSeconds === next.intervalSeconds) return
    if (was.enabled !== next.enabled || was.folder !== next.folder) {
      closeWatcher()
      bad.clear()
      folderMissing = false
      problem = null
      if (!configured()) waiting = 0
    }
    schedule()
    if (active()) queueScan(first ? START_DELAY_MS : DEBOUNCE_MS)
  }

  async function doScan(): Promise<void> {
    const folder = cfg.folder
    let names: string[]
    try {
      names = await fs.readdir(folder)
    } catch {
      folderMissing = true
      closeWatcher()
      filesSeen = 0
      waiting = 0
      lastScanAt = new Date(now()).toISOString()
      return
    }
    folderMissing = false
    ensureWatcher()

    const jsons = names.filter((n) => /\.json$/i.test(n) && !n.startsWith('~') && !n.startsWith('.'))
    let seen = 0
    const counts = emptyCounts()
    const ready: WatchFile[] = []
    let wait = 0

    for (const name of jsons) {
      if (stopped) return
      const path = join(folder, name)
      let st: { size: number; mtimeMs: number; isFile: boolean }
      try { st = await fs.stat(path) } catch { wait++; continue }
      if (!st.isFile) continue
      seen++
      const prev = deps.repo.getFile(name)
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.lastResult !== 'error') continue // already handled: never re-read
      const memo = bad.get(name)
      if (memo && memo.size === st.size && memo.mtimeMs === st.mtimeMs) continue
      if (st.size > MAX_FILE_BYTES) { bad.set(name, { size: st.size, mtimeMs: st.mtimeMs }); counts.error++; continue }
      const age = now() - st.mtimeMs
      if (age < STABLE_MS) { wait++; continue } // still being written
      let text: string
      try { text = await fs.readText(path) } catch { wait++; continue }
      let st2: { size: number; mtimeMs: number } | null = null
      try { st2 = await fs.stat(path) } catch { st2 = null }
      if (!st2 || st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) { wait++; continue } // changed while reading
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      try { JSON.parse(text) } catch {
        if (age >= GIVE_UP_MS) { bad.set(name, { size: st.size, mtimeMs: st.mtimeMs }); counts.error++ } else wait++
        continue
      }
      ready.push({ name, text, size: st.size, mtimeMs: st.mtimeMs })
    }

    filesSeen = seen
    const ordered = orderOldestFirst(ready, (f) => ({ name: f.name, mtimeMs: f.mtimeMs }))
    try {
      for (let i = 0; i < ordered.length && !stopped; i += MAX_BATCH_FILES) {
        const out = await deps.apply.applyBatch(ordered.slice(i, i + MAX_BATCH_FILES))
        for (const k of COUNTED) counts[k as keyof LegacyWatchCounts] += out.counts[k] ?? 0
        if (!active() && !manualRun) break // paused / turned off between batches
      }
      problem = null
    } catch (err) {
      problem = 'The last scan could not finish. Quot3 will try again.'
      log?.error('Legacy watch scan failed', { err })
    }

    waiting = wait
    lastCounts = counts
    for (const k of Object.keys(counts) as Array<keyof LegacyWatchCounts>) totals[k] += counts[k]
    lastScanAt = new Date(now()).toISOString()
    if (ordered.length > 0 || counts.error > 0) log?.info('Legacy watch scan', { files: seen, ...counts, waiting: wait })
  }

  function scan(): Promise<LegacyWatchStatus> {
    applySettings()
    if (!active()) return Promise.resolve(snapshot())
    return run()
  }

  function run(): Promise<LegacyWatchStatus> {
    if (current) { rescanQueued = true; return current.then(snapshot) }
    scanning = true
    current = (async () => {
      try {
        do {
          rescanQueued = false
          await doScan()
        } while (rescanQueued && (active() || manualRun))
      } catch (err) {
        problem = 'The last scan could not finish. Quot3 will try again.'
        log?.error('Legacy watch scan failed', { err })
      } finally {
        scanning = false
        current = null
        schedule()
      }
    })()
    return current.then(snapshot)
  }

  function snapshot(): LegacyWatchStatus {
    const state: LegacyWatchState = !configured() ? 'off' : scanning ? 'scanning' : paused ? 'paused' : folderMissing ? 'folder_missing' : 'watching'
    return {
      state,
      enabled: cfg.enabled,
      paused,
      folderLabel: lastSegment(cfg.folder),
      intervalSeconds: cfg.intervalSeconds,
      lastScanAt,
      filesSeen,
      lastCounts: { ...lastCounts },
      totals: { ...totals },
      waiting,
      syncOn: deps.syncOn(),
      message: folderMissing && configured()
        ? 'The legacy folder cannot be reached. Check that it exists and that the network drive is connected. Quot3 keeps trying.'
        : configured() ? problem : null
    }
  }

  return {
    start() { stopped = false; applySettings(true) },
    stop() { stopped = true; clearTimers(); closeWatcher() },
    status() { applySettings(); return snapshot() },
    scan,
    async scanNow() {
      applySettings()
      if (!configured()) throw new AppError('VALIDATION', 'Turn watching on and choose the legacy folder first.')
      manualRun = true
      try { return await run() } finally { manualRun = false }
    },
    setPaused(p) {
      applySettings()
      paused = p
      if (p) { closeWatcher(); if (kickTimer) clearTimeout(kickTimer); kickTimer = null; schedule() } else if (active()) { schedule(); queueScan(DEBOUNCE_MS) }
      return snapshot()
    }
  }
}
