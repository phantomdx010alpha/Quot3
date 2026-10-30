import { useEffect, useState } from 'react'
import { Button, ConfirmDialog } from '../ui'
import { GamesCredits } from '../games/GamesCredits'
import { useGamesStore } from '../../stores/gamesStore'
import { clearGamesData, loadGames, loadGamesEnabled, setGamesEnabled, setShowChinese } from '../../stores/gamesActions'

/**
 * Phase 202 - Settings > Games: on / off switch (`games.enabled`), how many games are installed (and how many catalogue entries were
 * skipped), clear favourites and history, the Credits screen. Games never use the internet.
 */
export function GamesSection(): React.JSX.Element {
  const enabled = useGamesStore((s) => s.enabled)
  const showChinese = useGamesStore((s) => s.showChinese)
  const games = useGamesStore((s) => s.games)
  const skipped = useGamesStore((s) => s.skipped)
  const status = useGamesStore((s) => s.status)
  const state = useGamesStore((s) => s.state)
  const error = useGamesStore((s) => s.error)
  const [credits, setCredits] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { void loadGamesEnabled(); void loadGames() }, [])
  const shownCount = showChinese ? games.length : games.filter((g) => g.lang === 'en').length
  const used = state.favourites.length + Object.keys(state.lastPlayed).length
  return (
    <form className="q3-set__form" aria-label="Games" onSubmit={(e) => e.preventDefault()}>
      <label className="q3-set__check">
        <input type="checkbox" checked={enabled} onChange={(e) => { setNote(''); void setGamesEnabled(e.target.checked) }} />
        <span>Show Games (side menu, Ctrl+6, command palette and the Dashboard tile)</span>
      </label>
      <label className="q3-set__check">
        <input type="checkbox" checked={showChinese} disabled={!enabled} onChange={(e) => { setNote(''); void setShowChinese(e.target.checked) }} />
        <span>Show games with a Chinese interface</span>
      </label>
      <p className="q3-set__muted">
        {status === 'ready' ? `${shownCount} of ${games.length} games shown. ` : ''}
        {status === 'ready' ? `${games.length} ${games.length === 1 ? 'game is' : 'games are'} installed.` : status === 'loading' ? 'Counting games.' : 'The game list could not be read.'}
        {skipped > 0 ? ` ${skipped} catalogue ${skipped === 1 ? 'entry was' : 'entries were'} skipped because ${skipped === 1 ? 'it is' : 'they are'} not valid.` : ''}
      </p>
      <p className="q3-set__muted">Games run on your PC only and never use the internet.</p>
      <div className="q3-set__row">
        <Button onClick={() => setConfirm(true)} disabled={used === 0}>Clear favourites and history</Button>
        <Button onClick={() => setCredits(true)}>Credits and licences</Button>
      </div>
      {(error !== '' || note !== '') && <p role={error !== '' ? 'alert' : 'status'} className="q3-set__muted">{error || note}</p>}
      <ConfirmDialog open={confirm} title="Clear favourites and history?" danger confirmLabel="Clear"
        message="Your favourite games and the list of recently played games will be removed. High scores kept by the games are not touched."
        onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void clearGamesData().then(() => setNote('Favourites and history cleared.')) }} />
      <GamesCredits open={credits} onClose={() => setCredits(false)} />
    </form>
  )
}
