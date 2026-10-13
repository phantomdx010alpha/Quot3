import type { KeyboardEvent } from 'react'
import { isListKey, moveListIndex } from '@shared/history/historyList'
import { buildGroupRows, moveGroupSelection } from '@shared/items/groupRows'
import { filterGroups } from '@shared/items/search'
import { tabOf } from '@shared/items/salesView'
import { useItemsStore } from '../../stores/itemsStore'
import { ITEMS_ROW_PX } from './GroupsWindow'

/**
 * Phase 113 - keys that work INSIDE the Groups and Spellings windows (the page handles Tab / Ctrl+Alt+n / Ctrl+F / F5 / Ctrl+Z).
 * They are listed in the shortcut registry (scope `items`) for the palette and the F1 sheet, but are handled here, on the focused window only,
 * so they never fire while typing in the search box. Each returns true when it used the key.
 */
const page = (e: KeyboardEvent<HTMLElement>): number => Math.max(1, Math.floor(e.currentTarget.clientHeight / ITEMS_ROW_PX) - 1)
const plain = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.altKey && !e.metaKey
const letter = (e: KeyboardEvent, k: string): boolean => plain(e) && !e.shiftKey && e.key.toLowerCase() === k

export function groupsKey(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.target !== e.currentTarget) return false
  const st = useItemsStore.getState()
  if (isListKey(e.key) && plain(e)) {
    const rows = st.overview ? buildGroupRows(filterGroups(st.overview.groups, st.query), st.overview.families) : []
    e.preventDefault()
    const next = moveGroupSelection(rows, st.selectedGroupId, e.key, page(e))
    if (next !== null) st.selectGroup(next)
    return true
  }
  if (e.key === 'Escape' && plain(e)) {
    if (st.cancelPending()) { e.preventDefault(); e.stopPropagation(); return true }
    return false // no pending decision: Esc keeps its normal job (back to the Dashboard)
  }
  if (letter(e, 'm') || (e.key === 'Enter' && plain(e) && st.pending !== null)) { e.preventDefault(); void st.mergeKey(); return true }
  if (e.key === 'Delete' && plain(e)) { e.preventDefault(); void st.ignoreKey(); return true }
  if (e.key === 'ArrowRight' && plain(e)) { e.preventDefault(); st.ports.focusWindow?.('spellings'); return true }
  return false
}

export function spellingsKey(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.target !== e.currentTarget) return false
  const st = useItemsStore.getState()
  if (isListKey(e.key) && plain(e)) {
    const n = st.spellingRows().length
    e.preventDefault()
    if (n > 0) st.setCursor(moveListIndex(st.cursor, n, e.key, page(e)))
    return true
  }
  if (e.key === 'Escape' && plain(e)) {
    if (st.cancelPending()) { e.preventDefault(); e.stopPropagation(); return true }
    return false
  }
  if (e.key === 'ArrowLeft' && plain(e)) { e.preventDefault(); st.ports.focusWindow?.('groups'); return true }
  if (e.key === 'ArrowRight' && plain(e)) { e.preventDefault(); st.ports.focusWindow?.('sales'); return true }
  if (e.key === 'Enter' && plain(e)) { e.preventDefault(); void st.confirmKey(); return true }
  if (letter(e, 's')) { e.preventDefault(); void st.splitKey(); return true }
  if (letter(e, 'v')) { e.preventDefault(); st.moveKey(); return true }
  if (letter(e, 'x') || (e.key === 'Delete' && plain(e))) { e.preventDefault(); void st.rejectKey(); return true }
  return false
}

/** Phase 114 - Sales window: Up / Down / Home / End / PageUp / PageDown move the highlighted sale, Enter opens its bill, G switches Non-GST / GST, P filters by the highlighted sale's party (again = all), Esc clears the filter first, Left = Spellings. */
export function salesKey(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.target !== e.currentTarget) return false
  const st = useItemsStore.getState()
  if (isListKey(e.key) && plain(e)) {
    const n = st.sales ? tabOf(st.sales, st.salesTab).rows.length : 0
    e.preventDefault()
    if (n > 0) st.setSalesCursor(moveListIndex(st.salesCursor, n, e.key, page(e)))
    return true
  }
  if (e.key === 'Escape' && plain(e)) {
    if (st.partyFilter !== null) { e.preventDefault(); e.stopPropagation(); void st.clearPartyFilter(); return true }
    return false // no filter: Esc keeps its normal job (back to the Dashboard)
  }
  if (e.key === 'ArrowLeft' && plain(e)) { e.preventDefault(); st.ports.focusWindow?.('spellings'); return true }
  if (e.key === 'Enter' && plain(e)) { e.preventDefault(); void st.openSaleBill(); return true }
  if (letter(e, 'g')) { e.preventDefault(); st.toggleSalesTab(); return true }
  if (letter(e, 'p')) { e.preventDefault(); void st.filterByCursorParty(); return true }
  return false
}
