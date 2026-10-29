import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon, Tooltip } from '../ui'
import { primaryKeys } from '@shared/shortcuts'
import { NAV_ITEMS, visibleNavItems } from './navItems'
import { useGamesStore } from '../../stores/gamesStore'
import { usePath, useRouter } from '../../router/routerStore'
import { ROUTES } from '@shared/routes'
import { useLegacyWatchStore } from '../../stores/legacyWatchStore'

/** Permanent left rail. Tab reaches it; Up/Down/Home/End move between items; Enter/Space activate (native buttons). */
export function SideRail(): React.JSX.Element {
  const path = usePath()
  const navigate = useRouter((s) => s.navigate)
  const ref = useRef<HTMLElement>(null)
  // Phase 163: a small dot on Settings while legacy files wait for the owner's decision (checked now and every 30 s).
  const waiting = useLegacyWatchStore((s) => s.reviewCount)
  const gamesOn = useGamesStore((s) => s.enabled)
  useEffect(() => {
    void useLegacyWatchStore.getState().refreshCount()
    const t = window.setInterval(() => { void useLegacyWatchStore.getState().refreshCount() }, 30_000)
    return () => window.clearInterval(t)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (i === -1) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <nav ref={ref} className="q3-rail nm-raised" aria-label="Main navigation" onKeyDown={onKeyDown}>
      {visibleNavItems(NAV_ITEMS, gamesOn).map((item) => {
        const active = item.path === path
        return (
          <Tooltip key={item.path} label={item.label} shortcut={primaryKeys(item.action)}>
            <button
              type="button"
              className={`q3-rail__item${active ? ' q3-rail__item--active' : ''}`}
              aria-label={item.path === ROUTES.settings && waiting > 0 ? `${item.label} (${waiting} waiting for review)` : item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon icon={item.icon} weight={active ? 'bold' : 'light'} size="lg" />
              {item.path === ROUTES.settings && waiting > 0 && <span className="q3-rail__dot" aria-hidden="true" />}
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}
