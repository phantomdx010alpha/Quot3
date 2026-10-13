/**
 * Phase 117 - pure windowing for the Items "Groups" list (replaces the @tanstack/react-virtual measurement that drew blank
 * rows after scrolling). Fixed row height, so everything is plain arithmetic: no measuring of rows, no absolute positions.
 */
export interface VisibleRange { start: number; end: number }

/** Rows drawn when the viewport has not been measured yet (jsdom / first paint): never a blank list. */
export const UNMEASURED_ROWS = 60

/** First and last (exclusive) row index to draw for `count` rows of `rowPx` height in a viewport `viewportPx` tall scrolled by `scrollTop`. */
export function visibleRange(count: number, rowPx: number, scrollTop: number, viewportPx: number, overscan: number): VisibleRange {
  if (count <= 0 || rowPx <= 0) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  if (viewportPx <= 0) return { start: 0, end: Math.min(count, UNMEASURED_ROWS) }
  const first = Math.floor(top / rowPx)
  const last = Math.ceil((top + viewportPx) / rowPx)
  return { start: Math.max(0, Math.min(count - 1, first - overscan)), end: Math.min(count, Math.max(first + 1, last) + overscan) }
}

/** The scrollTop that brings row `index` fully into view with the least movement (unchanged when it is already visible). */
export function scrollTopFor(index: number, rowPx: number, scrollTop: number, viewportPx: number, count: number): number {
  if (index < 0 || index >= count || viewportPx <= 0) return scrollTop
  const rowTop = index * rowPx
  if (rowTop < scrollTop) return rowTop
  if (rowTop + rowPx > scrollTop + viewportPx) return rowTop + rowPx - viewportPx
  return scrollTop
}
