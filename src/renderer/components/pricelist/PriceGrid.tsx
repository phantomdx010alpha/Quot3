import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { matchShortcut } from '@shared/shortcuts'
import { rangeBounds } from '@shared/nav/cellNav'
import { cellText, gridColumns, type GridCol } from '@shared/pricelist/gridModel'
import { hasNoPrice } from '@shared/pricelist/rows'
import type { PriceRow } from '@shared/pricelist/types'
import { hasStyle } from '@shared/richtext/format'
import { parseQuot3Payload, serializeQuot3Payload, QUOT3_GRID_MIME, type GridClipCell } from '@shared/tsv/gridClip'
import { parseTsv } from '@shared/tsv/tsvCodec'
import { clampColWidth } from '@shared/columnWidths'
import { usePriceListStore } from '../../stores/priceListStore'

const ROW_PX = 26

function NameRuns({ row }: { row: PriceRow }): React.JSX.Element {
  if (!hasStyle(row.nameRuns)) return <>{row.nameRuns.map((r) => r.t).join('')}</>
  return (
    <>
      {row.nameRuns.map((r, i) => (r.b || r.r || r.hl
        ? <span key={i} className="q3-run" {...(r.b ? { 'data-b': '1' } : {})} {...(r.r ? { 'data-r': '1' } : {})} {...(r.hl ? { 'data-hl': '1' } : {})}>{r.t}</span>
        : <span key={i}>{r.t}</span>))}
    </>
  )
}

interface RowProps {
  row: PriceRow
  index: number
  cols: readonly GridCol[]
  tmpl: string
  /** Column index of the active cell when this row holds it, else -1 (a primitive so unrelated rows never re-render). */
  activeCol: number
  /** Range columns [left, right] when this row is inside the range, else null. */
  rangeCols: string
  noPrice: boolean
}

