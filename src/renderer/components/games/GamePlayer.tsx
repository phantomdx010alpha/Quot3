import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, ArrowsOut, ArrowClockwise, Warning } from '@phosphor-icons/react'
import { gameUrl, type GameEntry } from '@shared/games/manifest'
import { Button, EmptyState } from '../ui'

/** The only sandbox flags a game frame gets (design rule 3). No top navigation, no popups, no modals. */
export const GAME_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock allow-forms'

export interface GamePlayerProps {
  game: GameEntry
  /** Changes on Restart so the frame is created again (reloads the game). */
  frameKey: number
  onBack: () => void
  onRestart: () => void
}

/**
 * Phase 202: the player. The top bar sits OUTSIDE the frame (Back, title, Fullscreen, Restart). The frame loads
 * `q3game://<id>/<entry>`. `Alt+Left` arrives as the `games:leave` event from the main process (it works while the frame has focus).
 */
export function GamePlayer({ game, frameKey, onBack, onRestart }: GamePlayerProps): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const url = useMemo(() => { try { return gameUrl(game.id, game.entry) } catch { return '' } }, [game.id, game.entry])
  const backRef = useRef(onBack)
  backRef.current = onBack
  useEffect(() => {
    const on = (window as unknown as { quot3?: { on?: (c: string, cb: (p: unknown) => void) => () => void } }).quot3?.on
    if (!on) return
    return on('games:leave', () => backRef.current())
  }, [])
  const fullscreen = (): void => {
    const el = wrap.current
    if (!el) return
    try {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void el.requestFullscreen?.()
    } catch { /* not available: the button does nothing */ }
  }
  return (
    <div className="q3-games__player">
      <div className="q3-games__bar" role="toolbar" aria-label="Game controls">
        <Button icon={ArrowLeft} onClick={onBack} shortcut="Alt+Left" aria-label="Back to games">Back to games</Button>
        <h2 className="q3-games__playing">{game.title}</h2>
        <Button icon={ArrowsOut} onClick={fullscreen}>Fullscreen</Button>
        <Button icon={ArrowClockwise} onClick={onRestart}>Restart</Button>
      </div>
      <div ref={wrap} className="q3-games__frame">
        {url === '' ? (
          <EmptyState icon={Warning} title="This game could not be opened" description="Its files look wrong. Go back and pick another game." />
        ) : (
          <iframe key={frameKey} className="q3-games__iframe" title={game.title} src={url} sandbox={GAME_FRAME_SANDBOX} />
        )}
      </div>
    </div>
  )
}
