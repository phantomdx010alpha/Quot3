// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GamesSection } from '../GamesSection'
import { CHESS_NOTICES } from '../../games/GamesCredits'
import { useGamesStore } from '../../../stores/gamesStore'
import { emptyGamesState } from '@shared/games/gamesState'
import { SETTINGS_SECTIONS } from '../../../stores/settingsStore'
import { game, installApi, type FakeApi } from '../../games/__tests__/gamesHelpers'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let api: FakeApi
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const show = async (): Promise<void> => { await act(async () => { root.render(createElement(GamesSection)) }); await flush(); await flush() }
const btn = (t: string): HTMLButtonElement => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(t))!
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }

beforeEach(() => {
  useGamesStore.setState({ enabled: true, status: 'idle', error: '', games: [], skipped: 0, state: emptyGamesState(), playing: null, frameKey: 0 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Settings > Games', () => {
  it('is listed as a settings section', () => {
    expect(SETTINGS_SECTIONS.some((s) => s.id === 'games' && s.label === 'Games')).toBe(true)
  })

  it('shows the game count, the skipped count and the no-internet sentence', async () => {
    api = installApi([game('a-game', 'A'), game('b-game', 'B')], { skipped: 2 })
    await show()
    expect(host.textContent).toContain('2 games are installed.')
    expect(host.textContent).toContain('2 catalogue entries were skipped')
    expect(host.textContent).toContain('Games run on your PC only and never use the internet.')
  })

  it('the switch writes games.enabled and the store follows', async () => {
    api = installApi([game('a-game', 'A')])
    await show()
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(box.checked).toBe(true)
    await click(box)
    expect(api.settings.set).toHaveBeenCalledWith('games.enabled', false)
    expect(useGamesStore.getState().enabled).toBe(false)
  })

  it('Clear favourites and history asks first, then saves an empty state', async () => {
    api = installApi([game('a-game', 'A')], { state: { favourites: ['a-game'], lastPlayed: { 'a-game': '2026-10-29T10:00:00.000Z' }, plays: { 'a-game': 3 } } })
    await show()
    await click(btn('Clear favourites and history'))
    expect(api.games.setState).not.toHaveBeenCalled()
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Clear')!)
    expect(api.games.setState).toHaveBeenCalledWith({ favourites: [], lastPlayed: {}, plays: {} })
    expect(document.body.textContent).toContain('Favourites and history cleared.')
  })

  it('Credits lists every game with author, licence and commit, and a click opens the full licence text', async () => {
    api = installApi([game('a-game', 'Alpha'), game('b-game', 'Beta')])
    await show()
    await click(btn('Credits and licences'))
    const rows = [...document.body.querySelectorAll<HTMLElement>('[data-credit-id]')]
    expect(rows.map((r) => r.dataset.creditId)).toEqual(['a-game', 'b-game'])
    expect(rows[0]!.textContent).toContain('Test Author')
    expect(rows[0]!.textContent).toContain('MIT')
    expect(rows[0]!.textContent).toContain('commit abcdef123456')
    await click(rows[1]!)
    expect(api.games.getLicense).toHaveBeenCalledWith('b-game')
    expect(document.body.querySelector('pre')?.textContent).toBe('LICENSE TEXT for b-game')
    await click(btn('Back to the list'))
    for (const n of CHESS_NOTICES) expect(document.body.textContent).toContain(n.name)
    expect(document.body.textContent).toContain('Unicode chess symbols')
  })
})
