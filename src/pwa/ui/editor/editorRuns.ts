import type { Runs } from '../../../shared/types'
import type { EditorState } from './editorModel'

/** The styled name runs of one row (for the collapsed row's bold / red display). */
export function runsOf(s: EditorState, id: string): Runs {
  return s.bill.rows.find((r) => r.id === id)?.nameRuns ?? []
}
