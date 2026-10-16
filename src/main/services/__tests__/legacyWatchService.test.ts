import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createLegacyImportRepo } from '../../db/legacyImportRepo'
import { createLegacyWatchRepo } from '../../db/legacyWatchRepo'
import { createLegacyWatchApply, type BatchOutcome, type WatchFile } from '../legacyWatchApply'
import { createLegacyWatchService, createNodeWatchFs, DEBOUNCE_MS, GIVE_UP_MS, START_DELAY_MS, type WatchFs } from '../legacyWatchService'
import { LEGACY_WATCH_KEYS } from '../../../shared/legacyWatch/watchConfig'

// SYNTHETIC data only: temp folders / temp databases, never the owner's legacy folder.
const dbs: TestDb[] = []
const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  dbs.splice(0).forEach((t) => t.cleanup())
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

const item = (name: string, qty: string, rate: string): Record<string, unknown> => ({ name, qty, rate, amt: String(Number(qty) * Number(rate)) })
const legacy = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  bill_no: 'BR1_100', date: '08-10-2026', party: 'ACME TRADERS', phone: '99450', transport: 'VRL', gst: '', format_mode: 'manual', extra_headers: [],
  items: [item('Tomato', '10', '20'), item('Onion', '5', '30')], total: 500, ...o
})
const ago = (ms: number): Date => new Date(Date.now() - ms)

const emptyOutcome = (): BatchOutcome => ({ outcomes: [], counts: { imported: 0, updated: 0, duplicate: 0, older: 0, review: 0, already_imported: 0, error: 0, unchanged: 0 }, backupFile: null, batchId: null })

function settingsBox(over: Record<string, unknown> = {}) {
  const v: Record<string, unknown> = { [LEGACY_WATCH_KEYS.enabled]: true, [LEGACY_WATCH_KEYS.folder]: '', [LEGACY_WATCH_KEYS.intervalSeconds]: 120, ...over }
  return { v, getAll: () => ({ ...v }) }
}

/** A stub engine that records the batches it was given. */
function stubApply(fail = false) {
  const batches: WatchFile[][] = []
  return {
    batches,
    applyBatch: async (files: readonly WatchFile[]): Promise<BatchOutcome> => {
      if (fail) throw new Error('boom')
      batches.push([...files])
      const o = emptyOutcome()
      o.counts.imported = files.length
      return o
    }
  }
}

/** A tiny in-memory folder so fake timers work (real fs promises do not advance with them). */
function memFs() {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  let exists = true
  let onEvent: (() => void) | null = null
  let reads = 0
  const fs: WatchFs = {
    readdir: async () => { if (!exists) throw new Error('ENOENT'); return [...files.keys()] },
    stat: async (p) => { const f = files.get(p.split(/[\\/]/).pop()!); if (!f) throw new Error('ENOENT'); return { size: f.text.length, mtimeMs: f.mtimeMs, isFile: true } },
    readText: async (p) => { reads++; return files.get(p.split(/[\\/]/).pop()!)!.text },
    watch: (_d, cb) => { onEvent = cb; return { close: () => { onEvent = null } } }
  }
  return { fs, files, setExists: (b: boolean) => { exists = b }, fire: () => onEvent?.(), watching: () => onEvent !== null, reads: () => reads }
}

describe('legacyWatchService - off by default and settings', () => {
  it('is off with the defaults: no scan, scanNow is refused', async () => {
    const apply = stubApply()
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings: { getAll: () => ({}) }, syncOn: () => false, fs: memFs().fs })
    expect(svc.status()).toMatchObject({ state: 'off', enabled: false, folderLabel: '', syncOn: false, message: null })
    await svc.scan()
    expect(apply.batches).toHaveLength(0)
    await expect(svc.scanNow()).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('shows only the last segment of the folder and the sync state', () => {
    const s = settingsBox({ [LEGACY_WATCH_KEYS.folder]: 'C:\\Shared\\LegacyBills' })
    const svc = createLegacyWatchService({ apply: stubApply(), repo: { getFile: () => undefined }, settings: s, syncOn: () => true, fs: memFs().fs })
    const st = svc.status()
    expect(st.folderLabel).toBe('LegacyBills')
    expect(st.syncOn).toBe(true)
    expect(JSON.stringify(st)).not.toContain('Shared')
    svc.stop()
  })
})

