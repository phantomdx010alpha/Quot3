import { useRef, type KeyboardEvent } from 'react'
import type { GameEntry } from '@shared/games/manifest'
import type { GamesState } from '@shared/games/gamesState'
import { GameCard } from './GameCard'

export interface GamesGridProps {
  games: readonly GameEntry[]
  state: GamesState
  onOpen: (g: GameEntry) => void
  onToggleFavourite: (id: string) => void
  /** Up from the first row goes back to the search box. */
  onLeaveTop: () => void
}

/** Phase 202: card grid. Tab goes card to card; arrows move too (Left / Right one card, Up / Down one row). */
export function GamesGrid({ games, state, onOpen, onToggleFavourite, onLeaveTop }: GamesGridProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return
    const target = e.target as HTMLElement
    if (!target.hasAttribute('data-game-open')) return
    const cards = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-game-open]') ?? [])
    const i = cards.indexOf(target)
    if (i < 0) return
    e.preventDefault()
    let cols = 1
    try { cols = Math.max(1, getComputedStyle(ref.current!).gridTemplateColumns.split(' ').filter((c) => c !== '').length) } catch { cols = 1 }
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols
    const j = i + step
    if (j < 0 && e.key === 'ArrowUp') { onLeaveTop(); return }
    cards[Math.min(cards.length - 1, Math.max(0, j))]?.focus()
  }
  const fav = new Set(state.favourites)
  return (
    <div ref={ref} className="q3-games__grid" role="list" aria-label="Games" onKeyDown={onKeyDown}>
      {games.map((g) => (
        <div key={g.id} role="listitem" className="q3-games__cell">
          <GameCard game={g} favourite={fav.has(g.id)} lastPlayed={state.lastPlayed[g.id]} onOpen={onOpen} onToggleFavourite={onToggleFavourite} />
        </div>
      ))}
    </div>
  )
}
