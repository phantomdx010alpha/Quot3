import { describe, expect, it } from 'vitest'
import type { GameEntry } from '../manifest'
import { emptyGamesState } from '../gamesState'
import { filterByLanguage, pickRandom, searchGames, sortGames } from '../search'

const mk = (id: string, title: string, tags: GameEntry['tags'], description: string, players: 1 | 2 = 1): GameEntry => ({
  id, title, tags, description, source: 'https://github.com/example/games', commit: 'abcdef1', licence: 'MIT', lang: 'en', author: 'A', entry: 'index.html', players, touch: false, added: '2026-10-29'
})
const LIST = [
  mk('snake', 'Snake', ['arcade', 'retro'], 'Eat and grow.'),
  mk('chess', 'Chess', ['board', 'chess', 'two-player'], 'Classic board game.', 2),
  mk('mines', 'Minesweeper', ['puzzle'], 'Clear the field without a blast.'),
  mk('memory', 'Memory', ['puzzle', 'relaxing'], 'Match the pairs.'),
  mk('blocks', 'Blocks', ['arcade'], 'Falling blocks.')
]

describe('sortGames', () => {
  it('is A-Z with an empty state, favourites first, then recent', () => {
    expect(sortGames(LIST).map((g) => g.id)).toEqual(['blocks', 'chess', 'memory', 'mines', 'snake'])
    const st = { favourites: ['snake'], lastPlayed: { mines: '2026-10-29T10:00:00Z', memory: '2026-10-28T10:00:00Z' }, plays: {} }
    expect(sortGames(LIST, st).map((g) => g.id)).toEqual(['snake', 'mines', 'memory', 'blocks', 'chess'])
  })
  it('does not change its input', () => {
    const copy = [...LIST]
    sortGames(LIST, { ...emptyGamesState(), favourites: ['snake'] })
    expect(LIST).toEqual(copy)
  })
})

describe('searchGames', () => {
  it('an empty query returns everything, sorted; whitespace counts as empty', () => {
    expect(searchGames(LIST, '').length).toBe(5)
    expect(searchGames(LIST, '   ').map((g) => g.id)).toEqual(sortGames(LIST).map((g) => g.id))
  })
  it('tolerates typos', () => {
    expect(searchGames(LIST, 'snaek')[0]?.id).toBe('snake')
    expect(searchGames(LIST, 'minesweper')[0]?.id).toBe('mines')
    expect(searchGames(LIST, 'ches')[0]?.id).toBe('chess')
  })
  it('matches tags and descriptions', () => {
    expect(searchGames(LIST, 'relaxing').map((g) => g.id)).toContain('memory')
    expect(searchGames(LIST, 'pairs').map((g) => g.id)).toContain('memory')
  })
  it('returns nothing for a query that matches nothing', () => {
    expect(searchGames(LIST, 'zzzzqqqq')).toEqual([])
  })
  it('filters by tags (all must match), players and favourites / recent', () => {
    expect(searchGames(LIST, '', { tags: ['puzzle'] }).map((g) => g.id).sort()).toEqual(['memory', 'mines'])
    expect(searchGames(LIST, '', { tags: ['puzzle', 'relaxing'] }).map((g) => g.id)).toEqual(['memory'])
    expect(searchGames(LIST, '', { players: 2 }).map((g) => g.id)).toEqual(['chess'])
    const st = { favourites: ['blocks'], lastPlayed: { mines: '2026-10-29T10:00:00Z' }, plays: {} }
    expect(searchGames(LIST, '', { onlyFavourites: true }, st).map((g) => g.id)).toEqual(['blocks'])
    expect(searchGames(LIST, '', { onlyRecent: true }, st).map((g) => g.id)).toEqual(['mines'])
  })
  it('puts favourites first on an empty query', () => {
    const st = { favourites: ['mines'], lastPlayed: {}, plays: {} }
    expect(searchGames(LIST, '', {}, st)[0]?.id).toBe('mines')
  })
})

