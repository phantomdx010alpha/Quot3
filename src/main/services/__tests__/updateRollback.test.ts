import { describe, expect, it, vi } from 'vitest'
import { createUpdateService, type UpdaterPort } from '../updateService'
import { updateHandlers } from '../../ipc/updates'
import type { RollbackOptions } from '../../../shared/rollback'
import type { UpdaterOptions, UpdateState } from '../../../shared/updater'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
const asset = (v: string) => [{ name: 'latest.yml', state: 'uploaded' }, { name: `Quot3-Setup-${v}.exe`, state: 'uploaded' }]
const rel = (v: string, body = '') => ({ tag_name: `v${v}`, draft: false, prerelease: false, body, published_at: '2026-10-12T10:00:00Z', assets: asset(v) })
/** 0.1.2 .. 0.1.4 are schema 8 (no line); 0.2.0 declares schema 9. */
const RELEASES = [rel('0.2.0', 'schema: 9'), rel('0.1.4'), rel('0.1.3'), rel('0.1.2')]

function harness(o: { current?: string; dbSchema?: number; settings?: Record<string, unknown>; releases?: unknown; listFail?: Error; backupFail?: Error; missingOnFeed?: boolean } = {}) {
  const store: Record<string, unknown> = { 'updates.auto': true, 'updates.channel': 'stable', 'updates.feedUrl': '', 'updates.pinnedVersion': '', 'updates.autoBeforePin': true, ...(o.settings ?? {}) }
  const order: string[] = []
  const normal: UpdaterOptions[] = []
  const rollback: RollbackOptions[] = []
  let mode: 'normal' | 'rollback' = 'normal'
  let target = ''
  let installed = 0
  let fetches = 0
  let now = Date.parse('2026-10-13T10:00:00Z')
  const port: UpdaterPort = {
    configure: (x) => { mode = 'normal'; normal.push(x) },
    configureRollback: (x) => { mode = 'rollback'; rollback.push(x); target = /\/v([^/]+)\/$/.exec(x.feed.url)![1]! },
    check: async () => { order.push('check'); return { version: mode === 'rollback' && !o.missingOnFeed ? target : mode === 'normal' ? '0.2.0' : '' } },
    download: async (p) => { order.push('download'); p(40); p(100) },
    quitAndInstall: () => { order.push('quit'); installed++ }
  }
  const events: UpdateState[] = []
  const audit = vi.fn()
  const svc = createUpdateService({
    port, settings: { get: (k) => store[k], set: (k, v) => { order.push(`set:${k}`); store[k] = v } }, version: o.current ?? '0.2.0', packaged: true,
    emit: (_c, s) => events.push(s), prepareInstall: () => { order.push('prepare') }, audit, log, now: () => new Date(now),
    releases: { fetch: async () => { fetches++; if (o.listFail) throw o.listFail; return o.releases ?? RELEASES } },
    backup: { create: async () => { order.push('backup'); if (o.backupFail) throw o.backupFail; return { file: 'pre-rollback-20261013-160000.db' } } },
    dbSchema: () => o.dbSchema ?? 9,
    setTimer: () => 1, clearTimer: () => undefined
  })
  return { svc, store, order, normal, rollback, events, audit, installed: () => installed, fetches: () => fetches, tick: (ms: number) => { now += ms } }
}

