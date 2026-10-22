/** Phase 191 - the bill date field's pure part. Over the existing `setBillDate`; an invalid or cleared value never changes the bill. */
import { setBillDate, type EditorState } from '../editor/editorModel'

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const y = Number(s.slice(0, 4)); const m = Number(s.slice(5, 7)); const d = Number(s.slice(8, 10))
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** `setBillDate` for a real date; the SAME state object otherwise. */
export function changeBillDate(s: EditorState, value: string): EditorState {
  return isIsoDate(value) ? setBillDate(s, value) : s
}
