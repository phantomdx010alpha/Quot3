import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCrashState, installCrashHandlers, type Emitter } from '../crash'
import { createLogger } from '../logger'
import { createDiagnosticsService } from '../services/diagnosticsService'

const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'q3-crash-')); dirs.push(d); return d }
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

const HOME = 'C:\\Users\\Ruby'
const logText = (dir: string): string => readFileSync(join(dir, 'quot3.log'), 'utf8')

function rig() {
  const dir = tmp()
  const proc = new EventEmitter()
  const app = new EventEmitter()
  const state = createCrashState({ dir, version: '0.1.0', now: () => new Date('2026-10-10T10:00:00.000Z') })
  const log = createLogger({ dir })
  const dispose = installCrashHandlers({ proc: proc as unknown as Emitter, app: app as unknown as Emitter, log, state, home: HOME, now: () => new Date('2026-10-10T10:05:00.000Z') })
  return { dir, proc, app, state, log, dispose }
}

describe('Phase 61 - global error handlers (forced exceptions)', () => {
  it('uncaughtException: logs a scrubbed line with frames, records the crash, does not throw', () => {
    const r = rig()
    const err = new Error('ENOSPC writing C:\\Users\\Ruby\\AppData\\Local\\Quot3\\quot3.db key Q3-ABCD-EFGH-ABCD')
    err.stack = 'Error: x\n    at save (C:\\Users\\Ruby\\app\\main.js:1:1)'
    expect(() => r.proc.emit('uncaughtException', err, 'uncaughtException')).not.toThrow()
    const text = logText(r.dir)
    expect(text).toContain('Crash handler: main-exception')
    expect(text).toContain('ENOSPC')
    expect(text).not.toContain('Ruby')
    expect(text).not.toContain('Q3-ABCD')
    expect(r.state.lastCrash()).toEqual({ at: '2026-10-10T10:05:00.000Z', kind: 'main-exception', message: expect.stringContaining('ENOSPC') })
  })

  it('unhandledRejection with a non-Error value is logged and recorded', () => {
    const r = rig()
    r.proc.emit('unhandledRejection', 'plain string reason', Promise.resolve())
    expect(logText(r.dir)).toContain('main-rejection')
    expect(r.state.lastCrash()?.kind).toBe('main-rejection')
  })

  it('render-process-gone and child-process-gone are recorded; a clean exit is not', () => {
    const r = rig()
    r.app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 })
    r.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit' })
    expect(r.state.lastCrash()).toBeNull()
    r.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' })
    expect(r.state.lastCrash()?.kind).toBe('child-gone')
    r.app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: 9 })
    expect(r.state.lastCrash()).toMatchObject({ kind: 'renderer-gone', message: 'Window process gone: oom' })
  })

  it('a repeated identical error is logged once but still recorded; a failing logger never escapes', () => {
    const r = rig()
    for (let i = 0; i < 5; i++) r.proc.emit('uncaughtException', new Error('same'), 'x')
    expect(logText(r.dir).split('\n').filter((l) => l.includes('main-exception'))).toHaveLength(1)
    const broken = installCrashHandlers({
      proc: r.proc as unknown as Emitter, app: r.app as unknown as Emitter, state: r.state,
      log: { debug: () => undefined, info: () => undefined, warn: () => { throw new Error('log down') }, error: () => { throw new Error('log down') } }
    })
    expect(() => r.proc.emit('unhandledRejection', new Error('other'))).not.toThrow()
    broken()
  })

  it('dispose removes the listeners', () => {
    const r = rig()
    r.dispose()
    expect(r.proc.listenerCount('uncaughtException')).toBe(0)
    expect(r.app.listenerCount('render-process-gone')).toBe(0)
  })
})

