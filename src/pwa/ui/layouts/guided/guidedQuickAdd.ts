import type { EditorRowView } from '../../editor/editorModel'

/** A row with nothing typed (the editor always keeps one empty row to type in). Quick-add fills such a row before it adds another. */
export const isBlankRow = (r: Pick<EditorRowView, 'name' | 'qty' | 'rate' | 'override'>): boolean => r.name.trim() === '' && r.qty === '' && r.rate === '' && r.override === ''

export interface QuickFields { name: string; qty: string; rate: string; gst: string }
export const EMPTY_QUICK: QuickFields = { name: '', qty: '', rate: '', gst: '' }

/** Quick-add needs an item name; everything else is optional (a line without a rate shows as 0, like the classic editor). */
export const quickAddIssue = (q: QuickFields): string | null => (q.name.trim() === '' ? 'Type the item name first.' : null)
