import { useEffect, useMemo, useRef, useState } from 'react'
import { GameController, Shuffle, Star, Clock } from '@phosphor-icons/react'
import { GAME_TAGS, type GameEntry, type GameTag } from '@shared/games/manifest'
import { searchGames } from '@shared/games/search'
import { Button, EmptyState } from '../components/ui'
import { GamesSearch } from '../components/games/GamesSearch'
import { GamesGrid } from '../components/games/GamesGrid'
import { GamePlayer } from '../components/games/GamePlayer'
import { GamesCredits } from '../components/games/GamesCredits'
import { TAG_LABELS } from '../components/games/GameCard'
import { useGamesStore } from '../stores/gamesStore'
import { closeGame, loadGames, loadGamesEnabled, openGame, openRandomGame, restartGame, toggleFavourite } from '../stores/gamesActions'
import { useRouter } from '../router/routerStore'
import { ROUTES } from '@shared/routes'

/**
 * Phase 202 - Games page: search (focused on arrival), tag chips, Favourites / Recently played, Random game, card grid, and the player.
 * Esc with the focus on this page follows the Dashboard-rooted model; keys typed inside a game go to the game only.
 */
export default function Games(): React.JSX.Element {
  const enabled = useGamesStore((s) => s.enabled)
  const status = useGamesStore((s) => s.status)
  const error = useGamesStore((s) => s.error)
  const games = useGamesStore((s) => s.games)
  const skipped = useGamesStore((s) => s.skipped)
  const state = useGamesStore((s) => s.state)
  const playing = useGamesStore((s) => s.playing)
  const frameKey = useGamesStore((s) => s.frameKey)
  const navigate = useRouter((s) => s.navigate)
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<GameTag[]>([])
  const [onlyFav, setOnlyFav] = useState(false)
  const [onlyRecent, setOnlyRecent] = useState(false)
  const [credits, setCredits] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const gridWrap = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    void loadGamesEnabled()
    void loadGames()
    return () => {
      mounted.current = false
      // Leaving the page ends the game; the deferred check keeps React's dev double-mount from ending a game opened by the "(?)" tile.
      setTimeout(() => { if (!mounted.current) closeGame() }, 0)
    }
  }, [])
  useEffect(() => { if (!playing) searchRef.current?.focus() }, [playing, status])

  const shown = useMemo(
    () => searchGames(games, query, { ...(tags.length > 0 ? { tags } : {}), ...(onlyFav ? { onlyFavourites: true } : {}), ...(onlyRecent ? { onlyRecent: true } : {}) }, state),
    [games, query, tags, onlyFav, onlyRecent, state]
  )
  const toggleTag = (t: GameTag): void => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  const focusGrid = (): void => { gridWrap.current?.querySelector<HTMLElement>('[data-game-open]')?.focus() }
  const open = (g: GameEntry): void => { void openGame(g) }

  if (!enabled) {
    return (
      <div className="q3-page q3-games">
        <h1 className="q3-page__title">Games</h1>
        <EmptyState icon={GameController} title="Games are turned off" description="Turn them on in Settings, under Games."
          action={<Button onClick={() => navigate(ROUTES.settings)}>Open Settings</Button>} />
      </div>
    )
  }
  if (playing) {
    return (
      <div className="q3-page q3-games q3-games--playing">
        <GamePlayer game={playing} frameKey={frameKey} onBack={closeGame} onRestart={restartGame} />
      </div>
    )
  }
  return (
    <div className="q3-page q3-games">
      <h1 className="q3-page__title">Games</h1>
      <div className="q3-games__head">
        <GamesSearch ref={searchRef} value={query} onChange={setQuery} onEnterGrid={focusGrid} />
        <Button icon={Shuffle} onClick={() => { void openRandomGame() }} disabled={games.length === 0}>Random game</Button>
      </div>
      <div className="q3-games__chips" role="group" aria-label="Filter games">
        <button type="button" className="q3-games__chip" aria-pressed={onlyFav} onClick={() => setOnlyFav((v) => !v)}><Star size={14} weight="bold" /> Favourites</button>
        <button type="button" className="q3-games__chip" aria-pressed={onlyRecent} onClick={() => setOnlyRecent((v) => !v)}><Clock size={14} weight="bold" /> Recently played</button>
        {GAME_TAGS.map((t) => (
          <button key={t} type="button" className="q3-games__chip" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>{TAG_LABELS[t] ?? t}</button>
        ))}
      </div>
      {error !== '' && <p role="alert" className="q3-games__err">{error}</p>}
      <div ref={gridWrap} className="q3-games__body">
        {status === 'loading' && games.length === 0 ? (
          <EmptyState icon={GameController} title="Loading games" description="One moment." />
        ) : status === 'error' && games.length === 0 ? (
          <EmptyState icon={GameController} title="Games could not be loaded" description={error || 'Try again from Settings, under Games.'} action={<Button onClick={() => { void loadGames() }}>Try again</Button>} />
        ) : games.length === 0 ? (
          <EmptyState icon={GameController} title="No games are installed" description="This copy of Quot3 has no games." />
        ) : shown.length === 0 ? (
          <EmptyState icon={GameController} title="No games found" description={onlyFav && state.favourites.length === 0 ? 'You have no favourites yet. Tap the star on a game to add one.' : 'Nothing matches. Clear the search or the filters.'}
            action={<Button onClick={() => { setQuery(''); setTags([]); setOnlyFav(false); setOnlyRecent(false) }}>Clear search and filters</Button>} />
        ) : (
          <GamesGrid games={shown} state={state} onOpen={open} onToggleFavourite={(id) => { void toggleFavourite(id) }} onLeaveTop={() => searchRef.current?.focus()} />
        )}
      </div>
      <div className="q3-games__foot">
        <span>{shown.length} of {games.length} games{skipped > 0 ? ` (${skipped} skipped: see Settings)` : ''}</span>
        <button type="button" className="q3-games__link" onClick={() => setCredits(true)}>Credits and licences</button>
      </div>
      <GamesCredits open={credits} onClose={() => setCredits(false)} />
    </div>
  )
}
