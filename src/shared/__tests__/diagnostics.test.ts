import { describe, expect, it } from 'vitest'
import { buildDiagnosticsText, createReportGate, describeCrashNotice, describeError, scrubText, tailLines } from '../diagnostics'

describe('Phase 61 - diagnostics helpers (pure)', () => {
  it('masks the user folder, license keys and tokens', () => {
    const home = 'C:\\Users\\Ruby'
    const t = scrubText('open C:\\Users\\Ruby\\AppData\\x.db and c:/users/ruby/y key Q3-ABCD-EFGH-ABCD jwt eyJhbGciOiJIUzI1.eyJyb2xlIjoiYW5vbiJ9.abcdefghijkl', { home })
    expect(t).not.toContain('Ruby')
    expect(t).toContain('~')
    expect(t).toContain('Q3-****')
    expect(t).toContain('[token]')
    expect(scrubText('x'.repeat(60))).toBe('[secret]')
  })

  it('describes anything thrown: one message line, a few frames, scrubbed', () => {
    const err = new Error('Disk full at C:\\Users\\Ruby\\data\nsecond line with bill content')
    err.stack = `Error: Disk full\n    at a (file.js:1:1)\n    at b (file.js:2:2)`
    const e = describeError(err, { home: 'C:\\Users\\Ruby' })
    expect(e.message).toBe('Disk full at ~\\data')
    expect(e.stack.split('\n')).toHaveLength(2)
    expect(describeError('plain').message).toBe('plain')
    expect(describeError({ a: 1 }).message).toBe('{"a":1}')
    const circ: Record<string, unknown> = {}; circ['self'] = circ
    expect(describeError(circ).message.length).toBeGreaterThan(0)
  })

  it('builds the diagnostics text from counts and log lines only', () => {
    const t = buildDiagnosticsText({
      now: new Date('2026-10-10T10:00:00.000Z'),
      app: { version: '0.1.0', electron: '44.0.0', chrome: '140', node: '22', dev: false },
      os: { platform: 'win32', release: '10.0.26100', arch: 'x64' },
      db: { schemaVersion: 2, writable: true, counts: { bills: 12, customers: 3 } },
      sync: { activated: true, mode: 'idle' },
      lastCrash: { at: '2026-10-09T08:00:00.000Z', kind: 'main-exception', message: 'Error: boom' },
      logLines: ['2026-10-10T09:59:00.000Z INFO  Quot3 starting']
    })
    expect(t).toContain('App: 0.1.0')
    expect(t).toContain('bills: 12')
    expect(t).toContain('Last crash: 2026-10-09T08:00:00.000Z main-exception - Error: boom')
    expect(t).toContain('Quot3 starting')
    expect(t).toContain('schema 2, read-write')
  })

  it('tails a log, throttles reports and words the crash notice', () => {
    expect(tailLines('a\n\nb\r\nc\n', 2)).toEqual(['b', 'c'])
    const gate = createReportGate(2)
    expect([gate('a'), gate('a'), gate('b'), gate('c')]).toEqual([true, false, true, false])
    const n = describeCrashNotice({ at: '2026-10-09T08:00:00.000Z', kind: 'unclean-exit', message: '', version: '0.1.0' })
    expect(n.title).toContain('did not close properly')
    expect(n.body).toContain('Recover unsaved bill')
  })
})