describe('0.1.5 choose app version - service (fake port)', () => {
  it('lists releases, marks the current one and blocks versions with an older data format', async () => {
    const h = harness({ current: '0.2.0', dbSchema: 9 })
    const l = await h.svc.listVersions()
    expect(l.entries.map((e) => [e.version, e.current, e.allowed])).toEqual([['0.2.0', true, false], ['0.1.4', false, false], ['0.1.3', false, false], ['0.1.2', false, false]])
    expect(l.entries[1]!.why).toMatch(/newer format/)
    await expect(h.svc.chooseVersion('0.1.2')).rejects.toThrow(/unable to save bills/)
    expect(h.rollback).toEqual([]) // nothing was downloaded
    expect(h.order).not.toContain('download')
  })

  it('the list is cached for a few minutes (GitHub allows 60 requests an hour) and refreshable', async () => {
    const h = harness()
    await h.svc.listVersions(); await h.svc.listVersions()
    expect(h.fetches()).toBe(1)
    await h.svc.listVersions(true)
    expect(h.fetches()).toBe(2)
    h.tick(6 * 60 * 1000)
    await h.svc.listVersions()
    expect(h.fetches()).toBe(3)
  })

  it('offline or rate limited: a plain sentence, never the raw error', async () => {
    const a = harness({ listFail: new Error('HTTP 403 https://api.github.com/x?token=abc') })
    await expect(a.svc.listVersions()).rejects.toThrow('GitHub is limiting requests right now. Try again in about an hour.')
    const b = harness({ listFail: new Error('fetch failed') })
    await expect(b.svc.listVersions()).rejects.toThrow(/No connection to GitHub/)
    const ipc = updateHandlers(a.svc)
    const r = await ipc['updates:listVersions']!({})
    expect(JSON.stringify(r)).not.toContain('token')
  })

  it('chooses 0.1.2 on a schema-8 database: downloads from that release only, then ready (nothing restarts)', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8 })
    await h.svc.listVersions()
    const s = await h.svc.chooseVersion('0.1.2')
    expect(s).toMatchObject({ phase: 'ready', mode: 'rollback', version: '0.1.2', percent: 100 })
    expect(h.rollback).toEqual([{ feed: { kind: 'generic', url: 'https://github.com/phantomdx010alpha/Quot3/releases/download/v0.1.2/' }, channel: 'latest', allowPrerelease: false, allowDowngrade: true }])
    expect(h.installed()).toBe(0)
    expect(h.audit).toHaveBeenCalledWith({ entity: 'app', action: 'rollback_downloaded', detail: { from: '0.1.4', to: '0.1.2' } })
  })

  it('only a version from the list is accepted; raw text never becomes an address', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8 })
    await expect(h.svc.chooseVersion('0.1.2')).rejects.toThrow(/Open the version list first/)
    await h.svc.listVersions()
    for (const bad of ['9.9.9', '0.1.2/../../evil', '../x', '']) await expect(h.svc.chooseVersion(bad)).rejects.toThrow(/not in the list/)
    await expect(h.svc.chooseVersion('0.1.4')).rejects.toThrow(/already on this version/)
    expect(h.rollback).toEqual([])
    const ipc = updateHandlers(h.svc)
    expect(await ipc['updates:chooseVersion']!({ version: '0.1.2', url: 'https://evil.example' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('install: backup first, then the pin, then the restart; the pin also switches `updates.auto` off for older builds', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8 })
    await h.svc.listVersions()
    await h.svc.chooseVersion('0.1.2')
    h.order.length = 0
    await h.svc.installRollback()
    expect(h.order).toEqual(['backup', 'set:updates.autoBeforePin', 'set:updates.pinnedVersion', 'set:updates.auto', 'prepare', 'quit'])
    expect(h.store).toMatchObject({ 'updates.pinnedVersion': '0.1.2', 'updates.auto': false, 'updates.autoBeforePin': true })
    expect(h.audit).toHaveBeenCalledWith({ entity: 'app', action: 'rollback_install', detail: { from: '0.1.4', to: '0.1.2', backup: 'pre-rollback-20261013-160000.db' } })
  })

  it('install is refused while a bill is unsaved (before and after the backup), and when nothing is downloaded', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8 })
    await expect(h.svc.installRollback()).rejects.toThrow(/No other version has been downloaded/)
    await h.svc.listVersions(); await h.svc.chooseVersion('0.1.2')
    h.svc.setBusy(true)
    await expect(h.svc.installRollback()).rejects.toThrow(/Save or close the open bill/)
    expect(h.order).not.toContain('backup')
    expect(h.installed()).toBe(0)
    h.svc.setBusy(false)
    const p = h.svc.installRollback()
    h.svc.setBusy(true) // a bill is opened while the backup is being written
    await expect(p).rejects.toThrow(/Save or close the open bill/)
    expect(h.installed()).toBe(0)
    expect(h.store['updates.pinnedVersion']).toBe('')
  })

  it('a failed backup stops everything: no pin, no restart', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8, backupFail: new Error('Could not write the backup file. Check the disk space and try again.') })
    await h.svc.listVersions(); await h.svc.chooseVersion('0.1.2')
    await expect(h.svc.installRollback()).rejects.toThrow(/Could not write the backup file/)
    expect(h.installed()).toBe(0)
    expect(h.store).toMatchObject({ 'updates.pinnedVersion': '', 'updates.auto': true })
  })

  it('the normal install refuses a downloaded rollback (it would skip the backup)', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8 })
    await h.svc.listVersions(); await h.svc.chooseVersion('0.1.2')
    expect(() => h.svc.install()).toThrow(/backup is made first/)
    expect(h.installed()).toBe(0)
  })

  it('a version missing on GitHub ends as a plain error and later checks work again', async () => {
    const h = harness({ current: '0.1.4', dbSchema: 8, missingOnFeed: true })
    await h.svc.listVersions()
    const s = await h.svc.chooseVersion('0.1.3')
    expect(s).toMatchObject({ phase: 'error', mode: 'update', message: 'That version is no longer available to download.' })
    const n = await h.svc.check(true)
    expect(h.normal[0]).toMatchObject({ allowDowngrade: false }) // the normal flow is configured with no downgrade
    expect(n.mode).toBe('update')
  })

  it('stay on the chosen version: background checks pause; ticking the box or Back to latest ends it', async () => {
    const h = harness({ current: '0.1.2', settings: { 'updates.pinnedVersion': '0.1.2', 'updates.auto': false, 'updates.autoBeforePin': true } })
    expect(h.svc.state()).toMatchObject({ pinned: '0.1.2', auto: false })
    h.svc.start()
    expect((await h.svc.check(false)).phase).toBe('idle')
    expect(h.order).not.toContain('check')
    // even with auto switched on by hand in the store, a pin keeps the schedule quiet
    h.store['updates.auto'] = true
    expect((await h.svc.check(false)).phase).toBe('idle')
    // Back to latest: pin removed, `updates.auto` restored, newest version downloaded
    h.store['updates.auto'] = false
    const s = await h.svc.backToLatest()
    expect(h.store).toMatchObject({ 'updates.pinnedVersion': '', 'updates.auto': true })
    expect(s).toMatchObject({ phase: 'ready', version: '0.2.0', mode: 'update', pinned: '' })

    const g = harness({ current: '0.1.2', settings: { 'updates.pinnedVersion': '0.1.2', 'updates.auto': false } })
    expect(g.svc.setConfig({ auto: true })).toMatchObject({ pinned: '', auto: true })
    expect(g.store['updates.pinnedVersion']).toBe('')
  })

  it('a pin that does not match the running version is dropped (the owner updated by hand)', () => {
    const h = harness({ current: '0.1.5', settings: { 'updates.pinnedVersion': '0.1.2', 'updates.auto': false, 'updates.autoBeforePin': true } })
    expect(h.svc.state()).toMatchObject({ pinned: '', auto: true })
    expect(h.store['updates.pinnedVersion']).toBe('')
  })

  it('going to the newest listed version does not pin; a later choice keeps the first remembered auto value', async () => {
    const h = harness({ current: '0.1.2', dbSchema: 8, settings: { 'updates.auto': true } })
    await h.svc.listVersions()
    await h.svc.chooseVersion('0.2.0')
    await h.svc.installRollback()
    expect(h.store).toMatchObject({ 'updates.pinnedVersion': '', 'updates.auto': true })

    const k = harness({ current: '0.1.4', dbSchema: 8, settings: { 'updates.auto': false, 'updates.autoBeforePin': true, 'updates.pinnedVersion': '0.1.4' } })
    await k.svc.listVersions(); await k.svc.chooseVersion('0.1.3'); await k.svc.installRollback()
    expect(k.store).toMatchObject({ 'updates.pinnedVersion': '0.1.3', 'updates.autoBeforePin': true }) // not overwritten with `false`
  })

  it('changing the channel drops the cached list', async () => {
    const h = harness()
    await h.svc.listVersions()
    h.svc.setConfig({ channel: 'beta' })
    await h.svc.listVersions()
    expect(h.fetches()).toBe(2)
  })
})
