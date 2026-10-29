// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Games from '../../../pages/Games'
import { useGamesStore } from '../../../stores/gamesStore'
import { emptyGamesState } from '@shared/games/gamesState'
import { NAV_ITEMS, visibleNavItems } from '../../layout/navItems'
import { ROUTES } from '@shared/routes'
import { game, installApi, type FakeApi } from './gamesHelpers'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let api: FakeApi
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const show = async (): Promise<void> => { await act(async () => { root.render(createElement(Games)) }); await flush(); await flush() }
const type = async (el: HTMLInputElement, v: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const titles = (): string[] => [...host.querySelectorAll('.q3-games__card .q3-games__title')].map((e) => e.textContent ?? '')
const LONG = 'A very long game title that keeps going and going so that it must wrap onto several lines instead of being cut off at the card edge'

beforeEach(() => {
  useGamesStore.setState({ enabled: true, status: 'idle', error: '', games: [], skipped: 0, state: emptyGamesState(), playing: null, frameKey: 0 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Games page', () => {
  it('lists the games, focuses the search box on arrival and filters by search text', async () => {
    api = installApi([game('chess', 'Chess', { tags: ['chess', 'board'] }), game('snake', 'Snake', { tags: ['arcade'] }), game('merge', 'Merge Cats')])
    await show()
    expect(titles().sort()).toEqual(['Chess', 'Merge Cats', 'Snake'])
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="Search games"]'))
    await type(host.querySelector('input[aria-label="Search games"]')!, 'snak')
    expect(titles()).toEqual(['Snake'])
  })

  it('tag chips filter and a second click clears the filter', async () => {
    api = installApi([game('chess', 'Chess', { tags: ['chess', 'board'] }), game('snake', 'Snake', { tags: ['arcade'] })])
    await show()
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.q3-games__chip')].find((b) => b.textContent?.trim() === 'Arcade')!
    await act(async () => { chip.click() })
    expect(titles()).toEqual(['Snake'])
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await act(async () => { chip.click() })
    expect(titles()).toHaveLength(2)
  })

  it('the star saves through games:setState and Favourites then shows only that game', async () => {
    api = installApi([game('chess', 'Chess'), game('snake', 'Snake')])
    await show()
    const star = host.querySelector<HTMLButtonElement>('button[aria-label="Add Snake to favourites"]')!
    await act(async () => { star.click() }); await flush()
    expect(api.games.setState!.mock.calls[0]![0].favourites).toEqual(['snake'])
    expect(host.querySelector('button[aria-label="Remove Snake from favourites"]')?.getAttribute('aria-pressed')).toBe('true')
    const fav = [...host.querySelectorAll<HTMLButtonElement>('.q3-games__chip')].find((b) => b.textContent?.includes('Favourites'))!
    await act(async () => { fav.click() })
    expect(titles()).toEqual(['Snake'])
  })

  it('a long title is shown in full (wraps, no ellipsis or nowrap)', async () => {
    api = installApi([game('long', LONG)])
    await show()
    const t = host.querySelector<HTMLElement>('.q3-games__title')!
    expect(t.textContent).toBe(LONG)
    expect(t.getAttribute('style') ?? '').not.toMatch(/nowrap|ellipsis/)
  })

  it('shows plain-word empty states: no games installed, and nothing found', async () => {
    api = installApi([])
    await show()
    expect(host.textContent).toContain('No games are installed')
    expect(host.querySelector('button[aria-label="Add x to favourites"]')).toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    api = installApi([game('chess', 'Chess')])
    await show()
    await type(host.querySelector('input[aria-label="Search games"]')!, 'zzzzqqqq')
    expect(host.textContent).toContain('No games found')
  })

  it('Random game opens the game the main process picked and records it as played', async () => {
    api = installApi([game('chess', 'Chess')])
    await show()
    const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes('Random game'))!
    await act(async () => { b.click() }); await flush()
    expect(api.games.pickRandom).toHaveBeenCalled()
    expect(useGamesStore.getState().playing?.id).toBe('chess')
    expect(host.querySelector('iframe')?.getAttribute('src')).toBe('q3game://chess/index.html')
  })

  it('when games are off the page says so, and the nav item is hidden', async () => {
    api = installApi([game('chess', 'Chess')], { enabled: false })
    await show()
    expect(host.textContent).toContain('Games are turned off')
    expect(host.querySelector('.q3-games__card')).toBeNull()
    expect(visibleNavItems(NAV_ITEMS, false).some((i) => i.path === ROUTES.games)).toBe(false)
    expect(visibleNavItems(NAV_ITEMS, true).some((i) => i.path === ROUTES.games)).toBe(true)
    expect(visibleNavItems(NAV_ITEMS, false).map((i) => i.path)).toEqual(NAV_ITEMS.filter((i) => i.path !== ROUTES.games).map((i) => i.path))
  })

  it('a load failure is explained in words with a Try again button', async () => {
    api = installApi([])
    api.games.list!.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'The game list could not be read.' } })
    await show()
    expect(host.textContent).toContain('Games could not be loaded')
    expect(host.textContent).toContain('Try again')
  })
})
