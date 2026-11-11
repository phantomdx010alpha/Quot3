import { useEffect } from 'react'
import { matchShortcut } from '@shared/shortcuts'
import { pagingBlocked, type PagingTarget } from '@shared/nav/pagingKeys'
import { currentPagingMode, stepOpenedBill, stepParty } from '../stores/pagingActions'

/** Read the focused element the way the pure `pagingBlocked` rule wants it. */
export function pagingTargetOf(el: Element | null): PagingTarget {
  const h = el as HTMLElement | null
  return {
    tag: h?.tagName ?? '',
    editable: !!h && (h.isContentEditable || h.getAttribute?.('role') === 'textbox'),
    inGrid: !!h?.closest?.('[role=grid][aria-label]') && !!h?.closest?.('.q3-create'),
    inBillBar: !!h?.closest?.('.q3-create') && h.getAttribute?.('aria-expanded') !== 'true',
    inOverlay: !!h?.closest?.('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-q3-overlay]') || !!document.querySelector('[role=dialog][aria-modal=true],[role=alertdialog]')
  }
}

/**
 * Phase 220 (M21): PageUp / PageDown stepping, one window listener. It resolves the key through the shared registry with the 'bill' or
 * 'parties' scope (never the global hotkey layer), and only acts when nothing else handled the key (`defaultPrevented`), so the grid's
 * and the lists' own handlers keep their keys wherever the registry says the key keeps its old meaning. Create (a new bill) never has a mode.
 */
export function usePagingKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || (e.key !== 'PageUp' && e.key !== 'PageDown')) return
      const mode = currentPagingMode()
      if (mode === null) return
      const def = matchShortcut(e, [mode])
      if (!def || (def.scope !== 'bill' && def.scope !== 'parties')) return
      if (pagingBlocked(pagingTargetOf(document.activeElement ?? (e.target as Element | null)))) return
      if (def.action === 'bill.stepPrev') { e.preventDefault(); stepOpenedBill('prev') }
      else if (def.action === 'bill.stepNext') { e.preventDefault(); stepOpenedBill('next') }
      else if (def.action === 'party.prev') { if (stepParty('prev')) e.preventDefault() }
      else if (def.action === 'party.next') { if (stepParty('next')) e.preventDefault() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
