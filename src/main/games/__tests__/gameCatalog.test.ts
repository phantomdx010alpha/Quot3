import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditGameFolder } from '../../../../tools/audit-games.mjs'
import { createGameCatalog } from '../gameCatalog'

const entry = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, title: `Game ${id}`, tags: ['arcade'], description: 'An invented test game.', source: 'https://github.com/example/games', commit: 'abcdef1234567',
  licence: 'MIT', author: 'Example', entry: 'index.html', players: 1, touch: false, added: '2026-10-29', ...over
})
let root: string
const game = (id: string, withLicense = true, withEntry = true): void => {
  mkdirSync(join(root, id), { recursive: true })
  if (withEntry) writeFileSync(join(root, id, 'index.html'), '<p>x</p>')
  if (withLicense) writeFileSync(join(root, id, 'LICENSE'), `licence of ${id}`)
}
const manifest = (games: unknown[]): void => writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, games }))

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'q3cat-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('gameCatalog', () => {
  it('lists valid games, with credits and license text', () => {
    game('snake'); game('chess')
    manifest([entry('snake'), entry('chess')])
    const c = createGameCatalog({ gamesRoot: root })
    expect(c.list().games.map((g) => g.id)).toEqual(['snake', 'chess'])
    expect(c.list().skipped).toBe(0)
    expect(c.get('snake')?.title).toBe('Game snake')
    expect(c.get('nope')).toBeNull()
    expect(c.credits()[0]).toEqual({ id: 'snake', title: 'Game snake', author: 'Example', source: 'https://github.com/example/games', licence: 'MIT', commit: 'abcdef1234567' })
    expect(c.license('chess')).toBe('licence of chess')
    expect(c.license('nope')).toBeNull()
  })
  it('skips and counts an invalid entry, a disallowed licence, a duplicate, and an entry whose files are missing', () => {
    game('good'); game('nolic', false); game('noentry', true, false)
    manifest([entry('good'), entry('gpl', { licence: 'GPL-3.0' }), entry('good'), entry('nolic'), entry('noentry'), { id: 5 }])
    const r = createGameCatalog({ gamesRoot: root }).list()
    expect(r.games.map((g) => g.id)).toEqual(['good'])
    expect(r.skipped).toBe(5)
    expect(r.problems.length).toBe(5)
  })
  it('a missing manifest is an empty list; a broken one too; neither throws', () => {
    expect(createGameCatalog({ gamesRoot: root }).list()).toEqual({ games: [], skipped: 0, problems: [] })
    expect(createGameCatalog({ gamesRoot: join(root, 'does-not-exist') }).list().games).toEqual([])
    writeFileSync(join(root, 'manifest.json'), '{ not json')
    const warned: string[] = []
    const r = createGameCatalog({ gamesRoot: root, warn: (m) => warned.push(m) }).list()
    expect(r.games).toEqual([])
    expect(warned.length).toBe(1)
  })
  it('reload picks up a changed manifest; list is cached otherwise', () => {
    game('a1'); manifest([entry('a1')])
    const c = createGameCatalog({ gamesRoot: root })
    expect(c.list().games).toHaveLength(1)
    game('b2'); manifest([entry('a1'), entry('b2')])
    expect(c.list().games).toHaveLength(1)
    expect(c.reload().games).toHaveLength(2)
  })
  it('an oversized LICENSE is not returned', () => {
    game('big'); manifest([entry('big')])
    writeFileSync(join(root, 'big', 'LICENSE'), 'x'.repeat(70 * 1024))
    expect(createGameCatalog({ gamesRoot: root }).license('big')).toBeNull()
  })
  it('the shipped resources/games folder: manifest parses, and the self-test game passes the audit', () => {
    const real = join(__dirname, '../../../../resources/games')
    expect(createGameCatalog({ gamesRoot: real }).list().skipped).toBe(0)
    const a = auditGameFolder(join(real, '_selftest'), { entry: 'index.html' })
    expect(a.failures).toEqual([])
    expect(a.ok).toBe(true)
  })
})
