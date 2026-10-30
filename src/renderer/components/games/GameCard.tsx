import { Star } from '@phosphor-icons/react'
import type { GameEntry } from '@shared/games/manifest'
import { Icon } from '../ui'

export const TAG_LABELS: Record<string, string> = {
  puzzle: 'Puzzle', arcade: 'Arcade', card: 'Cards', board: 'Board', shooter: 'Shooter', word: 'Words', retro: 'Retro', 'two-player': 'Two players', chess: 'Chess', relaxing: 'Relaxing'
}

export interface GameCardProps {
  game: GameEntry
  favourite: boolean
  /** ISO time of the last play, or undefined. */
  lastPlayed?: string
  onOpen: (g: GameEntry) => void
  onToggleFavourite: (id: string) => void
}

const lastText = (iso: string | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `Last played ${d.toLocaleDateString()}`
}

/** One card: the whole card opens the game; the star is a separate button. Long titles wrap, never cut. */
export function GameCard({ game, favourite, lastPlayed, onOpen, onToggleFavourite }: GameCardProps): React.JSX.Element {
  const last = lastText(lastPlayed)
  return (
    <div className="q3-games__card nm-raised" data-game-id={game.id}>
      <button type="button" className="q3-games__open" data-game-open={game.id} onClick={() => onOpen(game)}>
        <span className="q3-games__title">{game.title}</span>
        <span className="q3-games__tags">
          {game.tags.map((t) => <span key={t} className="q3-games__tag">{TAG_LABELS[t] ?? t}</span>)}
          <span className="q3-games__tag">{game.players === 2 ? '2 players' : '1 player'}</span>
          {game.lang === 'zh' && <span className="q3-games__tag q3-games__tag--lang">Chinese</span>}
        </span>
        {last !== '' && <span className="q3-games__last">{last}</span>}
      </button>
      <button type="button" className={`q3-games__star${favourite ? ' q3-games__star--on' : ''}`} aria-pressed={favourite}
        aria-label={favourite ? `Remove ${game.title} from favourites` : `Add ${game.title} to favourites`} onClick={() => onToggleFavourite(game.id)}>
        <Icon icon={Star} weight={favourite ? 'bold' : 'light'} size="md" />
      </button>
    </div>
  )
}
