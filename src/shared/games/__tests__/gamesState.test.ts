import { describe, expect, it } from 'vitest'
import { GAMES_STATE_CAP, emptyGamesState, markPlayed, parseGamesState, pruneGamesState, serializeGamesState, toggleFavourite } from '../gamesState'

describe('parseGamesState', () => {
  it('turns garbage into an empty state without throwing', () => {
    for (const raw of [null, undefined, 5, 'not json', '[1,2]', '{"favourites":5}', [], true]) expect(parseGamesState(raw)).toEqual(emptyGamesState())
  })
  it('drops invalid parts and keeps valid ones', () => {
    const s = parseGamesState({
      favourites: ['snake', 'snake', '../x', 5, '_hid'],
      lastPlayed: { snake: '2026-10-29T10:00:00Z', bad: 'yesterday', 'Bad Id': '2026-10-29T10:00:00Z' },
      plays: { snake: 3, bad2: -1, other: 1.5, ok: 2 }
    })
    expect(s.favourites).toEqual(['snake'])
    expect(s.lastPlayed).toEqual({ snake: '2026-10-29T10:00:00Z' })
    expect(s.plays).toEqual({ snake: 3, ok: 2 })
  })
  it('accepts a JSON string and round-trips', () => {
    const s = markPlayed(toggleFavourite(emptyGamesState(), 'snake'), 'snake', '2026-10-29T10:00:00Z')
    expect(parseGamesState(serializeGamesState(s))).toEqual(s)
  })
  it('caps every list at 500', () => {
    const favourites = Array.from({ length: 700 }, (_, i) => `game-${i}`)
    const lastPlayed = Object.fromEntries(favourites.map((id, i) => [id, new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()]))
    const plays = Object.fromEntries(favourites.map((id) => [id, 1]))
    const s = parseGamesState({ favourites, lastPlayed, plays })
    expect(s.favourites).toHaveLength(GAMES_STATE_CAP)
    expect(Object.keys(s.lastPlayed)).toHaveLength(GAMES_STATE_CAP)
    expect(s.lastPlayed['game-699']).toBeDefined()
    expect(s.lastPlayed['game-0']).toBeUndefined()
    expect(Object.keys(s.plays).length).toBeLessThanOrEqual(GAMES_STATE_CAP)
  })
})

describe('updates', () => {
  it('pruneGamesState removes unknown ids everywhere', () => {
    const s = { favourites: ['a1', 'b2'], lastPlayed: { a1: '2026-10-29T10:00:00Z', b2: '2026-10-29T11:00:00Z' }, plays: { a1: 1, b2: 4 } }
    expect(pruneGamesState(s, ['b2'])).toEqual({ favourites: ['b2'], lastPlayed: { b2: '2026-10-29T11:00:00Z' }, plays: { b2: 4 } })
  })
  it('markPlayed counts plays and does not mutate the input', () => {
    const s = emptyGamesState()
    const a = markPlayed(s, 'snake', '2026-10-29T10:00:00Z')
    const b = markPlayed(a, 'snake', '2026-10-29T11:00:00Z')
    expect(s).toEqual(emptyGamesState())
    expect(b.plays.snake).toBe(2)
    expect(b.lastPlayed.snake).toBe('2026-10-29T11:00:00Z')
    expect(markPlayed(s, '../x', 'now')).toBe(s)
  })
  it('toggleFavourite adds then removes', () => {
    const a = toggleFavourite(emptyGamesState(), 'snake')
    expect(a.favourites).toEqual(['snake'])
    expect(toggleFavourite(a, 'snake').favourites).toEqual([])
    expect(toggleFavourite(a, '../x')).toBe(a)
  })
})
