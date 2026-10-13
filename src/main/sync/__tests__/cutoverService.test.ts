import { describe, expect, it } from 'vitest'
import { createCutoverService, type CutoverDeps } from '../cutoverService'
import { CUTOVER_KEYS } from '../../../shared/sync/cutover'
import { SYNC_KEYS } from '../licenseService'
import type { CompareResult } from '../compareService'

/** Phase 140: the cutover state machine over fakes (a Map for `sync_state`, counters for the side effects). */
function kit(o: { v1?: boolean; backupFails?: boolean } = {}) {
  const store = new Map<string, string>()
  if (o.v1 !== false) { store.set(SYNC_KEYS.licenseBlob, 'blob'); store.set(SYNC_KEYS.orgId, 'org-v1'); store.set(SYNC_KEYS.licenseHint, 'Q3-****-JKLM') }
  const c = { backups: 0, stops: 0, afterCompare: 0, runs: 0, unifies: 0, audits: [] as string[], logs: [] as string[] }
  const flags = { v2: false, compareDone: false, runResult: 'done' as 'done' | 'paused' }
  const sync: CutoverDeps['sync'] = {
    get: (k) => store.get(k), set: (k, v) => void store.set(k, v), setMany: (e) => { for (const [k, v] of Object.entries(e)) store.set(k, v) }
  }
  const deps: CutoverDeps = {
    sync,
    backup: { create: async () => { if (o.backupFails) throw new Error('disk full'); c.backups++; return { file: `manual-${c.backups}.db` } } },
    stopV1: () => { c.stops++ },
    v2: { isActivated: () => flags.v2 },
    compare: {
      needed: () => !flags.compareDone,
      run: async () => {
        c.runs++
        if (flags.runResult === 'done') flags.compareDone = true
        return { state: flags.runResult, block: 'idle', message: null, kinds: [], skip: 5, upload: 2, download: 3, conflict: 1, cursor: null } as CompareResult
      }
    },
    customers: { unify: () => { c.unifies++; return { groups: 2, merged: 4, billsMoved: 9 } } },
    afterCompare: () => { c.afterCompare++ },
    audit: (a) => { c.audits.push(`${a.action}:${a.detailJson ?? ''}`) },
    log: { info: (m, d) => c.logs.push(m + JSON.stringify(d ?? {})), warn: (m, d) => c.logs.push(m + JSON.stringify(d ?? {})), error: () => undefined }
  }
  const make = (opts: Parameters<typeof createCutoverService>[1] = {}) => createCutoverService(deps, { now: () => new Date('2026-10-13T10:00:00Z'), ...opts })
  return { store, c, flags, svc: make(), make }
}

describe('begin: backup first, then pause v1', () => {
  it('makes one backup, stops v1, marks it inert and moves on to sign-in', async () => {
    const k = kit()
    expect(k.svc.status()).toMatchObject({ needed: true, step: 'backup', stepNo: 1, v1Inert: false, v1LicenseHint: 'Q3-****-JKLM' })
    const s = await k.svc.begin()
    expect(s).toMatchObject({ step: 'signin', backupFile: 'manual-1.db', v1Inert: true })
    expect(k.c).toMatchObject({ backups: 1, stops: 1 })
  })
  it('a failed backup changes nothing: v1 is not stopped, no key is written', async () => {
    const k = kit({ backupFails: true })
    await expect(k.svc.begin()).rejects.toMatchObject({ code: 'IO_ERROR' })
    expect(k.c.stops).toBe(0)
    expect(k.store.has(CUTOVER_KEYS.backupFile)).toBe(false)
    expect(k.store.has(CUTOVER_KEYS.v1Inert)).toBe(false)
    expect(k.svc.status().step).toBe('backup')
  })
  it('running it again does not make a second backup (only the idempotent stop repeats)', async () => {
    const k = kit()
    await k.svc.begin(); await k.svc.begin()
    expect(k.c.backups).toBe(1)
  })
  it('a computer with no old sync is refused', async () => {
    const k = kit({ v1: false })
    expect(k.svc.status().needed).toBe(false)
    await expect(k.svc.begin()).rejects.toMatchObject({ code: 'VALIDATION' })
  })
  it('a read-only database refuses', async () => {
    const k = kit()
    await expect(k.make({ writable: false }).begin()).rejects.toMatchObject({ code: 'DB_ERROR' })
    expect(k.c.backups).toBe(0)
  })
  it('the old license keys are left untouched (readable, never deleted)', async () => {
    const k = kit(); await k.svc.begin()
    expect(k.store.get(SYNC_KEYS.licenseBlob)).toBe('blob')
    expect(k.store.get(SYNC_KEYS.orgId)).toBe('org-v1')
  })
})

