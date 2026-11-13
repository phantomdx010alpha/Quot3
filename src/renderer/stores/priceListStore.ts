import { create } from 'zustand'
import type { Patch } from 'immer'
import type { Quot3Bridge, Result } from '@shared/ipc'
import type { PriceTree, SaveRowInput, StructureInput, ColumnsAction } from '@shared/pricelist/api'
import type { PriceColumn, PriceRow, PriceTab } from '@shared/pricelist/types'
import { findDuplicates } from '@shared/pricelist/search'
import { filterRows, deleteRows as deleteRowsPure, insertRow, moveRows as moveRowsPure, newRow } from '@shared/pricelist/rows'
import { cellText, clearBounds, fillDown, fillRight, gridColumns, gridShape, isBlankRow, isDraftAllowed, isTypable, withCellText, boundsToClip, pasteInto, type Bounds, type GridCol } from '@shared/pricelist/gridModel'
import { arriveAt, createNavState, navOptionsFor, navReduce, rangeBounds, type KeyInput, type NavState } from '@shared/nav/cellNav'
import { createHistory, type History } from '@shared/history/undoStack'
import { applyFormat, type FormatKind } from '@shared/richtext/format'
import { length as runsLength } from '@shared/richtext/runs'
import type { GridClipCell } from '@shared/tsv/gridClip'
import { useBehaviourStore } from './behaviourStore'

type Bridge = Pick<Quot3Bridge, 'pricelist'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const msg = (r: Result<unknown>): string => (r.ok ? '' : r.error.message)

/**
 * Phase 238 (M23) - the Price List page's store. Holds the tree (tiers / categories / tabs), the rows of the open tab, the grid cursor
 * (the bill grid's own `navReduce` state machine), the filter, the undo history and the autosave. Rule 4.3: cells are decimal strings.
 * Selectors must return raw values (Phase 92 rule): components derive filtered / mapped lists with `useMemo`.
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
export type PriceDialog = null | 'columns' | 'tiers' | 'bulk' | 'find' | 'search'
export interface PriceFilter { noPrice: boolean; contains: string }

const AUTOSAVE_MS = 600
const PAGE_ROWS_DEFAULT = 20

export interface PriceListState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  tree: PriceTree | null
  categoryId: string | null
  tabId: string | null
  rows: PriceRow[]
  rowsLoading: boolean
  nav: NavState
  /** Text of the active cell while it is being typed in (null = showing the stored value). Applied to the row when the cursor leaves. */
  draft: string | null
  /** Bumped whenever the DOM must move focus / caret to the active cell. */
  focusTick: number
  caretCmd: { pos: number | 'end' | 'start'; tick: number }
  filter: PriceFilter
  panelOpen: boolean
  dialog: PriceDialog
  save: SaveState
  saveError: string
  notice: string
  /** Phase 239: a plain sentence when the name being typed already exists in this tab ('' = none). Computed after a short pause, never per keystroke. */
  dupWarn: string
  canUndo: boolean
  canRedo: boolean
  ports: { focusFilter: (() => void) | null; focusGrid: (() => void) | null; askAddTab: (() => void) | null }

  load: () => Promise<void>
  selectCategory: (id: string) => Promise<void>
  selectTab: (id: string) => Promise<void>
  stepTab: (dir: -1 | 1) => Promise<void>
  structure: (input: StructureInput) => Promise<string | null>
  columnsOp: (action: ColumnsAction) => Promise<boolean>
  setFilter: (f: Partial<PriceFilter>) => void
  togglePanel: () => void
  openDialog: (d: PriceDialog) => void
  setPorts: (p: Partial<PriceListState['ports']>) => void
  // grid
  visibleRows: () => PriceRow[]
  gridCols: () => GridCol[]
  setDraft: (text: string) => void
  commit: () => void
  keyDown: (k: KeyInput) => boolean
  clickCell: (row: number, col: number, shift?: boolean) => void
  syncCaret: (pos: number) => void
  copySelection: () => { tsv: string; payload: GridClipCell[][] } | null
  pasteMatrix: (matrix: GridClipCell[][]) => void
  // row commands
  insertRow: (where: 'above' | 'below') => void
  deleteSelected: () => void
  moveSelected: (dir: -1 | 1) => void
  toggleSection: () => void
  fill: (dir: 'down' | 'right') => void
  format: (kind: FormatKind) => void
  applyRows: (label: string, next: PriceRow[]) => void
  jumpToRow: (rowId: string) => void
  undo: () => void
  redo: () => void
  // saving
  flush: () => Promise<void>
  reset: () => void
}

