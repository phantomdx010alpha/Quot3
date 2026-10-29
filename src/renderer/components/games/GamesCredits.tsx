import { useEffect, useState } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import { Button, Dialog } from '../ui'

type Credit = { id: string; title: string; author: string; source: string; licence: string; commit: string }
type GamesApi = Quot3Bridge['games']
const api = (): Partial<GamesApi> | undefined => (window as unknown as { quot3?: { games?: Partial<GamesApi> } }).quot3?.games

/** Libraries inside the Chess game (one manifest entry, several upstream parts). Their full texts ship in `resources/games/chess/LICENSES`. */
export const CHESS_NOTICES: readonly { name: string; author: string; licence: string; source: string }[] = [
  { name: 'chess.js (rules, as modified by chess-ai)', author: 'Jeff Hlywa', licence: 'BSD-2-Clause', source: 'https://github.com/jhlywa/chess.js' },
  { name: 'chessboard.js', author: 'Chris Oakman', licence: 'MIT', source: 'https://github.com/oakmac/chessboardjs' },
  { name: 'jQuery 3.5.1', author: 'OpenJS Foundation and contributors', licence: 'MIT', source: 'https://github.com/jquery/jquery' },
  { name: 'chess-ai (search and evaluation)', author: 'zeyu2001', licence: 'MIT', source: 'https://github.com/zeyu2001/chess-ai' }
]
export const CHESS_ART_NOTICE = 'The Chess piece pictures are drawn for Quot3 from standard Unicode chess symbols; no outside piece artwork is used.'

export interface GamesCreditsProps { open: boolean; onClose: () => void }

/** Phase 202: Credits. Every game with author, repo, licence and commit; a click shows its full LICENSE text. Nothing here uses the internet. */
export function GamesCredits({ open, onClose }: GamesCreditsProps): React.JSX.Element | null {
  const [list, setList] = useState<Credit[]>([])
  const [error, setError] = useState('')
  const [shown, setShown] = useState<{ title: string; text: string } | null>(null)
  useEffect(() => {
    if (!open) return
    setShown(null); setError('')
    void (async () => {
      try {
        const r = await api()?.getCredits?.()
        if (r?.ok) setList(r.data); else setError(r ? r.error.message : 'Credits are not available in this window.')
      } catch { setError('Credits could not be read.') }
    })()
  }, [open])
  const showLicence = async (c: Credit): Promise<void> => {
    setError('')
    try {
      const r = await api()?.getLicense?.(c.id)
      if (r?.ok) setShown({ title: c.title, text: r.data.text }); else setError(r ? r.error.message : 'The licence text is not available.')
    } catch { setError('The licence text could not be read.') }
  }
  return (
    <Dialog open={open} title={shown ? `Licence: ${shown.title}` : 'Games credits'} onClose={onClose} wide
      footer={shown ? <Button onClick={() => setShown(null)}>Back to the list</Button> : <Button onClick={onClose}>Close</Button>}>
      {error !== '' && <p role="alert" className="q3-games__err">{error}</p>}
      {shown ? (
        <pre className="q3-games__licence" aria-label="Licence text">{shown.text}</pre>
      ) : (
        <div className="q3-games__credits">
          <p className="q3-games__note">These games were made by other people and are shared under open licences. Pick a game to read its full licence.</p>
          {list.length === 0 && error === '' && <p>No games are installed.</p>}
          <ul className="q3-games__creditlist">
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="q3-games__creditrow" data-credit-id={c.id} onClick={() => void showLicence(c)}>
                  <span className="q3-games__title">{c.title}</span>
                  <span className="q3-games__last">{c.author} - {c.licence} - {c.source} - commit {c.commit.slice(0, 12)}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="q3-games__sub">Also inside Chess</h3>
          <ul className="q3-games__creditlist">
            {CHESS_NOTICES.map((n) => (
              <li key={n.name} className="q3-games__creditrow q3-games__creditrow--static">
                <span className="q3-games__title">{n.name}</span>
                <span className="q3-games__last">{n.author} - {n.licence} - {n.source}</span>
              </li>
            ))}
          </ul>
          <p className="q3-games__note">{CHESS_ART_NOTICE}</p>
        </div>
      )}
    </Dialog>
  )
}