describe('legacyWatchService - real temp folder', () => {
  let folder: string
  beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'q3watch-')); dirs.push(folder) })
  const put = (name: string, body: Record<string, unknown> | string, ageMs = 60_000): void => {
    writeFileSync(join(folder, name), typeof body === 'string' ? body : JSON.stringify(body))
    utimesSync(join(folder, name), ago(ageMs), ago(ageMs))
  }
  const mkReal = (over: Record<string, unknown> = {}) => {
    const t = openTestDb()
    dbs.push(t)
    const sqlite = t.handle.sqlite
    const repo = createLegacyWatchRepo(sqlite)
    const apply = createLegacyWatchApply(
      { sqlite, repo, importRepo: createLegacyImportRepo(sqlite), bills: createBillRepo(sqlite), backup: { create: async (kind) => ({ file: 'pre-import-1.db', kind, createdAt: new Date().toISOString(), sizeBytes: 1, billCount: 0, readable: true }) } }
    )
    const real = createNodeWatchFs()
    const reads: string[] = []
    const fs: WatchFs = { ...real, readText: async (p) => { reads.push(p); return real.readText(p) }, watch: () => ({ close: () => undefined }) }
    const settings = settingsBox({ [LEGACY_WATCH_KEYS.folder]: folder, ...over })
    const svc = createLegacyWatchService({ apply, repo, settings, syncOn: () => false, fs })
    const bills = (): number => (sqlite.prepare('SELECT count(*) AS c FROM bills').get() as { c: number }).c
    return { svc, reads, bills, settings }
  }

  it('imports a new file through the engine, then never re-reads it (state table)', async () => {
    const m = mkReal()
    put('a.json', legacy())
    const st = await m.svc.scanNow()
    expect(st.lastCounts.imported).toBe(1)
    expect(st.filesSeen).toBe(1)
    expect(st.lastScanAt).not.toBeNull()
    expect(m.bills()).toBe(1)
    expect(m.reads).toHaveLength(1)
    const again = await m.svc.scanNow()
    expect(again.lastCounts.imported).toBe(0)
    expect(m.reads).toHaveLength(1) // unchanged file: not read again
    expect(m.bills()).toBe(1)
    expect(again.totals.imported).toBe(1)
  })

  it('skips a file that is still being written, and takes it once it is stable', async () => {
    const apply = stubApply()
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings: settingsBox({ [LEGACY_WATCH_KEYS.folder]: folder }), syncOn: () => false, fs: { ...createNodeWatchFs(), watch: () => ({ close: () => undefined }) } })
    put('fresh.json', legacy(), 0)
    let st = await svc.scanNow()
    expect(st.waiting).toBe(1)
    expect(apply.batches).toHaveLength(0)
    put('fresh.json', legacy(), 60_000)
    st = await svc.scanNow()
    expect(st.waiting).toBe(0)
    expect(apply.batches).toHaveLength(1)
  })

  it('retries a half-written (unparseable) file, gives up quietly after a minute, and picks it up when it is fixed', async () => {
    const apply = stubApply()
    const real = createNodeWatchFs()
    let reads = 0
    const fs: WatchFs = { ...real, readText: async (p) => { reads++; return real.readText(p) }, watch: () => ({ close: () => undefined }) }
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings: settingsBox({ [LEGACY_WATCH_KEYS.folder]: folder }), syncOn: () => false, fs })
    put('half.json', '{"bill_no": "BR1_1", "items": [', 10_000)
    let st = await svc.scanNow()
    expect(st.waiting).toBe(1)
    expect(apply.batches).toHaveLength(0)
    put('half.json', '{"bill_no": "BR1_1", "items": [', GIVE_UP_MS + 5_000)
    st = await svc.scanNow()
    expect(st.waiting).toBe(0)
    expect(st.lastCounts.error).toBe(1)
    const readsAfterGiveUp = reads
    await svc.scanNow()
    expect(reads).toBe(readsAfterGiveUp) // remembered: not re-read while unchanged
    put('half.json', legacy(), 60_000)
    st = await svc.scanNow()
    expect(apply.batches).toHaveLength(1)
  })

  it('ignores non-json files and sub-folders, and hands files to the engine oldest first regardless of name', async () => {
    const apply = stubApply()
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings: settingsBox({ [LEGACY_WATCH_KEYS.folder]: folder }), syncOn: () => false, fs: { ...createNodeWatchFs(), watch: () => ({ close: () => undefined }) } })
    put('a.json', legacy(), 10_000 + 30_000)
    put('b.json', legacy({ bill_no: 'BR1_101' }), 300_000)
    put('c.JSON', legacy({ bill_no: 'BR1_102' }), 100_000)
    put('notes.txt', 'hello', 100_000)
    put('~lock.json', legacy(), 100_000)
    mkdirSync(join(folder, 'sub.json'))
    const st = await svc.scanNow()
    expect(st.filesSeen).toBe(3)
    expect(apply.batches[0]!.map((f) => f.name)).toEqual(['b.json', 'c.JSON', 'a.json'])
  })

  it('a missing folder is a plain status, never a throw, and recovers when the folder appears', async () => {
    const gone = join(folder, 'not-there')
    const apply = stubApply()
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings: settingsBox({ [LEGACY_WATCH_KEYS.folder]: gone }), syncOn: () => false, fs: { ...createNodeWatchFs(), watch: () => ({ close: () => undefined }) } })
    const st = await svc.scanNow()
    expect(st.state).toBe('folder_missing')
    expect(st.message).toMatch(/cannot be reached/)
    expect(JSON.stringify(st)).not.toContain(folder)
    mkdirSync(gone)
    writeFileSync(join(gone, 'x.json'), JSON.stringify(legacy()))
    utimesSync(join(gone, 'x.json'), ago(60_000), ago(60_000))
    const ok = await svc.scanNow()
    expect(ok.state).toBe('watching')
    expect(ok.message).toBeNull()
    expect(apply.batches).toHaveLength(1)
  })
})

