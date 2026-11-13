import { afterEach, describe, expect, it } from 'vitest'
import { createPriceListRepo } from '../../db/priceListRepo'
import { createPriceLogRepo } from '../../db/priceLogRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { getLocalBranch } from '../../db/seed'
import { createPriceListService } from '../../services/priceListService'
import { priceListHandlers } from '../pricelist'

// Phase 236 (M23): the `pricelist:*` channels validate untrusted input and wrap errors; invented names only.
let t: TestDb | undefined
afterEach(() => { t?.cleanup(); t = undefined })
const mk = () => {
  t = openTestDb()
  const s = t.handle.sqlite
  return priceListHandlers(createPriceListService({ repo: createPriceListRepo(s), logRepo: createPriceLogRepo(s), branchId: () => getLocalBranch(s).id }))
}
type R = { ok: boolean; data?: any; error?: { code: string } } // eslint-disable-line @typescript-eslint/no-explicit-any

describe('pricelist IPC', () => {
  it('exposes exactly the Phase 236 channels plus the Phase 237 import channels', () => {
    expect(Object.keys(mk()).sort()).toEqual(['pricelist:activity', 'pricelist:activityAccess', 'pricelist:activityCsv', 'pricelist:clear', 'pricelist:columns', 'pricelist:importPick', 'pricelist:importPreview', 'pricelist:importRun', 'pricelist:log', 'pricelist:perms', 'pricelist:permsList', 'pricelist:permsSet', 'pricelist:purge', 'pricelist:restore', 'pricelist:rows', 'pricelist:saveRows', 'pricelist:structure', 'pricelist:trash', 'pricelist:tree'])
  })

  it('round trip: add a category and a tab, save a row, read it back', async () => {
    const h = mk()
    const c = (await h['pricelist:structure']!({ op: 'addCategory', name: 'Tea' })) as R
    const tab = (await h['pricelist:structure']!({ op: 'addTab', categoryId: c.data.id, name: 'Loose' })) as R
    const saved = (await h['pricelist:saveRows']!({ tabId: tab.data.id, rows: [{ kind: 'item', nameRuns: [{ t: 'Assam', b: 1 }], cells: { c1: '99.50' } }] })) as R
    expect(saved.ok).toBe(true)
    const rows = (await h['pricelist:rows']!({ tabId: tab.data.id })) as R
    expect(rows.data[0].cells).toEqual({ c1: '99.5' })
    expect(rows.data[0].nameRuns).toEqual([{ t: 'Assam', b: 1 }])
  })

  it('rejects unknown keys, bad ops and oversized input with VALIDATION; domain refusals keep their code', async () => {
    const h = mk()
    expect(((await h['pricelist:structure']!({ op: 'format_disk' })) as R).error?.code).toBe('VALIDATION')
    expect(((await h['pricelist:structure']!({ op: 'addCategory', name: 'x', extra: 1 })) as R).error?.code).toBe('VALIDATION')
    expect(((await h['pricelist:saveRows']!({ tabId: 'a', rows: Array.from({ length: 2001 }, () => ({ kind: 'item', nameRuns: [], cells: {} })) })) as R).error?.code).toBe('VALIDATION')
    expect(((await h['pricelist:rows']!({ tabId: 'missing' })) as R).error?.code).toBe('NOT_FOUND')
    expect(((await h['pricelist:clear']!({ typed: 'nope' })) as R).error?.code).toBe('VALIDATION')
    expect(((await h['pricelist:tree']!({ stray: true })) as R).ok).toBe(false)
  })
})
