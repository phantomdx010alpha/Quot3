// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayTiles } from '../TodayTiles'
import { useGamesStore } from '../../../stores/gamesStore'
import { useRouter } from '../../../router/routerStore'
import { emptyGamesState } from '@shared/games/gamesState'
import { DASH_TILE_KEYS, DEFAULT_DASH_TILES, normalizeTiles } from '@shared/dashboard/live'
import { ROUTES, currentPath } from '@shared/routes'
import { game, installApi, type FakeApi } from '../../games/__tests__/gamesHelpers'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: FakeApi
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const live = { ok: true as const, data: { ok: false, data: null, fetchedAt: null, offline: true, source: '' } }

async function mount(games = [game('chess', 'Chess')], opts: { enabled?: boolean; tiles?: Record<string, boolean> } = {}): Promise<void> {
  api = installApi(games, { enabled: opts.enabled ?? true })
  const q = (window as unknown as { quot3: Record<string, unknown> }).quot3
  q.dashboard = {
    getTiles: vi.fn(async () => ({ ok: true as const, data: { ...DEFAULT_DASH_TILES, ...(opts.tiles ?? {}) } })),
    weather: vi.fn(async () => live), rates: vi.fn(async () => live), metals: vi.fn(async () => live)
  }
  await act(async () => { root.render(createElement(TodayTiles)) }); await flush(); await flush()
}
const tiles = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-tile]')]
const tile = (): HTMLElement | null => host.querySelector<HTMLElement>('[data-tile="games"]')

beforeEach(() => {
  useGamesStore.setState({ enabled: true, status: 'idle', error: '', games: [], skipped: 0, state: emptyGamesState(), playing: null, frameKey: 0 })
  useRouter.setState({ nav: { stack: ['/'] } } as never)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true })
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('"(?)" Dashboard tile (Phase 203)', () => {
  it('the visible text is exactly "(?)" and nothing else; the button is named "Random game"', async () => {
    await mount()
    expect(tile()!.textContent).toBe('(?)')
    const b = tile()!.querySelector('button')!
    expect(b.getAttribute('aria-label')).toBe('Random game')
    expect(tile()!.querySelector('svg, img')).toBeNull()
    expect(tiles()).toHaveLength(7)
    expect(tiles().at(-1)).toBe(tile())
  })

  it('click opens a random game in the player and the Games page', async () => {
    await mount()
    await act(async () => { tile()!.querySelector('button')!.click() }); await flush()
    expect(api.games.pickRandom).toHaveBeenCalledTimes(1)
    expect(useGamesStore.getState().playing?.id).toBe('chess')
    expect(api.games.setState).toHaveBeenCalled()
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.games)
  })

  it('is a real focusable button (Enter and Space activate it natively)', async () => {
    await mount()
    const b = tile()!.querySelector('button')!
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    b.focus()
    expect(document.activeElement).toBe(b)
  })

  it('is hidden when Games is switched off, and the others re-flow to six', async () => {
    await mount([game('chess', 'Chess')], { enabled: false })
    expect(tile()).toBeNull()
    expect(tiles()).toHaveLength(6)
  })

  it('is hidden when the catalogue is empty', async () => {
    await mount([])
    expect(tile()).toBeNull()
    expect(tiles()).toHaveLength(6)
  })

  it('is hidden when its own Settings switch is off', async () => {
    await mount([game('chess', 'Chess')], { tiles: { games: false } })
    expect(tile()).toBeNull()
  })

  it('an old stored dash.tiles without "games" reads as the default and keeps the other six', () => {
    const old = { weather: true, usd: false, majors: true, metals: true, clock: true, holidays: false }
    const n = normalizeTiles(old)
    expect(n.games).toBe(true)
    expect(DASH_TILE_KEYS.filter((k) => k !== 'games').map((k) => n[k])).toEqual([true, false, true, true, true, false])
  })
})
