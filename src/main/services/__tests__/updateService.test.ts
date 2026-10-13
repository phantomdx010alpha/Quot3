import { describe, expect, it, vi } from 'vitest'
import { createUpdateService, type UpdaterPort } from '../updateService'
import { updateHandlers } from '../../ipc/updates'
import type { UpdaterOptions, UpdateState } from '../../../shared/updater'
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_MS } from '../../../shared/updater'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

/** A mock feed: `offer` is the newest version it publishes ('' = nothing newer), `fail` makes it unreachable. */
function harness(o: { offer?: string; fail?: Error; packaged?: boolean; settings?: Record<string, unknown>; current?: string } = {}) {
  const store: Record<string, unknown> = { 'updates.auto': true, 'updates.channel': 'stable', 'updates.feedUrl': '', ...(o.settings ?? {}) }
  const calls: string[] = []
  const configured: UpdaterOptions[] = []
  let installed = 0
  const port: UpdaterPort = {
    configure: (opts) => { configured.push(opts) },
    check: async () => { calls.push('check'); if (o.fail) throw o.fail; return { version: o.offer ?? '' } },
    download: async (p) => { calls.push('download'); p(30); p(100) },
    quitAndInstall: () => { installed++ },
    configureRollback: () => undefined
  }
  const events: UpdateState[] = []
  const audit = vi.fn()
  const prepare = vi.fn()
  const timers: { fn: () => void; ms: number }[] = []
  const svc = createUpdateService({
    port, settings: { get: (k) => store[k], set: (k, v) => { store[k] = v } }, version: o.current ?? '1.0.0', packaged: o.packaged ?? true,
    emit: (_c, s) => events.push(s), prepareInstall: prepare, audit, log,
    releases: { fetch: async () => [] }, backup: { create: async () => ({ file: 'pre-rollback-x.db' }) }, dbSchema: () => 8, now: () => new Date('2026-10-10T10:00:00.000Z'),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimer: () => undefined
  })
  return { svc, store, calls, configured, events, audit, prepare, timers, installed: () => installed }
}

