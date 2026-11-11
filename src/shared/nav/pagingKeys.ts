/**
 * Phase 220 (M21-3 / M21-3a): which meaning PageUp / PageDown have, decided in ONE pure place (design section 5, 5.1). No DOM, no Electron.
 *  - 'bill'    a saved bill opened from a list (it has a `BillContext`): PageUp / PageDown step to the previous / next BILL of that list;
 *              the grid pages with Ctrl+PageUp / Ctrl+PageDown there.
 *  - 'parties' Customers, History with a party in focus, the Items sales window: PageUp / PageDown step through the PARTIES.
 *  - null      everything else (Create = a new bill, a bill without a list, History with no party in focus, Dashboard ...): the key keeps its
 *              normal meaning (grid paging / list paging).
 */
import { ROUTES } from '../routes'

export type PagingMode = 'bill' | 'parties' | null

export interface PagingInput {
  /** Current route path. */
  path: string
  /** A `BillContext` exists AND the bill on screen is the one it points at. A new bill never has one. */
  billStepping: boolean
  /** History only: the search shows exactly one customer's bills (see `historyPartyFocus`). */
  historyPartyInFocus: boolean
  /** Items only: the Sales window is the focused one. */
  itemsSalesWindow: boolean
}

export function pagingMode(i: PagingInput): PagingMode {
  if (i.path === ROUTES.create) return i.billStepping ? 'bill' : null // Create keeps grid paging (a new bill has no context)
  if (i.path === ROUTES.customers) return 'parties'
  if (i.path === ROUTES.history) return i.historyPartyInFocus ? 'parties' : null
  if (i.path === ROUTES.items) return i.itemsSalesWindow ? 'parties' : null
  return null
}

/** What the focused element looks like to the paging keys (read from the DOM by the caller, so this stays pure). */
export interface PagingTarget {
  tag: string
  /** contenteditable / textbox role. */
  editable: boolean
  /** Inside the bill grid (its cells are editable by design). */
  inGrid: boolean
  /** A single-line field in the opened bill's header bar (party name, phone, transport ...), outside the grid. PageUp / PageDown mean nothing in such a field, so bill stepping works from it (owner report 2026-11-11). Optional: absent = false. */
  inBillBar?: boolean
  /** Inside a dialog, menu, listbox, popup or other overlay layer ("close one layer first", KB section 6). */
  inOverlay: boolean
}

/**
 * The keys never act while typing in a text input, a dropdown, a dialog or a menu. Grid cells are editable by design, so inside the grid
 * only an overlay blocks (the unsaved-edit guard and the Free-mode check cover typing there).
 */
export function pagingBlocked(t: PagingTarget): boolean {
  if (t.inOverlay) return true
  const tag = t.tag.toUpperCase()
  if (t.inGrid) return false
  if (t.inBillBar && tag === 'INPUT') return false
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return t.editable
}

/** The plain key (no Ctrl / Alt / Shift / Meta) that steps; anything else is left to the other handlers. */
export function pagingDir(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): 'prev' | 'next' | null {
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return null
  return e.key === 'PageUp' ? 'prev' : e.key === 'PageDown' ? 'next' : null
}

/** Normalise a customer / search name the way History party focus compares it (trim, collapse spaces, case-insensitive). */
export const partyNameKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * History "party in focus" [A]: the search box holds exactly one customer's name (as picked from Customers order). Returns that
 * customer's id, or null (no search, or the text matches no customer, or two customers share the normalised name).
 */
export function historyPartyFocus(query: string, customers: readonly { id: string; name: string }[]): string | null {
  const q = partyNameKey(query)
  if (q === '') return null
  let found: string | null = null
  for (const c of customers) {
    if (partyNameKey(c.name) !== q) continue
    if (found !== null) return null
    found = c.id
  }
  return found
}

/** Distinct keys in order of first appearance (the Items sales list lists a party several times). */
export function distinctInOrder(keys: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of keys) {
    if (k === null || k === undefined || k === '' || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** Index of the first row of a party in a list of per-row party keys; -1 when absent. */
export function firstRowOfParty(rowKeys: readonly (string | null | undefined)[], partyKey: string): number {
  return rowKeys.findIndex((k) => k === partyKey)
}
