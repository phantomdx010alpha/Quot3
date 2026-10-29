import { openRandomGame } from '../../stores/gamesActions'
import { useRouter } from '../../router/routerStore'
import { ROUTES } from '@shared/routes'

/**
 * Phase 203 (M19) - the "(?)" tile. The only visible text is "(?)": no icon, caption or count. A real button; click or Enter opens a random
 * game in the Games player (`games:pickRandom` avoids the last played one). If no game could be picked it opens the Games page instead.
 */
export function GamesTile({ span }: { span: number }): React.JSX.Element {
  const navigate = useRouter((s) => s.navigate)
  const go = (): void => {
    void openRandomGame().then((ok) => { if (ok) navigate(ROUTES.games) })
  }
  return (
    <div className="q3-tile q3-tile--games nm-raised nm-sm" style={{ gridColumn: `span ${span}` }} data-tile="games">
      <button type="button" className="q3-tile__games" aria-label="Random game" onClick={go}>(?)</button>
    </div>
  )
}