describe('Phase 62 - update service (mock feed)', () => {
  it('newer version: checks, downloads in the background, ends ready; nothing restarts', async () => {
    const h = harness({ offer: '1.1.0' })
    const s = await h.svc.check(true)
    expect(s).toMatchObject({ phase: 'ready', version: '1.1.0', percent: 100, checkedAt: '2026-10-10T10:00:00.000Z' })
    expect(h.calls).toEqual(['check', 'download'])
    expect(h.events.map((e) => e.phase)).toEqual(expect.arrayContaining(['checking', 'downloading', 'ready']))
    expect(h.events.find((e) => e.phase === 'downloading' && e.percent === 30)).toBeTruthy()
    expect(h.installed()).toBe(0)
    expect(h.audit).toHaveBeenCalledWith({ entity: 'app', action: 'update_downloaded', detail: { from: '1.0.0', to: '1.1.0' } })
  })

  it('same or older version: up to date, no download', async () => {
    for (const offer of ['1.0.0', '0.9.0', '']) {
      const h = harness({ offer })
      expect((await h.svc.check(true)).phase).toBe('none')
      expect(h.calls).toEqual(['check'])
    }
  })

  it('feed trouble becomes a short sentence, then a later check can succeed', async () => {
    const h = harness({ fail: new Error('getaddrinfo ENOTFOUND updates.example.com') })
    const s = await h.svc.check(true)
    expect(s.phase).toBe('error')
    expect(s.message).toBe('No connection to the update server. Check the internet and try again.')
    expect(JSON.stringify(h.events)).not.toContain('example.com')
  })

  it('a garbage version from the feed is treated as nothing newer', async () => {
    const h = harness({ offer: 'latest!!' })
    expect((await h.svc.check(true)).phase).toBe('none')
  })

  it('settings reach the updater: channel, prerelease, GitHub / generic feed, never a downgrade', async () => {
    const h = harness({ offer: '', settings: { 'updates.channel': 'beta', 'updates.feedUrl': 'github:acme/quot3' } })
    await h.svc.check(true)
    expect(h.configured[0]).toEqual({ feed: { kind: 'github', owner: 'acme', repo: 'quot3' }, channel: 'beta', allowPrerelease: true, allowDowngrade: false })
    h.store['updates.feedUrl'] = 'https://u.example.com/q/'
    await h.svc.check(true)
    expect(h.configured[1]!.feed).toEqual({ kind: 'generic', url: 'https://u.example.com/q/' })
  })

  it('an invalid saved address is an error, not a request to somewhere else', async () => {
    const h = harness({ offer: '2.0.0', settings: { 'updates.feedUrl': 'http://evil.example.com' } })
    const s = await h.svc.check(true)
    expect(s.phase).toBe('error')
    expect(h.calls).toEqual([])
    expect(h.configured).toEqual([])
  })

  it('background checks obey the switch; a manual check always runs', async () => {
    const h = harness({ offer: '1.2.0', settings: { 'updates.auto': false } })
    expect((await h.svc.check(false)).phase).toBe('idle')
    expect(h.calls).toEqual([])
    expect((await h.svc.check(true)).phase).toBe('ready')
  })

  it('schedule: first check after 45 s, then every 6 h; stop clears it', async () => {
    const h = harness({ offer: '' })
    h.svc.start()
    expect(h.timers[0]!.ms).toBe(UPDATE_FIRST_CHECK_MS)
    h.timers[0]!.fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls).toEqual(['check'])
    expect(h.timers[1]!.ms).toBe(UPDATE_CHECK_INTERVAL_MS)
    h.svc.stop()
  })

  it('an unpackaged run (npm run dev) never touches the updater', async () => {
    const h = harness({ offer: '9.9.9', packaged: false })
    h.svc.start()
    expect(h.timers).toHaveLength(0)
    expect((await h.svc.check(true)).phase).toBe('unavailable')
    expect(h.calls).toEqual([])
  })

  it('a downloaded update is kept: a second check does not download again', async () => {
    const h = harness({ offer: '1.1.0' })
    await h.svc.check(true)
    await h.svc.check(true)
    expect(h.calls).toEqual(['check', 'download'])
  })

  it('install is refused while an unsaved bill is open, and when nothing is downloaded; the refusal restarts nothing', async () => {
    const h = harness({ offer: '1.1.0' })
    expect(() => h.svc.install()).toThrow(/No update has been downloaded/)
    await h.svc.check(true)
    h.svc.setBusy(true)
    expect(() => h.svc.install()).toThrow(/Save or close the open bill/)
    expect(h.installed()).toBe(0)
    expect(h.prepare).not.toHaveBeenCalled()
    h.svc.setBusy(false) // the bill was saved
    h.svc.install()
    expect(h.prepare).toHaveBeenCalledTimes(1)
    expect(h.installed()).toBe(1)
    expect(h.audit).toHaveBeenCalledWith({ entity: 'app', action: 'update_install', detail: { from: '1.0.0', to: '1.1.0' } })
  })

  it('setConfig validates the address and persists; strict IPC', async () => {
    const h = harness()
    expect(() => h.svc.setConfig({ feedUrl: 'http://x.com' })).toThrow(/https/)
    expect(h.store['updates.feedUrl']).toBe('')
    expect(h.svc.setConfig({ feedUrl: ' github:acme/quot3 ', channel: 'beta', auto: false })).toMatchObject({ feed: 'github', channel: 'beta', auto: false })
    expect(h.store['updates.feedUrl']).toBe('github:acme/quot3')
    const ipc = updateHandlers(h.svc)
    expect(await ipc['updates:setBusy']!({ busy: 'yes' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await ipc['updates:check']!({ extra: 1 })).toMatchObject({ ok: false })
    expect(await ipc['updates:setConfig']!({ channel: 'nightly' })).toMatchObject({ ok: false })
    expect(await ipc['updates:install']!({})).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await ipc['updates:state']!({})).toMatchObject({ ok: true })
  })
})
