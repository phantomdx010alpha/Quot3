import { describe, expect, it } from 'vitest'
import type { ImportReport } from '../plan'
import { clashChoiceFor, importedNote, legacyRefNumber, legacyRefScore, previewLines, renderReport, reportToCsv, reportToText } from '../uiModel'
import { rankBills, type SearchCandidate } from '../../history/historySearch'

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  filesFound: 5, filesRead: 4, errors: [{ file: 'bad.json', error: 'Not valid JSON' }], created: 3,
  skipped: [{ file: 'dup.json', reason: 'sameBillTwice', detail: 'Same bill saved twice, "later" kept' }],
  renumbered: [{ file: 'BR1_106.json', legacyRef: 'BR1_106', oldNumber: 106, newPoSeq: 769, newPo: 'Q3-0769', reason: 'number already used' }],
  clashGroups: [{ number: 106, files: [{ file: 'a.json', party: 'Zakers, Co', date: '2026-10-01', defaultAction: 'keep', reason: 'earliest' }] }],
  duplicateBillNoGroups: 1, poFirst: 1, poLast: 3, nextSeqAfter: 4, nextPoAfter: 'Q3-0004', newParties: 2, existingParties: 1,
  totalDifferences: [{ file: 'a.json', legacy: '100', recomputed: '102', note: 'left out the X adjustment' }],
  formats: { gst: 1, nonGst: 2, defaultMode: 0 }, convert: {} as ImportReport['convert'], ignored: {} as ImportReport['ignored'], warnings: ['blank party in c.json'],
  ...over
})

describe('legacy import UI model', () => {
  it('reads the number at the end of a reference', () => {
    expect(legacyRefNumber('BR1_106')).toBe('106')
    expect(legacyRefNumber('abc')).toBe('')
  })

  it('scores a search word against the legacy reference: whole ref, trailing number, prefix, contains', () => {
    expect(legacyRefScore('br1_106', 'BR1_106')).toBe(850)
    expect(legacyRefScore('106', 'BR1_106')).toBe(700)
    expect(legacyRefScore('0106', 'BR1_106')).toBe(700)
    expect(legacyRefScore('br1', 'BR1_106')).toBe(560)
    expect(legacyRefScore('1_1', 'BR1_106')).toBe(450)
    expect(legacyRefScore('107', 'BR1_106')).toBe(0)
    expect(legacyRefScore('106', undefined)).toBe(0)
    expect(legacyRefScore('', 'BR1_106')).toBe(0)
  })

  it('History search finds an imported bill by BR1_106 and by 106, and ignores bills made here', () => {
    const base = { partyName: 'Zakers', grandTotal: '10', branchId: 'b', revision: 1, billDate: '2026-10-01', itemText: '' }
    const cands: SearchCandidate[] = [
      { ...base, id: 'i', poNumber: 'Q3-0007', poSeq: 7, legacyRef: 'BR1_106', importBatchId: 'x' },
      { ...base, id: 'h', poNumber: 'Q3-0008', poSeq: 8 }
    ]
    expect(rankBills(cands, 'BR1_106').hits.map((h) => h.id)).toEqual(['i'])
    const h106 = rankBills(cands, '106').hits
    expect(h106.map((h) => h.id)).toEqual(['i'])
    expect(h106[0]!.matchedOn).toEqual(['legacy'])
  })

  it('builds the Create header note', () => {
    expect(importedNote({ legacyRef: 'BR1_106', importBatchId: 'x' }, '2026-10-08')).toBe('Imported from the old app \u00b7 old number BR1_106 \u00b7 08-10-26')
    expect(importedNote({ legacyRef: 'BR1_106', importBatchId: 'x' }, '')).toBe('Imported from the old app \u00b7 old number BR1_106')
  })

  it('maps the planner default to a dropdown choice', () => {
    expect(clashChoiceFor('keep')).toBe('import')
    expect(clashChoiceFor('skip')).toBe('skip')
    expect(clashChoiceFor('renumber')).toBe('renumber')
  })

  it('describes the preview', () => {
    const l = previewLines(report())
    expect(l[0]).toBe('5 files found, 4 readable, 1 file with a problem')
    expect(l[1]).toContain('3 bills will be created')
    expect(l.join('\n')).toContain('Next new bill after the import: Q3-0004')
    expect(l.join('\n')).toContain('recalculated total differs')
    expect(previewLines(report({ poFirst: null, poLast: null, totalDifferences: [] })).join('\n')).not.toContain('Numbers used')
  })

  it('writes the report as text with every section', () => {
    const t = reportToText(report(), { sourceLabel: 'Bills_JSON', poPrefix: 'Q3', at: '2026-10-11' })
    expect(t).toContain('Source: Bills_JSON')
    expect(t).toContain('bad.json: Not valid JSON')
    expect(t).toContain('BR1_106 -> Q3-0769')
    expect(t).toContain('old 100, new 102 - left out the X adjustment')
    expect(t.endsWith('\r\n')).toBe(true)
  })

  it('writes the report as CSV with quoting', () => {
    const c = reportToCsv(report())
    const lines = c.trimEnd().split('\r\n')
    expect(lines[0]).toBe('section,file,detail')
    expect(lines).toContain('problem,bad.json,Not valid JSON')
    expect(c).toContain('"Same bill saved twice, ""later"" kept"')
    expect(c).toContain('"No. 106; Zakers, Co; 2026-10-01; earliest"')
    expect(renderReport('csv', report(), { sourceLabel: 's', poPrefix: 'Q3' })).toBe(c)
  })
})