describe('pickRandom', () => {
  it('returns null for an empty list and the only game for a one-game list', () => {
    expect(pickRandom([], emptyGamesState())).toBeNull()
    expect(pickRandom([LIST[0]!], { favourites: [], lastPlayed: { snake: '2026-10-29T00:00:00Z' }, plays: {} })?.id).toBe('snake')
  })
  it('never repeats the last played game when more than one exists, whatever the rng gives', () => {
    const st = { favourites: [], lastPlayed: { snake: '2026-10-29T10:00:00Z', chess: '2026-10-28T10:00:00Z' }, plays: {} }
    for (let i = 0; i <= 100; i++) expect(pickRandom(LIST, st, () => i / 100 === 1 ? 0.999999 : i / 100)?.id).not.toBe('snake')
  })
  it('is deterministic with a fixed rng and covers the pool', () => {
    const st = emptyGamesState()
    expect(pickRandom(LIST, st, () => 0)?.id).toBe('snake')
    expect(pickRandom(LIST, st, () => 0.999999)?.id).toBe('blocks')
    expect(pickRandom(LIST, st, () => 0.5)?.id).toBe(pickRandom(LIST, st, () => 0.5)?.id)
    const seen = new Set(LIST.map((_, i) => pickRandom(LIST, st, () => i / LIST.length)?.id))
    expect(seen.size).toBe(LIST.length)
  })
  it('survives a broken rng', () => {
    expect(pickRandom(LIST, emptyGamesState(), () => NaN)?.id).toBe('snake')
    expect(pickRandom(LIST, emptyGamesState(), () => 5)?.id).toBe('blocks')
    expect(pickRandom(LIST, emptyGamesState(), () => -1)?.id).toBe('snake')
  })
})

describe('filterByLanguage (Phase 205, M20)', () => {
  const zh = (id: string, title: string): GameEntry => ({ ...mk(id, title, ['puzzle'], 'Interface is in Chinese.'), lang: 'zh' })
  const MIXED = [mk('snake', 'Snake', ['arcade'], 'Eat and grow.'), zh('cat-seesaw', 'Cat Seesaw'), mk('chess', 'Chess', ['chess'], 'Board.'), zh('beat-bento', 'Beat Bento')]
  it('keeps English games only when the switch is off, everything when on, and never changes the input', () => {
    const copy = [...MIXED]
    expect(filterByLanguage(MIXED, false).map((g) => g.id)).toEqual(['snake', 'chess'])
    expect(filterByLanguage(MIXED, true).map((g) => g.id)).toEqual(['snake', 'cat-seesaw', 'chess', 'beat-bento'])
    expect(MIXED).toEqual(copy)
  })
  it('search, sort and random on the filtered list can never return a hidden game', () => {
    const vis = filterByLanguage(MIXED, false)
    expect(searchGames(vis, 'seesaw').map((g) => g.id)).toEqual([])
    expect(sortGames(vis).every((g) => g.lang === 'en')).toBe(true)
    for (const v of [0, 0.25, 0.5, 0.75, 0.999]) expect(pickRandom(vis, emptyGamesState(), () => v)!.lang).toBe('en')
  })
  it('state of hidden games is kept: a favourite zh game is not in the list but is back when shown', () => {
    const st = { favourites: ['cat-seesaw'], lastPlayed: {}, plays: {} }
    expect(searchGames(filterByLanguage(MIXED, false), '', { onlyFavourites: true }, st)).toEqual([])
    expect(searchGames(filterByLanguage(MIXED, true), '', { onlyFavourites: true }, st).map((g) => g.id)).toEqual(['cat-seesaw'])
  })
  it('an empty visible list gives no random pick', () => {
    expect(pickRandom(filterByLanguage([zh('a-b', 'AB')], false))).toBeNull()
  })
})
