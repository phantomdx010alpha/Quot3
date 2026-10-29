import { forwardRef, type KeyboardEvent } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { Icon } from '../ui'

export interface GamesSearchProps {
  value: string
  onChange: (v: string) => void
  /** Down or Enter in the box moves into the card grid. */
  onEnterGrid: () => void
}

/** Phase 202: the Games search box (focused on arrival by the page). Esc clears the text first. */
export const GamesSearch = forwardRef<HTMLInputElement, GamesSearchProps>(function GamesSearch({ value, onChange, onEnterGrid }, ref) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); onEnterGrid() }
    else if (e.key === 'Escape' && value !== '') { e.preventDefault(); e.stopPropagation(); onChange('') }
  }
  return (
    <div className="q3-games__search">
      <Icon icon={MagnifyingGlass} weight="light" size="md" />
      <input ref={ref} type="search" className="q3-games__searchbox" aria-label="Search games" placeholder="Search games by name or kind" value={value}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      {value !== '' && (
        <button type="button" className="q3-iconbtn" aria-label="Clear search" onClick={() => onChange('')}><Icon icon={X} weight="bold" size="sm" /></button>
      )}
    </div>
  )
})
