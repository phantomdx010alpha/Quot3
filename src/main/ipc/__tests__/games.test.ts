import { describe, expect, it, vi } from 'vitest'
import type { GameCatalog } from '../../games/gameCatalog'
import type { GameEntry } from '../../../shared/games/manifest'
import { gamesHandlers } from '../games'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../../../shared/settings'

const mk = (id: string): GameEntry => ({ id, title: id.toUpperCase(), tags: ['arcade'], description: 'd', source: 'https://github.com/e/g', commit: 'abcdef1', licence: 'MIT', lang: 'en', author: 'A', entry: 'index.html', players: 1, touch: false, added: '2026-10-29' })
const LIST = [mk('snake'), mk('chess'), mk('memory')]
const catalog = (games: GameEntry[] = LIST): GameCatalog => ({
  list: () => ({ games, skipped: 2, problems: [] }), reload: () => ({ games, skipped: 2, problems: [] }),
  get: (id) => games.find((g) => g.id === id) ?? null,
  credits: () => games.map((g) => ({ id: g.id, title: g.title, author: g.author, source: g.source, licence: g.licence, commit: g.commit })),
  license: (id) => (games.some((g) => g.id === id) ? `licence ${id}` : null)
})
type R = { ok: boolean; data?: any; error?: { code: string } }
const setup = (stored: unknown = undefined, games?: GameEntry[], rng?: () => number, showChinese?: unknown) => {
  let value = stored
  const writeState = vi.fn((json: string) => { value = JSON.parse(json) })
  const h = gamesHandlers({ catalog: catalog(games), readState: () => value, writeState, ...(rng ? { rng } : {}), ...(showChinese !== undefined ? { readShowChinese: () => showChinese } : {}) })
  return { h, writeState, stored: () => value }
}

describe('games IPC', () => {
  it('registers exactly the six channels', () => {
    expect(Object.keys(setup().h).sort()).toEqual(['games:getCredits', 'games:getLicense', 'games:getState', 'games:list', 'games:pickRandom', 'games:setState'])
  })
  it('list returns the games and the skipped count; garbage input is refused', async () => {
    const { h } = setup()
    const r = (await h['games:list']!({})) as R
    expect(r.data.games).toHaveLength(3)
    expect(r.data.skipped).toBe(2)
    expect(((await h['games:list']!({ x: 1 })) as R).ok).toBe(false)
    expect(((await h['games:list']!(null)) as R).ok).toBe(false)
  })
  it('getState reads garbage safely and prunes ids that are not in the catalogue', async () => {
    expect(((await setup('not json').h['games:getState']!({})) as R).data).toEqual({ favourites: [], lastPlayed: {}, plays: {} })
    const s = setup({ favourites: ['snake', 'gone'], lastPlayed: { gone: '2026-10-29T10:00:00Z' }, plays: { snake: 2 } })
    expect(((await s.h['games:getState']!({})) as R).data).toEqual({ favourites: ['snake'], lastPlayed: {}, plays: { snake: 2 } })
  })
  it('setState validates strictly, sanitises, prunes, stores once and returns the clean state', async () => {
    const { h, writeState, stored } = setup()
    const r = (await h['games:setState']!({ favourites: ['snake', '../x', 'gone'], lastPlayed: { chess: '2026-10-29T10:00:00Z', bad: 'yesterday' }, plays: { chess: 3, snake: -1 } })) as R
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ favourites: ['snake'], lastPlayed: { chess: '2026-10-29T10:00:00Z' }, plays: { chess: 3 } })
    expect(writeState).toHaveBeenCalledTimes(1)
    expect(stored()).toEqual(r.data)
  })
  it('setState rejects extra keys, wrong types and oversize lists without writing', async () => {
    const { h, writeState } = setup()
    const ok = { favourites: [], lastPlayed: {}, plays: {} }
    for (const bad of [{ ...ok, extra: 1 }, { ...ok, favourites: 'x' }, { ...ok, favourites: Array.from({ length: 501 }, (_, i) => `g${i}`) }, { ...ok, plays: { snake: 'x' } }, null, 5]) {
      expect(((await h['games:setState']!(bad)) as R).ok).toBe(false)
    }
    expect(writeState).not.toHaveBeenCalled()
  })
  it('pickRandom: deterministic with an injected rng, never the last played game, null for an empty catalogue', async () => {
    const st = { favourites: [], lastPlayed: { snake: '2026-10-29T10:00:00Z' }, plays: { snake: 1 } }
    for (const v of [0, 0.3, 0.6, 0.999]) expect(((await setup(st, undefined, () => v).h['games:pickRandom']!({})) as R).data.id).not.toBe('snake')
    expect(((await setup(undefined, LIST, () => 0).h['games:pickRandom']!({})) as R).data.id).toBe('snake')
    expect(((await setup(undefined, []).h['games:pickRandom']!({})) as R)).toEqual({ ok: true, data: null })
  })
  it('getCredits and getLicense; unknown or malformed id is refused', async () => {
    const { h } = setup()
    expect(((await h['games:getCredits']!({})) as R).data.map((c: { id: string }) => c.id)).toEqual(['snake', 'chess', 'memory'])
    expect(((await h['games:getLicense']!({ id: 'chess' })) as R).data).toEqual({ text: 'licence chess' })
    expect(((await h['games:getLicense']!({ id: 'nope' })) as R).error?.code).toBe('NOT_FOUND')
    for (const id of ['../x', '', 'A B', 5]) expect(((await h['games:getLicense']!({ id })) as R).ok).toBe(false)
    expect(((await h['games:getLicense']!({ id: 'chess', extra: 1 })) as R).ok).toBe(false)
  })
})