let tmpSeq = 0
const tmpId = (): string => `tmp-${++tmpSeq}`
const isTmp = (id: string): boolean => id.startsWith('tmp-')
const rowSig = (r: PriceRow): string => JSON.stringify([r.idx, r.kind, r.nameRuns, Object.entries(r.cells).sort(([a], [b]) => (a < b ? -1 : 1))])

let history: History = createHistory({ coalesceMs: 0 })
/** What the database holds for the open tab: id -> signature. The autosave sends only rows whose signature differs. */
let snapshot = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> | null = null
let loadSeq = 0
let dupTimer: ReturnType<typeof setTimeout> | null = null
const DUP_PAUSE_MS = 300

const replace = (value: PriceRow[]): Patch[] => [{ op: 'replace', path: [], value }]

const emptyState = (): Pick<PriceListState, 'status' | 'error' | 'tree' | 'categoryId' | 'tabId' | 'rows' | 'rowsLoading' | 'nav' | 'draft' | 'filter' | 'save' | 'saveError' | 'notice' | 'canUndo' | 'canRedo' | 'dialog'> => ({
  status: 'idle', error: '', tree: null, categoryId: null, tabId: null, rows: [], rowsLoading: false, nav: createNavState(0, 0), draft: null,
  filter: { noPrice: false, contains: '' }, save: 'saved', saveError: '', notice: '', canUndo: false, canRedo: false, dialog: null
})

