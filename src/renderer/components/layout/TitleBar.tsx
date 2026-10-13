import { Receipt } from '@phosphor-icons/react'
import { Icon } from '../ui'

/** Phase 98 - the draggable strip behind the native Windows window buttons (titleBarOverlay). Colours come from the --titlebar-* tokens.
 *  Native minimize / maximize / close stay (snap, resize, accessibility); `env(titlebar-area-width)` keeps this content clear of them.
 *  Rendered only on Windows (elsewhere the window keeps its normal frame). */
export const isWindowsRenderer = (): boolean => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

export function TitleBar(): React.JSX.Element | null {
  if (!isWindowsRenderer()) return null
  return (
    <div className="q3-titlebar" role="presentation" data-testid="titlebar">
      <div className="q3-titlebar__content">
        <Icon icon={Receipt} weight="bold" size="sm" />
        <span className="q3-titlebar__name">Quot3</span>
      </div>
    </div>
  )
}
