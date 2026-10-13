import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { AUDIT_PAGE_DEFAULT, dayRangeIso, type AuditFacets, type AuditItem, type AuditQuery } from '@shared/audit'

type Api = Quot3Bridge['audit']
type Bridge = { audit?: Api; settings?: Quot3Bridge['settings'] }
const bridge = (): Bridge | undefined => (window as unknown as { quot3?: Bridge }).quot3
const NO_BRIDGE = 'The activity log is not available (no connection to the app).'

export interface AuditFilters { entity: string; action: string; fromDay: string; toDay: string; search: string }
const EMPTY: AuditFilters = { entity: '', action: '', fromDay: '', toDay: '', search: '' }

/** The query the filters stand for (blank fields are left out). */
export function queryFor(f: AuditFilters, beforeId?: number): AuditQuery {
  const q: AuditQuery = { limit: AUDIT_PAGE_DEFAULT, ...dayRangeIso(f.fromDay, f.toDay) }
  if (f.entity) q.entity = f.entity
  if (f.action) q.action = f.action
  if (f.search.trim()) q.search = f.search.trim()
  if (beforeId !== undefined) q.beforeId = beforeId
  return q
}

/** Phase 61 - Settings > Activity log: filters, newest-first paging, retention. */
export interface AuditUiState {
  filters: AuditFilters
  items: AuditItem[]
  hasMore: boolean
  nextBeforeId: number | null
  facets: AuditFacets | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  expanded: number | null
  load: () => Promise<void>
  setFilters: (patch: Partial<AuditFilters>) => Promise<void>
  clearFilters: () => Promise<void>
  more: () => Promise<void>
  toggle: (id: number) => void
  setRetention: (days: number) => Promise<boolean>
}

let seq = 0

export const useAuditStore = create<AuditUiState>((set, get) => ({
  filters: { ...EMPTY }, items: [], hasMore: false, nextBeforeId: null, facets: null, status: 'idle', error: '', expanded: null,

  load: async () => {
    const a = bridge()?.audit
    if (!a) { set({ status: 'error', error: NO_BRIDGE }); return }
    const mine = ++seq
    set({ status: 'loading', error: '', expanded: null })
    try {
      const [facets, page] = await Promise.all([a.facets(), a.list(queryFor(get().filters))])
      if (mine !== seq) return
      if (!page.ok) { set({ status: 'error', error: page.error.message }); return }
      set({ status: 'ready', items: page.data.items, hasMore: page.data.hasMore, nextBeforeId: page.data.nextBeforeId, facets: facets.ok ? facets.data : get().facets })
    } catch {
      if (mine === seq) set({ status: 'error', error: 'Could not read the activity log. Try again.' })
    }
  },

  setFilters: async (patch) => { set({ filters: { ...get().filters, ...patch } }); await get().load() },
  clearFilters: async () => { set({ filters: { ...EMPTY } }); await get().load() },

  more: async () => {
    const a = bridge()?.audit
    const { nextBeforeId, hasMore, status } = get()
    if (!a || !hasMore || nextBeforeId === null || status === 'loading') return
    const mine = ++seq
    try {
      const page = await a.list(queryFor(get().filters, nextBeforeId))
      if (mine !== seq) return
      if (!page.ok) { set({ error: page.error.message }); return }
      set({ items: [...get().items, ...page.data.items], hasMore: page.data.hasMore, nextBeforeId: page.data.nextBeforeId })
    } catch {
      if (mine === seq) set({ error: 'Could not load more. Try again.' })
    }
  },

  toggle: (id) => set({ expanded: get().expanded === id ? null : id }),

  setRetention: async (days) => {
    const s = bridge()?.settings
    if (!s) { set({ error: NO_BRIDGE }); return false }
    try {
      const r = await s.set('audit.retentionDays', days)
      if (!r.ok) { set({ error: r.error.message }); return false }
      const f = get().facets
      if (f) set({ facets: { ...f, retentionDays: days }, error: '' })
      return true
    } catch {
      set({ error: 'Could not save. Try again.' })
      return false
    }
  }
}))
