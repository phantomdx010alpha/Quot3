import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'q3log-'))

describe('logger', () => {
  it('writes timestamped lines', () => {
    const dir = tmp()
    const log = createLogger({ dir, now: () => new Date('2026-10-08T00:00:00Z') })
    log.info('hello', { a: 1 })
    expect(readFileSync(join(dir, 'quot3.log'), 'utf8')).toBe('2026-10-08T00:00:00.000Z INFO  hello {"a":1}\n')
  })

  it('rotates by size and keeps at most maxFiles rotated files', () => {
    const dir = tmp()
    const log = createLogger({ dir, maxBytes: 200, maxFiles: 3 })
    for (let i = 0; i < 60; i++) log.info(`line ${i} ${'x'.repeat(40)}`)
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['quot3.log', 'quot3.log.1', 'quot3.log.2', 'quot3.log.3'])
    for (const f of files) expect(readFileSync(join(dir, f)).length).toBeLessThanOrEqual(200)
    // newest data is in the active file
    expect(readFileSync(join(dir, 'quot3.log'), 'utf8')).toContain('line 59')
  })

  it('never throws if the directory is missing', () => {
    const log = createLogger({ dir: join(tmp(), 'nope', 'nope') })
    expect(() => log.error('boom', new Error('x'))).not.toThrow()
  })
})