describe('compare', () => {
  it('needs the backup and the sign-in first', async () => {
    const k = kit()
    await expect(k.svc.compare()).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('backup') })
    await k.svc.begin()
    await expect(k.svc.compare()).rejects.toMatchObject({ message: expect.stringContaining('Sign in') })
    expect(k.c.runs).toBe(0)
  })
  it('signing in moves the derived step to compare; a finished compare moves it to customers and kicks the workers once', async () => {
    const k = kit(); await k.svc.begin(); k.flags.v2 = true
    expect(k.svc.status().step).toBe('compare')
    const r = await k.svc.compare()
    expect(r.compare).toMatchObject({ state: 'done', upload: 2, download: 3, conflict: 1, skip: 5 })
    expect(r.status.step).toBe('unify')
    expect(k.c.afterCompare).toBe(1)
  })
  it('a paused compare stays on the compare step and can be run again; the workers are not kicked', async () => {
    const k = kit(); await k.svc.begin(); k.flags.v2 = true; k.flags.runResult = 'paused'
    const p = await k.svc.compare()
    expect(p.compare.state).toBe('paused'); expect(p.status.step).toBe('compare'); expect(k.c.afterCompare).toBe(0)
    k.flags.runResult = 'done'
    expect((await k.svc.compare()).status.step).toBe('unify')
  })
  it('running it after it finished is a no-op', async () => {
    const k = kit(); await k.svc.begin(); k.flags.v2 = true
    await k.svc.compare()
    const again = await k.svc.compare()
    expect(again.compare).toMatchObject({ state: 'done', already: true })
    expect(k.c.runs).toBe(1); expect(k.c.afterCompare).toBe(1)
  })
})

describe('unify and finish', () => {
  async function ready() { const k = kit(); await k.svc.begin(); k.flags.v2 = true; await k.svc.compare(); return k }
  it('needs the compare first', async () => {
    const k = kit(); await k.svc.begin(); k.flags.v2 = true
    expect(() => k.svc.unify({ skip: false })).toThrow(/comparison/)
    expect(k.c.unifies).toBe(0)
  })
  it('unify joins same-name customers once, finishes the cutover and marks the old license abandoned', async () => {
    const k = await ready()
    const r = k.svc.unify({ skip: false })
    expect(r).toMatchObject({ merged: 4, billsMoved: 9, status: { step: 'done', needed: false } })
    expect(k.store.get(CUTOVER_KEYS.v1Abandoned)).toBe('2026-10-13T10:00:00.000Z')
    expect(k.c.audits.some((a) => a.startsWith('cutover_finished'))).toBe(true)
    // asking again changes nothing
    expect(k.svc.unify({ skip: false })).toMatchObject({ merged: 0 })
    expect(k.c.unifies).toBe(1)
  })
  it('skipping finishes without touching customers', async () => {
    const k = await ready()
    expect(k.svc.unify({ skip: true })).toMatchObject({ merged: 0, status: { step: 'done' } })
    expect(k.c.unifies).toBe(0)
    expect(k.store.get(CUTOVER_KEYS.unify)).toMatch(/^skipped /)
  })
  it('after finishing the wizard is no longer offered and begin does nothing', async () => {
    const k = await ready(); k.svc.unify({ skip: true })
    expect(k.svc.status().needed).toBe(false)
    const backups = k.c.backups
    await k.svc.begin()
    expect(k.c.backups).toBe(backups)
  })
})

describe('interrupted wizard and secrets', () => {
  it('a new service object over the same stored state resumes at the same step (restart in the middle)', async () => {
    const k = kit(); await k.svc.begin()
    const again = k.make()
    expect(again.status()).toMatchObject({ step: 'signin', backupFile: 'manual-1.db', v1Inert: true })
    k.flags.v2 = true
    expect(again.status().step).toBe('compare')
    await again.begin()
    expect(k.c.backups).toBe(1)
  })
  it('logs and audit rows hold counts and a file name only: no key, password or token', async () => {
    const k = kit(); await k.svc.begin(); k.flags.v2 = true; await k.svc.compare(); k.svc.unify({ skip: false })
    const text = [...k.c.logs, ...k.c.audits].join('\n').toLowerCase()
    for (const bad of ['password', 'token', 'blob', 'q3-', 'anon', 'secret']) expect(text).not.toContain(bad)
  })
})