describe('legacyWatchService - pause, errors, timers (in-memory folder)', () => {
  beforeEach(() => { vi.useFakeTimers() })

  const mk = (over: Record<string, unknown> = {}, applyOver?: ReturnType<typeof stubApply>) => {
    const mem = memFs()
    const apply = applyOver ?? stubApply()
    const settings = settingsBox({ [LEGACY_WATCH_KEYS.folder]: '/legacy', ...over })
    const svc = createLegacyWatchService({ apply, repo: { getFile: () => undefined }, settings, syncOn: () => false, fs: mem.fs })
    const add = (name: string, ageMs = 120_000): void => { mem.files.set(name, { text: JSON.stringify(legacy({ bill_no: name })), mtimeMs: Date.now() - ageMs }) }
    return { svc, mem, apply, settings, add }
  }

  it('first scan after the start delay, then a timed rescan every interval; stop ends both', async () => {
    const m = mk({ [LEGACY_WATCH_KEYS.intervalSeconds]: 60 })
    m.add('a.json')
    m.svc.start()
    expect(m.apply.batches).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 10)
    expect(m.apply.batches).toHaveLength(1)
    m.add('b.json')
    await vi.advanceTimersByTimeAsync(60_000 + 10)
    expect(m.apply.batches).toHaveLength(2)
    expect(m.apply.batches[1]!.map((f) => f.name)).toEqual(['a.json', 'b.json']) // repo stub reports nothing as handled
    m.svc.stop()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(m.apply.batches).toHaveLength(2)
  })

  it('a folder change event triggers ONE debounced scan', async () => {
    const m = mk()
    m.add('a.json')
    m.svc.start()
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 10)
    expect(m.mem.watching()).toBe(true)
    const before = m.apply.batches.length
    m.mem.fire(); m.mem.fire(); m.mem.fire()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100)
    expect(m.apply.batches.length).toBe(before)
    await vi.advanceTimersByTimeAsync(200)
    expect(m.apply.batches.length).toBe(before + 1)
    m.svc.stop()
  })

  it('pause stops automatic scans and the watcher; Scan now still works; resume scans again', async () => {
    const m = mk()
    m.add('a.json')
    m.svc.start()
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 10)
    const n = m.apply.batches.length
    expect(m.svc.setPaused(true)).toMatchObject({ state: 'paused', paused: true })
    expect(m.mem.watching()).toBe(false)
    await vi.advanceTimersByTimeAsync(600_000)
    await m.svc.scan()
    expect(m.apply.batches.length).toBe(n)
    await m.svc.scanNow()
    expect(m.apply.batches.length).toBe(n + 1)
    expect(m.svc.setPaused(false).state).toBe('watching')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10)
    expect(m.apply.batches.length).toBe(n + 2)
    m.svc.stop()
  })

  it('an engine failure is a plain message and the next scan tries again', async () => {
    const m = mk({}, stubApply(true))
    m.add('a.json')
    const st = await m.svc.scanNow()
    expect(st.message).toMatch(/try again/)
    expect(st.state).toBe('watching')
    expect(JSON.stringify(st)).not.toContain('boom')
    const good = stubApply()
    const m2 = mk({}, good)
    m2.add('a.json')
    expect((await m2.svc.scanNow()).message).toBeNull()
  })

  it('a Settings change takes effect without a restart (off -> on starts a scan)', async () => {
    const m = mk({ [LEGACY_WATCH_KEYS.enabled]: false })
    m.add('a.json')
    m.svc.start()
    expect(m.svc.status().state).toBe('off')
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 10)
    expect(m.apply.batches).toHaveLength(0)
    m.settings.v[LEGACY_WATCH_KEYS.enabled] = true
    expect(m.svc.status().state).toBe('watching')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10)
    expect(m.apply.batches).toHaveLength(1)
    m.settings.v[LEGACY_WATCH_KEYS.enabled] = false
    expect(m.svc.status().state).toBe('off')
    expect(m.mem.watching()).toBe(false)
    m.svc.stop()
  })

  it('a scan requested during a scan is run once more afterwards, not in parallel', async () => {
    const m = mk()
    m.add('a.json')
    const p1 = m.svc.scanNow()
    const p2 = m.svc.scanNow()
    await Promise.all([p1, p2])
    expect(m.mem.reads()).toBeGreaterThanOrEqual(1)
  })
})