describe('games settings defaults', () => {
  it('games.enabled is ON and games.state is empty by default; keys are valid setting keys', () => {
    expect(SETTING_DEFAULTS['games.enabled']).toBe(true)
    expect(SETTING_DEFAULTS['games.state']).toEqual({ favourites: [], lastPlayed: {}, plays: {} })
    expect(SETTING_KEY_RE.test('games.enabled')).toBe(true)
    expect(SETTING_KEY_RE.test('games.state')).toBe(true)
    expect(SETTING_KEY_RE.test('games.showChinese')).toBe(true)
    expect(SETTING_DEFAULTS['games.showChinese']).toBe(false)
  })
})

describe('games:pickRandom language rule (Phase 205, M20)', () => {
  const ZH = [{ ...mk('cat-seesaw'), lang: 'zh' as const }, { ...mk('beat-bento'), lang: 'zh' as const }]
  const MIXED = [...ZH, mk('snake'), mk('chess')]
  it('never picks a Chinese game while games.showChinese is off, missing or not exactly true', async () => {
    for (const flag of [undefined, false, 'true', 1, null]) {
      for (const v of [0, 0.2, 0.5, 0.8, 0.999]) {
        const r = (await setup(undefined, MIXED, () => v, flag).h['games:pickRandom']!({})) as R
        expect(['snake', 'chess']).toContain(r.data.id)
      }
    }
  })
  it('can pick any game when the switch is on', async () => {
    const ids = new Set<string>()
    for (const v of [0, 0.3, 0.6, 0.99]) ids.add((((await setup(undefined, MIXED, () => v, true).h['games:pickRandom']!({})) as R).data.id))
    expect([...ids].some((i) => i === 'cat-seesaw' || i === 'beat-bento')).toBe(true)
  })
  it('gives null when only Chinese games exist and the switch is off; the list channel still returns every game', async () => {
    expect(((await setup(undefined, ZH, () => 0, false).h['games:pickRandom']!({})) as R)).toEqual({ ok: true, data: null })
    expect((((await setup(undefined, MIXED).h['games:list']!({})) as R).data.games)).toHaveLength(4)
  })
})
