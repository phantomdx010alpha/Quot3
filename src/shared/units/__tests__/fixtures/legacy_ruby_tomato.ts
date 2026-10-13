import type { BillRow, ExtraColDef } from '../../../types'
import { row } from '../../../__fixtures__/bills'

/** Legacy screenshot (legacy_create_screen.png): columns "ruby" and "tomato" with one marked cell. */
export const LEGACY_EXTRA_COLS: ExtraColDef[] = [
  { key: 'ruby', header: 'ruby', kind: 'units' },
  { key: 'tomato', header: 'tomato', kind: 'units' }
]

const RUBY: [string, boolean?][] = [
  ['11.5-1'], ['12.5-1'], ['13-1'], ['13.5-1'], ['14-1'], ['14.5-1'], ['15-1'], ['15.5-1'], ['16-1'], ['16.5-1'], ['17-1'], ['17.5-1'],
  [''], // row 13 blank
  ['idk bruhh', true], // row 14 marked
  ['25-5'], ['25651-45'], ['42-5']
]
const TOMATO = ['5-4', '56-2', '454-1']

export function legacyRubyTomatoRows(): BillRow[] {
  return RUBY.map(([text, marked], i) => {
    const r = row(`item ${i + 1}`, '1', '1')
    r.extras.ruby = marked ? { text, marked: true } : { text }
    const t = TOMATO[i]
    if (t !== undefined) r.extras.tomato = { text: t }
    return r
  })
}

export const EXPECTED = { ruby: '12', idkBruhh: '55', tomato: '7' } as const