export const usePriceListStore = create<PriceListState>((set, get) => {
  const tabOf = (s: PriceListState): PriceTab | null => s.tree?.tabs.find((t) => t.id === s.tabId) ?? null
  const colsOf = (s: PriceListState): GridCol[] => gridColumns(tabOf(s)?.columns ?? [])
  const filtered = (s: PriceListState): boolean => s.filter.noPrice || s.filter.contains.trim() !== ''
  const visibleOf = (s: PriceListState): PriceRow[] => (filtered(s) ? filterRows(s.rows, tabOf(s)?.columns ?? [], { noPrice: s.filter.noPrice, contains: s.filter.contains }) : s.rows)
  const histFlags = (): Pick<PriceListState, 'canUndo' | 'canRedo'> => ({ canUndo: history.canUndo(), canRedo: history.canRedo() })
  const notify = (notice: string): void => set({ notice })
  const focusNow = (): void => set((s) => ({ focusTick: s.focusTick + 1 }))

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void get().flush() }, AUTOSAVE_MS)
  }

  /** The ONE way rows change: record an undo step (whole-array replace; rows are shared structurally) and schedule the autosave. */
  const apply = (label: string, next: PriceRow[], navNext?: NavState): void => {
    const s = get()
    const prev = s.rows
    const rowId = visibleOf(s)[s.nav.row]?.id ?? ''
    const colKey = colsOf(s)[s.nav.col]?.key ?? ''
    history.push({ label, at: Date.now(), patches: replace(next), inverse: replace(prev), selBefore: { rowId, colKey, range: null }, selAfter: null })
    set({ rows: next, save: 'dirty', ...(navNext ? { nav: navNext } : {}), ...histFlags() })
    schedule()
  }

  const loadRows = async (tabId: string): Promise<void> => {
    const my = ++loadSeq
    set({ rowsLoading: true })
    const r = await api()?.pricelist?.rows(tabId)
    if (my !== loadSeq) return
    if (!r || !r.ok) { set({ rowsLoading: false, rows: [], error: r ? msg(r) : 'The Price List is not available', status: 'error' }); return }
    history = createHistory({ coalesceMs: 0 })
    snapshot = new Map(r.data.map((x) => [x.id, rowSig(x)]))
    // An empty tab opens with one blank row so there is a cell to type in (a blank row is never saved).
    const rows = r.data.length > 0 ? r.data : [newRow(tmpId(), tabId, 0)]
    set({ rows, rowsLoading: false, nav: createNavState(0, 0), draft: null, save: 'saved', saveError: '', ...histFlags() })
    focusNow()
  }

  const commit = (): void => {
    const s = get()
    if (s.draft === null) return
    const rows = visibleOf(s)
    const row = rows[s.nav.row]
    const col = colsOf(s)[s.nav.col]
    set({ draft: null, dupWarn: '' })
    if (!row || !col) return
    const next = withCellText(row, col, s.draft)
    if (next === null) { notify(`"${s.draft.trim().slice(0, 20)}" is not valid for ${col.label}; the old value was kept`); return }
    if (next === row) return
    apply('Edit cell', get().rows.map((r) => (r.id === row.id ? next : r)))
  }

  const selBounds = (s: PriceListState): Bounds => {
    if (s.nav.range) return rangeBounds(s.nav.range)
    return { top: s.nav.row, left: s.nav.col, bottom: s.nav.row, right: s.nav.col }
  }
  const selectedIds = (s: PriceListState): Set<string> => {
    const b = selBounds(s)
    const vis = visibleOf(s)
    const ids = new Set<string>()
    for (let r = b.top; r <= b.bottom; r++) { const row = vis[r]; if (row) ids.add(row.id) }
    return ids
  }
  const blockedByFilter = (what: string): boolean => {
    if (!filtered(get())) return false
    notify(`Clear the filter to ${what}`)
    return true
  }

  return {
    ...emptyState(),
    focusTick: 0,
    caretCmd: { pos: 'end', tick: 0 },
    panelOpen: true,
    ports: { focusFilter: null, focusGrid: null, askAddTab: null },
    dupWarn: '',

    async load() {
      if (get().status === 'loading') return
      set({ status: 'loading', error: '' })
      const r = await api()?.pricelist?.tree()
      if (!r) { set({ status: 'error', error: 'The Price List is not available' }); return }
      if (!r.ok) { set({ status: 'error', error: msg(r) }); return }
      const s = get()
      const tree = r.data
      const cat = tree.categories.find((c) => c.id === s.categoryId) ?? tree.categories[0] ?? null
      const tabs = cat ? tree.tabs.filter((t) => t.categoryId === cat.id) : []
      const tab = tabs.find((t) => t.id === s.tabId) ?? tabs[0] ?? null
      set({ status: 'ready', tree, categoryId: cat?.id ?? null, tabId: tab?.id ?? null })
      if (tab && (tab.id !== s.tabId || s.rows.length === 0)) await loadRows(tab.id)
      else if (!tab) set({ rows: [] })
    },

    async selectCategory(id) {
      commit(); await get().flush()
      const tree = get().tree
      if (!tree) return
      const tab = tree.tabs.find((t) => t.categoryId === id)
      set({ categoryId: id, tabId: tab?.id ?? null, ...(tab ? {} : { rows: [] }) })
      if (tab) await loadRows(tab.id)
    },

    async selectTab(id) {
      if (id === get().tabId) return
      commit(); await get().flush()
      const tab = get().tree?.tabs.find((t) => t.id === id)
      if (!tab) return
      set({ tabId: id, categoryId: tab.categoryId })
      await loadRows(id)
    },

    async stepTab(dir) {
      const s = get()
      const tabs = (s.tree?.tabs ?? []).filter((t) => t.categoryId === s.categoryId)
      const i = tabs.findIndex((t) => t.id === s.tabId)
      const next = tabs[i + dir]
      if (next) await get().selectTab(next.id)
    },

    async structure(input) {
      commit(); await get().flush()
      const r = await api()?.pricelist?.structure(input)
      if (!r) return 'The Price List is not available'
      if (!r.ok) { notify(msg(r)); return msg(r) }
      const tree = r.data.tree
      const s = get()
      // After a change land somewhere sensible: the new category / tab, else the same place, else the first one.
      let categoryId = s.categoryId
      let tabId = s.tabId
      if (input.op === 'addCategory' && r.data.id) { categoryId = r.data.id; tabId = null }
      if ((input.op === 'addTab' || input.op === 'duplicateTab') && r.data.id) { tabId = r.data.id }
      if (input.op === 'moveTab') categoryId = input.categoryId
      if (!tree.categories.some((c) => c.id === categoryId)) categoryId = tree.categories[0]?.id ?? null
      const tabs = tree.tabs.filter((t) => t.categoryId === categoryId)
      if (!tabs.some((t) => t.id === tabId)) tabId = tabs[0]?.id ?? null
      const changed = tabId !== s.tabId
      set({ tree, categoryId, tabId, ...(tabId === null ? { rows: [] } : {}) })
      if (tabId && (changed || input.op === 'duplicateTab')) await loadRows(tabId)
      return null
    },

    async columnsOp(action) {
      const s = get()
      if (!s.tabId) return false
      commit(); await get().flush()
      const r = await api()?.pricelist?.columns({ tabId: s.tabId, ...action })
      if (!r) return false
      if (!r.ok) { notify(msg(r)); return false }
      const tree = get().tree
      if (tree) set({ tree: { ...tree, tabs: tree.tabs.map((t) => (t.id === s.tabId ? { ...t, columns: r.data.columns as PriceColumn[] } : t)) } })
      // A column set change can leave the cursor past the last column.
      const cols = colsOf(get())
      set((x) => ({ nav: { ...x.nav, col: Math.min(x.nav.col, Math.max(0, cols.length - 1)), range: null } }))
      return true
    },

    setFilter(f) {
      commit()
      set((s) => ({ filter: { ...s.filter, ...f }, nav: createNavState(0, s.nav.col) }))
    },
    togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
    openDialog(d) { commit(); set({ dialog: d }) },
    setPorts: (p) => set((s) => ({ ports: { ...s.ports, ...p } })),

    visibleRows: () => visibleOf(get()),
    gridCols: () => colsOf(get()),

    setDraft(text) {
      const s = get()
      const col = colsOf(s)[s.nav.col]
      if (!col || !isDraftAllowed(col, text)) return
      set({ draft: text })
      if (dupTimer) { clearTimeout(dupTimer); dupTimer = null }
      if (!col.isName) { if (s.dupWarn !== '') set({ dupWarn: '' }); return }
      const rowId = visibleOf(s)[s.nav.row]?.id ?? ''
      dupTimer = setTimeout(() => {
        dupTimer = null
        const cur = get()
        if (cur.draft !== text) return // the owner kept typing or left the cell
        const hit = findDuplicates(cur.rows, text, rowId, 1)[0]
        set({ dupWarn: hit ? `Already in this tab: ${hit.name}` : '' })
      }, DUP_PAUSE_MS)
    },
    commit,

    keyDown(k) {
      const s = get()
      const cols = colsOf(s)
      const vis = visibleOf(s)
      if (!s.tabId || cols.length === 0) return false
      const lower = k.key.toLowerCase()
      const mod = !!k.ctrl || !!k.meta
      if (mod && !k.alt) {
        if (lower === 'z' && !k.shift) { get().undo(); return true }
        if (lower === 'y' || (lower === 'z' && k.shift)) { get().redo(); return true }
        const fmt: FormatKind | null = lower === 'b' && !k.shift ? 'bold' : lower === 'r' && k.shift ? 'redBold' : lower === 'h' && !k.shift ? 'highlight' : lower === 'c' && k.shift ? 'clear' : null
        if (fmt) { get().format(fmt); return true }
      }
      // The shape sees the live draft of the active cell (so edge detection for Left / Right is right while typing).
      const base = gridShape(vis, cols)
      const shape = { ...base, cellText: (r: number, c: number): string => (r === s.nav.row && c === s.nav.col && s.draft !== null ? s.draft : base.cellText(r, c)) }
      const beh = useBehaviourStore.getState()
      const res = navReduce(s.nav, { ...k, pageRows: k.pageRows ?? PAGE_ROWS_DEFAULT }, shape, { ...navOptionsFor(beh.smoothArrows), leftUnlockPresses: beh.leftUnlockPresses })
      let nav = res.state
      const native = res.effects.some((e) => e.type === 'NATIVE' || e.type === 'PAGE_ESCAPE')
      const row = vis[s.nav.row]
      const col = cols[s.nav.col]
      const typable = !!row && !!col && isTypable(row, col)
      for (const e of res.effects) {
        switch (e.type) {
          case 'ENSURE_ROW': {
            commit()
            if (filtered(get())) { notify('Clear the filter to add rows'); break }
            const rows = get().rows
            if (e.index >= rows.length) {
              const add: PriceRow[] = []
              for (let i = rows.length; i <= e.index; i++) add.push(newRow(tmpId(), s.tabId, i))
              // A blank row is display-only until it holds something (it is never saved empty), so it needs no undo step of its own.
              set({ rows: [...rows, ...add] })
            }
            break
          }
          case 'MOVE': {
            commit()
            const after = visibleOf(get())
            const target = after[e.row]
            const tcol = cols[e.col]
            const caret = target && tcol ? cellText(target, tcol).length : 0
            nav = { ...nav, row: e.row, col: e.col, caret, mode: 'append' }
            focusNow()
            break
          }
          case 'SET_CARET': set((x) => ({ caretCmd: { pos: e.pos, tick: x.caretCmd.tick + 1 } })); break
          case 'INSERT_TEXT':
            if (typable && col) {
              const text = (get().draft ?? (row ? cellText(row, col) : '')) + e.text
              if (isDraftAllowed(col, text)) set({ draft: text, caretCmd: { pos: 'end', tick: get().caretCmd.tick + 1 } })
            }
            break
          case 'CLEAR_CELL':
            if (typable) { set({ draft: '' }); commit() }
            break
          case 'CLEAR_RANGE': {
            commit()
            const next = clearBounds(get().rows, cols, { top: e.from.row, left: e.from.col, bottom: e.to.row, right: e.to.col })
            // `rows` here are the whole tab; the range is in visible coordinates, so map through ids when filtered.
            if (!filtered(get())) apply('Clear cells', next)
            else {
              const ids = new Set(visibleOf(get()).slice(e.from.row, e.to.row + 1).map((r) => r.id))
              const done = clearBounds(visibleOf(get()), cols, { top: e.from.row, left: e.from.col, bottom: e.to.row, right: e.to.col })
              const byId = new Map(done.filter((r) => ids.has(r.id)).map((r) => [r.id, r]))
              apply('Clear cells', get().rows.map((r) => byId.get(r.id) ?? r))
            }
            break
          }
          default: break
        }
      }
      set({ nav })
      const editKey = k.key === 'Backspace' || k.key === 'Delete' || (!k.ctrl && !k.alt && !k.meta && Array.from(k.key).length === 1)
      return !native || (!typable && res.effects.some((e) => e.type === 'NATIVE') && editKey)
    },

    clickCell(row, col, shift) {
      commit()
      const s = get()
      const cols = colsOf(s)
      const vis = visibleOf(get())
      const shape = gridShape(vis, cols)
      if (shift) { set({ nav: { ...s.nav, range: { anchor: s.nav.range?.anchor ?? { row: s.nav.row, col: s.nav.col }, focus: { row, col } } } }); return }
      set({ nav: arriveAt(shape, row, col) })
      focusNow()
    },

    syncCaret(pos) {
      set((s) => (s.nav.mode === 'free' && s.nav.caret !== pos ? { nav: { ...s.nav, caret: pos } } : s))
    },

    copySelection() {
      commit()
      const s = get()
      const cells = boundsToClip(visibleOf(s), colsOf(s), selBounds(s))
      if (cells.length === 0) return null
      return { tsv: cells.map((l) => l.map((c) => c.text.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n'), payload: cells }
    },

    pasteMatrix(matrix) {
      commit()
      const s = get()
      if (!s.tabId || matrix.length === 0) return
      if (filtered(s)) { notify('Clear the filter to paste'); return }
      const cols = colsOf(s)
      const b = selBounds(s)
      const res = pasteInto(s.rows, cols, matrix, b.top, b.left, s.tabId, tmpId)
      // Re-index any rows the paste created.
      const rows = res.rows.map((r, i) => (r.idx === i ? r : { ...r, idx: i }))
      apply('Paste', rows)
      const bits: string[] = [`${res.written} cell${res.written === 1 ? '' : 's'} pasted`]
      if (res.notWritten > 0) bits.push(`${res.notWritten} not valid for their column`)
      if (res.plan.clippedCols > 0) bits.push(`${res.plan.clippedCols} column(s) beyond the last were ignored`)
      notify(bits.join('; '))
      focusNow()
    },

    insertRow(where) {
      commit()
      const s = get()
      if (!s.tabId || blockedByFilter('insert a row')) return
      const at = Math.max(0, Math.min(s.rows.length - 1, s.nav.row))
      const index = s.rows.length === 0 ? 0 : where === 'above' ? at : at + 1
      const rows = insertRow(s.rows, newRow(tmpId(), s.tabId, index), index)
      apply('Insert row', rows, { ...arriveAt(gridShape(rows, colsOf(s)), index, s.nav.col) })
      focusNow()
    },

    deleteSelected() {
      commit()
      const s = get()
      const ids = selectedIds(s)
      if (ids.size === 0) return
      const rows = deleteRowsPure(s.rows, ids)
      const cols = colsOf(s)
      const b = selBounds(s)
      const left = visibleOf(s).filter((r) => !ids.has(r.id)).length
      const row = Math.max(0, Math.min(b.top, left - 1))
      apply(ids.size === 1 ? 'Delete row' : 'Delete rows', rows, { ...createNavState(row, Math.min(s.nav.col, Math.max(0, cols.length - 1))) })
      notify(`${ids.size} row${ids.size === 1 ? '' : 's'} deleted (Ctrl+Z brings ${ids.size === 1 ? 'it' : 'them'} back)`)
      focusNow()
    },

    moveSelected(dir) {
      commit()
      const s = get()
      if (blockedByFilter('move rows')) return
      const b = selBounds(s)
      if (dir === -1 ? b.top === 0 : b.bottom >= s.rows.length - 1) return
      const rows = moveRowsPure(s.rows, selectedIds(s), dir)
      const nav = { ...s.nav, row: s.nav.row + dir, range: s.nav.range ? { anchor: { ...s.nav.range.anchor, row: s.nav.range.anchor.row + dir }, focus: { ...s.nav.range.focus, row: s.nav.range.focus.row + dir } } : null }
      apply('Move rows', rows, nav)
      focusNow()
    },

    toggleSection() {
      commit()
      const s = get()
      const ids = selectedIds(s)
      if (ids.size === 0) return
      const vis = visibleOf(s)
      const anySection = vis.some((r) => ids.has(r.id) && r.kind === 'section')
      const rows = s.rows.map((r) => {
        if (!ids.has(r.id)) return r
        if (anySection) return r.kind === 'section' ? { ...r, kind: 'item' as const } : r
        const cells: Record<string, string> = {}
        return { ...r, kind: 'section' as const, cells }
      })
      apply(anySection ? 'Make item' : 'Make section heading', rows)
      focusNow()
    },

    fill(dir) {
      commit()
      const s = get()
      if (blockedByFilter('fill')) return
      const cols = colsOf(s)
      const b = selBounds(s)
      const next = dir === 'down' ? fillDown(s.rows, cols, b) : fillRight(s.rows, cols, b)
      if (next.every((r, i) => r === s.rows[i])) return
      apply(dir === 'down' ? 'Fill down' : 'Fill right', next)
      focusNow()
    },

    format(kind) {
      commit()
      const s = get()
      const cols = colsOf(s)
      const col = cols[s.nav.col]
      if (!col || !col.isName) return // bold / red / highlight apply to item names only
      const ids = selectedIds(s)
      const vis = visibleOf(s)
      const targets = vis.filter((r, i) => ids.has(r.id) && (s.nav.range || i === s.nav.row))
      if (targets.length === 0) return
      const by = new Map<string, PriceRow>()
      for (const r of targets) {
        const n = runsLength(r.nameRuns)
        if (n > 0) by.set(r.id, { ...r, nameRuns: applyFormat(r.nameRuns, kind, 0, n) })
      }
      if (by.size === 0) return
      apply('Format names', s.rows.map((r) => by.get(r.id) ?? r))
      focusNow()
    },

    applyRows(label, next) {
      commit()
      if (next.length === get().rows.length && next.every((r, i) => r === get().rows[i])) return
      apply(label, next)
      focusNow()
    },

    jumpToRow(rowId) {
      commit()
      const s = get()
      const idx = s.rows.findIndex((r) => r.id === rowId)
      if (idx < 0) { notify('That row is no longer in this tab'); return }
      set({ filter: { noPrice: false, contains: '' }, nav: createNavState(idx, 0), draft: null, dupWarn: '' })
      focusNow()
    },

    undo() {
      commit()
      const e = history.undo()
      if (!e) return
      const rows = (e.inverse[0] as { value: PriceRow[] }).value
      const sel = e.selBefore
      const idx = sel ? rows.findIndex((r) => r.id === sel.rowId) : -1
      set((s) => ({ rows, save: 'dirty', nav: { ...createNavState(Math.max(0, Math.min(idx >= 0 ? idx : s.nav.row, rows.length - 1)), s.nav.col) }, draft: null, ...histFlags() }))
      schedule(); focusNow()
    },

    redo() {
      commit()
      const e = history.redo()
      if (!e) return
      const rows = (e.patches[0] as { value: PriceRow[] }).value
      set((s) => ({ rows, save: 'dirty', nav: { ...createNavState(Math.max(0, Math.min(s.nav.row, rows.length - 1)), s.nav.col) }, draft: null, ...histFlags() }))
      schedule(); focusNow()
    },

    async flush() {
      if (timer) { clearTimeout(timer); timer = null }
      if (flushing) { await flushing; if (get().save !== 'dirty') return }
      const run = async (): Promise<void> => {
        const s = get()
        const tabId = s.tabId
        if (!tabId || s.save === 'saved') return
        const rows = s.rows
        const send: SaveRowInput[] = []
        const sentIds: string[] = []
        for (const [i, r] of rows.entries()) {
          if (isTmp(r.id) && isBlankRow(r)) continue
          const row = i === r.idx ? r : { ...r, idx: i }
          if (!isTmp(r.id) && snapshot.get(r.id) === rowSig(row)) continue
          send.push({ ...(isTmp(r.id) ? {} : { id: r.id }), idx: i, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells })
          sentIds.push(r.id)
        }
        const present = new Set(rows.map((r) => r.id))
        const deleteIds = [...snapshot.keys()].filter((id) => !present.has(id))
        if (send.length === 0 && deleteIds.length === 0) { set({ save: 'saved', saveError: '' }); return }
        set({ save: 'saving' })
        const r = await api()?.pricelist?.saveRows({ tabId, rows: send, ...(deleteIds.length > 0 ? { deleteIds } : {}) })
        if (!r || !r.ok) { set({ save: 'error', saveError: r ? msg(r) : 'The Price List is not available' }); return }
        if (get().tabId !== tabId) return // the owner moved to another tab meanwhile; that tab was loaded fresh
        const map = new Map<string, PriceRow>()
        r.data.rows.forEach((saved, i) => { const old = sentIds[i]; if (old !== undefined) map.set(old, saved) })
        for (const id of deleteIds) snapshot.delete(id)
        for (const saved of r.data.rows) snapshot.set(saved.id, rowSig(saved))
        // Replace temporary ids by the real ones (the owner may have kept typing: only ids are swapped, content is left alone).
        const cur = get().rows.map((x) => { const m = map.get(x.id); return m && m.id !== x.id ? { ...x, id: m.id } : x })
        const changedAgain = cur.some((x, i) => !(isTmp(x.id) && isBlankRow(x)) && snapshot.get(x.id) !== rowSig(i === x.idx ? x : { ...x, idx: i }))
        set({ rows: cur, save: changedAgain ? 'dirty' : 'saved', saveError: '' })
        if (changedAgain) schedule()
      }
      flushing = run().finally(() => { flushing = null })
      await flushing
    },

    reset() {
      if (timer) { clearTimeout(timer); timer = null }
      history = createHistory({ coalesceMs: 0 })
      snapshot = new Map()
      loadSeq++
      if (dupTimer) { clearTimeout(dupTimer); dupTimer = null }
      set({ ...emptyState(), focusTick: 0, dupWarn: '' })
    }
  }
})
