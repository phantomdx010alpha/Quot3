import { describe, expect, it } from 'vitest'
import { ALLOWED_LICENCES, gameUrl, isSafeGamePath, isValidGameId, validateGameEntry, validateManifest } from '../manifest'

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'snake-demo', title: 'Snake Demo', tags: ['arcade', 'retro'], description: 'A tiny invented test game.',
  source: 'https://github.com/example/games', commit: 'abcdef1234567', licence: 'MIT', lang: 'en', author: 'Example Author',
  entry: 'index.html', players: 1, touch: true, added: '2026-10-29', ...over
})

describe('validateGameEntry', () => {
  it('accepts a complete entry', () => {
    const r = validateGameEntry(good())
    expect(r.ok).toBe(true)
  })
  it.each(['id', 'title', 'tags', 'description', 'source', 'commit', 'licence', 'lang', 'author', 'entry', 'players', 'touch', 'added'])('rejects a missing %s', (k) => {
    const g = good(); delete g[k]
    expect(validateGameEntry(g).ok).toBe(false)
  })
  it('rejects a licence that is not on the allowed list (GPL, no licence, unknown)', () => {
    for (const l of ['GPL-3.0', 'AGPL-3.0', 'CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'NONE', '', 'mit']) expect(validateGameEntry(good({ licence: l })).ok).toBe(false)
    for (const l of ALLOWED_LICENCES) expect(validateGameEntry(good({ licence: l })).ok).toBe(true)
  })
  it('rejects an entry outside its own folder', () => {
    for (const e of ['../x/index.html', '/index.html', 'a/../../b.html', 'C:/x.html', 'a\\b.html', 'a//b.html', 'index.html?x=1', './index.html', 'game.js']) expect(validateGameEntry(good({ entry: e })).ok).toBe(false)
    expect(validateGameEntry(good({ entry: 'play/index.html' })).ok).toBe(true)
  })
  it('rejects bad ids, tags, players, dates, shas and non-GitHub sources', () => {
    for (const id of ['_selftest', 'A-b', 'a', 'a b', '../x', '-ab']) expect(validateGameEntry(good({ id })).ok).toBe(false)
    expect(validateGameEntry(good({ tags: [] })).ok).toBe(false)
    expect(validateGameEntry(good({ tags: ['nope'] })).ok).toBe(false)
    expect(validateGameEntry(good({ tags: ['retro', 'retro'] })).ok).toBe(false)
    expect(validateGameEntry(good({ players: 3 })).ok).toBe(false)
    expect(validateGameEntry(good({ added: '29-10-2026' })).ok).toBe(false)
    expect(validateGameEntry(good({ commit: 'main' })).ok).toBe(false)
    expect(validateGameEntry(good({ source: 'http://example.com/x' })).ok).toBe(false)
    expect(validateGameEntry(null).ok).toBe(false)
    expect(validateGameEntry([]).ok).toBe(false)
  })
})

describe('validateManifest', () => {
  it('keeps good entries, skips and counts bad ones, drops duplicate ids (first wins)', () => {
    const r = validateManifest({ version: 1, games: [good(), good({ id: 'other-one', licence: 'GPL-3.0' }), good({ title: 'Second' }), good({ id: 'third-one' })] })
    expect(r.games.map((g) => g.id)).toEqual(['snake-demo', 'third-one'])
    expect(r.games[0]!.title).toBe('Snake Demo')
    expect(r.skipped).toBe(2)
    expect(r.problems).toHaveLength(2)
  })
  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { version: 2, games: [] }, { version: 1 }, { version: 1, games: 'x' }]) {
      const r = validateManifest(raw)
      expect(r.games).toEqual([])
    }
  })
})

describe('paths and urls', () => {
  it('isSafeGamePath / isValidGameId', () => {
    expect(isSafeGamePath('a/b.html')).toBe(true)
    expect(isSafeGamePath('..')).toBe(false)
    expect(isSafeGamePath('a/%2e%2e/b')).toBe(false)
    expect(isSafeGamePath(5)).toBe(false)
    expect(isValidGameId('abc')).toBe(true)
    expect(isValidGameId('_x1')).toBe(false)
  })
  it('gameUrl builds q3game://id/entry and refuses unsafe input', () => {
    expect(gameUrl('snake-demo', 'play/index.html')).toBe('q3game://snake-demo/play/index.html')
    expect(() => gameUrl('Bad Id', 'index.html')).toThrow()
    expect(() => gameUrl('ok-id', '../x.html')).toThrow()
  })
})

describe('lang (Phase 205, M20)', () => {
  it('accepts en and zh and nothing else', () => {
    expect(validateGameEntry(good({ lang: 'en' })).ok).toBe(true)
    const z = validateGameEntry(good({ lang: 'zh' }))
    expect(z.ok && z.entry.lang).toBe('zh')
    for (const l of ['EN', 'fr', '', null, 1, undefined]) expect(validateGameEntry(good({ lang: l })).ok).toBe(false)
  })
  it('a manifest entry without lang is skipped and counted', () => {
    const noLang = good({ id: 'no-lang' }); delete noLang.lang
    const r = validateManifest({ version: 1, games: [good(), noLang] })
    expect(r.games.map((g) => g.id)).toEqual(['snake-demo'])
    expect(r.skipped).toBe(1)
  })
})
