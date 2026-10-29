// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GamePlayer, GAME_FRAME_SANDBOX } from '../GamePlayer'
import { useGamesStore } from '../../../stores/gamesStore'
import { closeGame, openGame, restartGame } from '../../../stores/gamesActions'
import { emptyGamesState } from '@shared/games/gamesState'
import { game, installApi, type FakeApi } from './gamesHelpers'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let api: FakeApi
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const g = game('chess', 'Chess', { entry: 'play/index.html' })
const btn = (t: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t))!

beforeEach(() => {
  useGamesStore.setState({ enabled: true, status: 'ready', error: '', games: [g], skipped: 0, state: emptyGamesState(), playing: null, frameKey: 0 })
  api = installApi([g])
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('GamePlayer', () => {
  it('the frame loads q3game://<id>/<entry> with exactly the allowed sandbox flags', async () => {
    await act(async () => { root.render(createElement(GamePlayer, { game: g, frameKey: 0, onBack: vi.fn(), onRestart: vi.fn() })) })
    const f = host.querySelector('iframe')!
    expect(f.getAttribute('src')).toBe('q3game://chess/play/index.html')
    expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-pointer-lock allow-forms')
    expect(GAME_FRAME_SANDBOX.split(' ').sort()).toEqual(['allow-forms', 'allow-pointer-lock', 'allow-same-origin', 'allow-scripts'])
    expect(f.getAttribute('title')).toBe('Chess')
    // the top bar is outside the frame
    expect(host.querySelector('.q3-games__bar')?.contains(f)).toBe(false)
    expect(host.querySelector('.q3-games__playing')?.textContent).toBe('Chess')
  })

  it('Back and Restart buttons call their handlers', async () => {
    const onBack = vi.fn(); const onRestart = vi.fn()
    await act(async () => { root.render(createElement(GamePlayer, { game: g, frameKey: 0, onBack, onRestart })) })
    await act(async () => { btn('Back to games').click() })
    await act(async () => { btn('Restart').click() })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('a new frameKey creates the frame again (Restart reloads the game)', async () => {
    const render = async (k: number): Promise<void> => { await act(async () => { root.render(createElement(GamePlayer, { game: g, frameKey: k, onBack: vi.fn(), onRestart: vi.fn() })) }) }
    await render(0)
    const first = host.querySelector('iframe')
    await render(0)
    expect(host.querySelector('iframe')).toBe(first)
    restartGame()
    expect(useGamesStore.getState().frameKey).toBe(1)
    await render(1)
    expect(host.querySelector('iframe')).not.toBe(first)
  })

  it('the games:leave event (Alt+Left from the main process) closes the player, and the listener is removed on unmount', async () => {
    const onBack = vi.fn()
    await act(async () => { root.render(createElement(GamePlayer, { game: g, frameKey: 0, onBack, onRestart: vi.fn() })) })
    expect(api.on).toHaveBeenCalledWith('games:leave', expect.any(Function))
    api.listeners['games:leave']!({})
    expect(onBack).toHaveBeenCalledTimes(1)
    act(() => root.unmount()); root = createRoot(host)
    expect(api.listeners['games:leave']).toBeUndefined()
  })

  it('opening a game updates games.state (last played + count) through games:setState; closing clears playing', async () => {
    await openGame(g); await flush()
    const sent = api.games.setState!.mock.calls[0]![0]
    expect(sent.plays).toEqual({ chess: 1 })
    expect(Date.parse(sent.lastPlayed.chess)).not.toBeNaN()
    expect(useGamesStore.getState().playing?.id).toBe('chess')
    await openGame(g); await flush()
    expect(api.games.setState!.mock.calls[1]![0].plays).toEqual({ chess: 2 })
    closeGame()
    expect(useGamesStore.getState().playing).toBeNull()
  })

  it('an entry that gameUrl refuses shows a plain message instead of a frame', async () => {
    const bad = { ...g, entry: '../escape.html' }
    await act(async () => { root.render(createElement(GamePlayer, { game: bad, frameKey: 0, onBack: vi.fn(), onRestart: vi.fn() })) })
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.textContent).toContain('could not be opened')
  })
})