const PriceRowView = memo(function PriceRowView({ row, index, cols, tmpl, activeCol, rangeCols, noPrice }: RowProps): React.JSX.Element {
  const [rl, rr] = rangeCols === '' ? [-1, -2] : rangeCols.split(':').map(Number) as [number, number]
  return (
    <div className={`q3-gr q3-plrow${row.kind === 'section' ? ' q3-plrow--section' : ''}`} role="row" style={{ gridTemplateColumns: tmpl }} data-row={index} data-row-id={row.id} {...(activeCol >= 0 ? { 'data-active-row': '' } : {})} {...(noPrice ? { 'data-noprice': '' } : {})}>
      {cols.map((col, c) => {
        const active = c === activeCol
        const inRange = c >= rl && c <= rr
        const readOnly = row.kind === 'section' && !col.isName
        return (
          <div key={col.key} role="gridcell" className={`q3-gc q3-gc--${col.isName ? 'left' : col.align}${active ? '' : ''}`} data-col={col.key} data-c={c} data-r={index}
            {...(active ? { 'data-active': '' } : {})} {...(inRange ? { 'data-range': '' } : {})} {...(readOnly ? { 'data-readonly': '' } : {})}>
            {active ? <ActiveInput col={col} /> : (
              <span className="q3-gc__text">
                {col.isName ? <NameRuns row={row} /> : cellText(row, col)}
                {col.isName && noPrice && <span className="q3-pl__noprice"> no price</span>}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
})

/** The one live <input>: it holds the draft of the active cell. Everything else is plain text. */
function ActiveInput({ col }: { col: GridCol }): React.JSX.Element {
  const draft = usePriceListStore((s) => s.draft)
  const nav = usePriceListStore((s) => s.nav)
  const stored = usePriceListStore((s) => {
    const row = s.visibleRows()[s.nav.row]
    return row ? cellText(row, col) : ''
  })
  const readOnly = usePriceListStore((s) => { const row = s.visibleRows()[s.nav.row]; return !!row && row.kind === 'section' && !col.isName })
  const caretCmd = usePriceListStore((s) => s.caretCmd)
  const focusTick = usePriceListStore((s) => s.focusTick)
  const ref = useRef<HTMLInputElement>(null)
  const value = draft ?? stored
  // Focus and caret follow the reducer: Append = caret at the end; Free = wherever the owner put it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (nav.mode === 'append') { const n = el.value.length; el.setSelectionRange(n, n) }
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, nav.row, nav.col])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const n = caretCmd.pos === 'end' ? el.value.length : caretCmd.pos === 'start' ? 0 : caretCmd.pos
    el.setSelectionRange(n, n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretCmd.tick])
  return (
    <input ref={ref} className="q3-pl__input" value={value} readOnly={readOnly} spellCheck={false} autoComplete="off" aria-label={col.label} inputMode={col.numeric ? 'decimal' : 'text'}
      onChange={(e) => usePriceListStore.getState().setDraft(e.target.value)}
      onSelect={(e) => usePriceListStore.getState().syncCaret(e.currentTarget.selectionStart ?? 0)}
      onBlur={() => usePriceListStore.getState().commit()} />
  )
}

/**
 * Phase 238 - the grid. Same cell behaviour as the bill grid because the keys go through the SAME state machine (`navReduce`, KEYBOARD_CELL_RULES.md):
 * Append / Free modes, Tab and Enter with wrap, a fresh row when Tab / Enter runs past the last cell, arrows, F2, Esc, Ctrl+Home / End, Ctrl+Up / Down,
 * Shift+arrows ranges, Ctrl+C / X / V (Excel text and the Quot3 flavour with runs), Ctrl+Z / Y, Ctrl+B / Ctrl+Shift+R on item names.
 */
export function PriceGrid(): React.JSX.Element {
  const tabId = usePriceListStore((s) => s.tabId)
  const tree = usePriceListStore((s) => s.tree)
  const rows = usePriceListStore((s) => s.rows)
  const filter = usePriceListStore((s) => s.filter)
  const navRow = usePriceListStore((s) => s.nav.row)
  const navCol = usePriceListStore((s) => s.nav.col)
  const range = usePriceListStore((s) => s.nav.range)
  const wrap = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => tree?.tabs.find((t) => t.id === tabId)?.columns ?? [], [tree, tabId])
  const cols = useMemo(() => gridColumns(columns), [columns])
  const shown = useMemo(() => {
    const q = filter.contains.trim().toLowerCase()
    if (!filter.noPrice && q === '') return rows
    return rows.filter((r) => {
      if (filter.noPrice && !hasNoPrice(r, columns)) return false
      if (q === '') return true
      return [r.nameRuns.map((x) => x.t).join(''), ...Object.values(r.cells)].join(' ').toLowerCase().includes(q)
    })
  }, [rows, columns, filter])
  const tmpl = useMemo(() => cols.map((c) => `${c.isName ? `minmax(${c.widthPx}px, 1fr)` : `${c.widthPx}px`}`).join(' '), [cols])
  const bounds = range ? rangeBounds(range) : null

  const pageRows = (): number => Math.max(1, Math.floor((wrap.current?.clientHeight ?? 520) / ROW_PX) - 2)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing) return
    // Page actions (insert row, filter, columns, tabs ...) are handled by the page listener, never by the cell.
    if (matchShortcut(e.nativeEvent, ['pricelist'])?.scope === 'pricelist') return
    const handled = usePriceListStore.getState().keyDown({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, pageRows: pageRows() })
    if (handled) e.preventDefault()
  }

  // Clipboard: one cell with a text selection inside the input stays native; a range (or an empty selection) goes through the clip model.
  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut: boolean): void => {
    const st = usePriceListStore.getState()
    const el = e.target as HTMLInputElement
    const hasText = el instanceof HTMLInputElement && (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)
    if (!st.nav.range && hasText) return
    const clip = st.copySelection()
    if (!clip) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', clip.tsv)
    e.clipboardData.setData(QUOT3_GRID_MIME, serializeQuot3Payload(clip.payload))
    if (cut) st.keyDown({ key: 'Delete' }) // Delete clears the cell, or the whole range, as one undo step
  }
  const onPaste = (e: ClipboardEvent<HTMLDivElement>): void => {
    const st = usePriceListStore.getState()
    const q3 = parseQuot3Payload(e.clipboardData.getData(QUOT3_GRID_MIME))
    let matrix: GridClipCell[][] | null = q3 ? q3.cells : null
    if (!matrix) {
      const text = e.clipboardData.getData('text/plain')
      if (text === '') return
      matrix = parseTsv(text).map((l) => l.map((t) => ({ text: t })))
    }
    const single = matrix.length === 1 && matrix[0]?.length === 1
    if (single && !st.nav.range) return // plain text into the cell: native paste (the numeric filter runs in setDraft)
    e.preventDefault()
    st.pasteMatrix(matrix)
  }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')
    if (!cell || e.button !== 0) return
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c)
    const st = usePriceListStore.getState()
    if (st.nav.row === r && st.nav.col === c && !e.shiftKey) return // already active: let the input take the click (caret)
    e.preventDefault()
    st.clickCell(r, c, e.shiftKey)
  }, [])

  // Keep the active row in view when it changes by key (the input scrolls itself; this covers the very first render).
  useEffect(() => { wrap.current?.querySelector<HTMLElement>('[data-active-row]')?.scrollIntoView?.({ block: 'nearest' }) }, [navRow])

  const resize = (col: GridCol, e: React.PointerEvent<HTMLSpanElement>): void => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, start = col.widthPx
    let w = start
    const move = (m: PointerEvent): void => { w = clampColWidth(start + m.clientX - startX) }
    const up = (): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (w !== start) void usePriceListStore.getState().columnsOp({ action: 'update', key: col.key, patch: { widthPx: w } })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  if (cols.length === 0) return <div className="q3-pl__empty" role="status">This tab has no columns yet.</div>
  return (
    <div className="q3-grid q3-plgrid" ref={wrap} role="grid" aria-label="Price list" aria-rowcount={shown.length} onKeyDown={onKeyDown} onCopy={(e) => onCopy(e, false)} onCut={(e) => onCopy(e, true)} onPaste={onPaste} onPointerDown={onPointerDown}>
      <div className="q3-grid__inner">
        <div className="q3-gh" role="row" style={{ gridTemplateColumns: tmpl }}>
          {cols.map((c) => (
            <div key={c.key} className={`q3-gh__cell q3-gc--${c.isName ? 'left' : c.align}`} role="columnheader" data-col={c.key} title={c.label}>
              <span className="q3-gc__text">{c.label}</span>
              <span className="q3-pl__resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} onPointerDown={(e) => resize(c, e)} />
            </div>
          ))}
        </div>
        {shown.map((row, i) => {
          const inRange = bounds && i >= bounds.top && i <= bounds.bottom
          return (
            <PriceRowView key={row.id} row={row} index={i} cols={cols} tmpl={tmpl} activeCol={i === navRow ? navCol : -1}
              rangeCols={inRange && bounds ? `${bounds.left}:${bounds.right}` : ''}
              noPrice={row.kind === 'item' && hasNoPrice(row, columns) && row.nameRuns.length > 0} />
          )
        })}
        {shown.length === 0 && <div className="q3-pl__empty" role="status">{filter.noPrice || filter.contains.trim() !== '' ? 'Nothing matches the filter.' : 'No items yet. Press Ctrl+Enter to add a row, or paste from Excel.'}</div>}
      </div>
    </div>
  )
}