describe('Phase 61 - crash recovery message on next launch', () => {
  const state = (dir: string, at: string) => createCrashState({ dir, version: '0.1.0', now: () => new Date(at) })

  it('a clean quit gives no notice next time', () => {
    const dir = tmp()
    const a = state(dir, '2026-10-10T08:00:00.000Z')
    expect(a.begin()).toEqual({ notice: null, fresh: false })
    a.end()
    expect(state(dir, '2026-10-10T09:00:00.000Z').begin()).toEqual({ notice: null, fresh: false })
  })

  it('no clean quit = a notice (unclean-exit); with a recorded crash it carries the kind; it stays until dismissed', () => {
    const dir = tmp()
    state(dir, '2026-10-10T08:00:00.000Z').begin() // never ended
    const b = state(dir, '2026-10-10T09:00:00.000Z')
    const first = b.begin()
    expect(first.fresh).toBe(true)
    expect(first.notice).toMatchObject({ kind: 'unclean-exit', at: '2026-10-10T08:00:00.000Z', version: '0.1.0' })
    // closed without a clean end again, notice not yet dismissed: still shown, now with a crash recorded in run 2
    b.record({ at: '2026-10-10T09:30:00.000Z', kind: 'renderer-gone', message: 'Window process gone: oom' })
    const c = state(dir, '2026-10-10T10:00:00.000Z')
    const second = c.begin()
    expect(second.fresh).toBe(true)
    expect(second.notice).toMatchObject({ kind: 'renderer-gone' })
    c.dismiss()
    expect(c.notice()).toBeNull()
    c.end()
    expect(state(dir, '2026-10-10T11:00:00.000Z').begin().notice).toBeNull()
  })

  it('a crash recorded BEFORE the previous run started is not blamed on it', () => {
    const dir = tmp()
    const a = state(dir, '2026-10-10T08:00:00.000Z')
    a.record({ at: '2026-10-09T07:00:00.000Z', kind: 'main-exception', message: 'old' })
    a.begin()
    const n = state(dir, '2026-10-10T09:00:00.000Z').begin().notice
    expect(n?.kind).toBe('unclean-exit')
  })

  it('unreadable files are treated as absent', () => {
    const dir = tmp()
    const a = state(dir, '2026-10-10T08:00:00.000Z')
    a.begin()
    expect(existsSync(join(dir, 'session.json'))).toBe(true)
    expect(createCrashState({ dir: join(dir, 'nope', 'deeper'), version: '1' }).lastCrash()).toBeNull()
  })
})

describe('Phase 61 - diagnostics service', () => {
  function svc(copied: string[]) {
    const dir = tmp()
    const log = createLogger({ dir })
    const st = createCrashState({ dir, version: '0.1.0' })
    const s = createDiagnosticsService({
      logsDir: dir, home: HOME, log, state: st,
      versions: { version: '0.1.0', electron: '44', chrome: '140', node: '22', dev: false },
      os: { platform: 'win32', release: '10', arch: 'x64' },
      db: () => ({ schemaVersion: 2, writable: true, counts: { bills: 5 } }),
      sync: () => ({ activated: false, mode: 'off' }),
      writeClipboard: (t) => copied.push(t)
    })
    return { dir, log, st, s }
  }

  it('logs a renderer error scrubbed, once per message', () => {
    const { dir, s } = svc([])
    expect(s.report({ kind: 'error', message: 'TypeError: x is undefined in C:\\Users\\Ruby\\y.js', stack: '    at f (C:\\Users\\Ruby\\y.js:1:1)' })).toEqual({ logged: true })
    expect(s.report({ kind: 'error', message: 'TypeError: x is undefined in C:\\Users\\Ruby\\y.js' })).toEqual({ logged: false })
    const text = logText(dir)
    expect(text).toContain('Renderer error')
    expect(text).not.toContain('Ruby')
  })

  it('Copy diagnostics puts counts and recent log lines on the clipboard, with no secrets or user folder', () => {
    const copied: string[] = []
    const { log, st, s } = svc(copied)
    log.info('Quot3 starting', { dataDir: 'C:\\Users\\Ruby\\AppData\\Local\\Quot3' })
    st.record({ at: '2026-10-10T10:00:00.000Z', kind: 'main-exception', message: 'Error: boom' })
    const r = s.copy()
    expect(copied).toHaveLength(1)
    expect(r.chars).toBe(copied[0]!.length)
    expect(copied[0]).toContain('bills: 5')
    expect(copied[0]).toContain('Quot3 starting')
    expect(copied[0]).toContain('main-exception - Error: boom')
    expect(copied[0]).not.toContain('Ruby')
  })

  it('survives a failing db / sync probe and exposes the crash notice', () => {
    const dir = tmp()
    const st = createCrashState({ dir, version: '1' })
    const s = createDiagnosticsService({
      logsDir: dir, log: createLogger({ dir }), state: st, versions: { version: '1', electron: '', chrome: '', node: '', dev: true }, os: { platform: 'x', release: '', arch: '' },
      db: () => { throw new Error('closed') }, sync: () => { throw new Error('x') }, writeClipboard: () => undefined
    })
    expect(s.text()).toContain('Sync: not activated, unknown')
    expect(s.crashNotice()).toBeNull()
    s.dismissCrash()
  })
})
