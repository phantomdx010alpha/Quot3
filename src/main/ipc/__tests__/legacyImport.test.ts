import { describe, expect, it, vi } from 'vitest'
import { legacyImportHandlers, MAX_SOURCES, type LegacyIpcDeps, type LegacyPicker } from '../legacyImport'
import type { LegacyImportService } from '../../services/legacyImportService'
import type { ImportReport } from '../../../shared/legacyImport'

const report = { filesFound: 1, filesRead: 1, errors: [], created: 1, skipped: [], renumbered: [], clashGroups: [], duplicateBillNoGroups: 0, poFirst: 1, poLast: 1, nextSeqAfter: 2, nextPoAfter: 'Q3-0002', newParties: 0, existingParties: 0, totalDifferences: [], formats: { gst: 0, nonGst: 1, defaultMode: 0 }, warnings: [] } as unknown as ImportReport

function setup(over: Partial<LegacyImportService> = {}, pick: Partial<LegacyPicker> = {}) {
  const calls: Array<{ fn: string; source: unknown; choices: unknown }> = []
  const svc: LegacyImportService = {
    readSource: vi.fn(),
    preview: vi.fn(async (source, choices, run) => { calls.push({ fn: 'preview', source, choices }); run?.onProgress?.({ done: 1, total: 2 }); return { sourceLabel: 'L', poPrefix: 'Q3', report, canImport: true } }),
    commit: vi.fn(async (source, choices) => { calls.push({ fn: 'commit', source, choices }); return { batchId: 'b1', sourceLabel: 'L', poPrefix: 'Q3', report, backupFile: 'x.db', reportFile: null } }),
    listBatches: vi.fn(() => []),
    billTag: vi.fn((id) => (id === 'imp' ? { legacyRef: 'BR1_106', importBatchId: 'b1' } : null)),
    undo: vi.fn(() => ({ deleted: 2, keptEdited: [], alreadyDeleted: 0, partiesRemoved: 1 })),
    ...over
  }
  const events: unknown[] = []
  const written: Array<{ path: string; text: string }> = []
  const picker: LegacyPicker = {
    pickFolder: async () => 'C:\\Users\\owner\\Secret Folder\\Bills',
    pickFiles: async () => ['C:\\x\\a.json', 'C:\\x\\b.json'],
    savePath: async () => 'C:\\out\\r.csv',
    ...pick
  }
  const deps: LegacyIpcDeps = { picker, writeText: async (path, text) => { written.push({ path, text }) }, emit: (_c, p) => { events.push(p) }, now: () => new Date('2026-10-11T00:00:00Z') }
  const h = legacyImportHandlers(svc, deps)
  return { h, svc, calls, events, written }
}
type Res = { ok: boolean; data?: any; error?: { code: string; message: string } }
const call = async (h: Record<string, (r: unknown) => Promise<unknown>>, ch: string, input: unknown = {}): Promise<Res> => (await h[ch]!(input)) as Res

describe('legacyImport IPC (Phase 86)', () => {
  it('pick hands the renderer an opaque id and a label, never the path', async () => {
    const { h } = setup()
    const r = await call(h, 'legacyImport:pick', { kind: 'folder' })
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ kind: 'folder', label: 'Bills' })
    expect(JSON.stringify(r)).not.toContain('Secret')
    expect(JSON.stringify(r)).not.toContain('C:\\')
    const f = await call(h, 'legacyImport:pick', { kind: 'files' })
    expect(f.data.label).toBe('2 files')
  })

  it('a cancelled dialog answers null', async () => {
    const { h } = setup({}, { pickFolder: async () => null, pickFiles: async () => [] })
    expect((await call(h, 'legacyImport:pick', { kind: 'folder' })).data).toBeNull()
    expect((await call(h, 'legacyImport:pick', { kind: 'files' })).data).toBeNull()
  })

  it('preview / commit run the service on the held source, pass choices, and send progress', async () => {
    const { h, calls, events } = setup()
    const id = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    const p = await call(h, 'legacyImport:preview', { sourceId: id, choices: { 'a.json': 'skip' } })
    expect(p.ok).toBe(true)
    expect(calls[0]).toEqual({ fn: 'preview', source: { kind: 'folder', path: 'C:\\Users\\owner\\Secret Folder\\Bills' }, choices: { 'a.json': 'skip' } })
    expect(events).toEqual([{ sourceId: id, done: 1, total: 2 }])
    const c = await call(h, 'legacyImport:commit', { sourceId: id })
    expect(c.data).toMatchObject({ batchId: 'b1' })
    expect(calls[1]!.fn).toBe('commit')
  })

  it('an unknown or released source is NOT_FOUND', async () => {
    const { h } = setup()
    expect((await call(h, 'legacyImport:preview', { sourceId: 'nope' })).error?.code).toBe('NOT_FOUND')
    const id = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    await call(h, 'legacyImport:release', { sourceId: id })
    expect((await call(h, 'legacyImport:commit', { sourceId: id })).error?.code).toBe('NOT_FOUND')
  })

  it('forgets the oldest source beyond the cap', async () => {
    const { h } = setup()
    const first = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    for (let i = 0; i < MAX_SOURCES; i++) await call(h, 'legacyImport:pick', { kind: 'folder' })
    expect((await call(h, 'legacyImport:preview', { sourceId: first })).error?.code).toBe('NOT_FOUND')
  })

  it('refuses a second run while one is active, and cancel aborts it', async () => {
    let started!: () => void
    const running = new Promise<void>((r) => { started = r })
    const { h } = setup({
      preview: vi.fn((_s, _c, run) => new Promise<never>((_res, rej) => { started(); run?.signal?.addEventListener('abort', () => rej(new Error('The import was cancelled. Nothing was changed.'))) }))
    })
    const id = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    const first = call(h, 'legacyImport:preview', { sourceId: id })
    await running
    expect((await call(h, 'legacyImport:commit', { sourceId: id })).error?.code).toBe('VALIDATION')
    await call(h, 'legacyImport:cancel')
    expect((await first).ok).toBe(false)
    // the lock is released afterwards
    const again = await call(h, 'legacyImport:commit', { sourceId: id })
    expect(again.error?.code).not.toBe('VALIDATION')
  })

  it('saves the last report as csv / text through the Save dialog; nothing before a report exists', async () => {
    const { h, written } = setup()
    const id = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    expect((await call(h, 'legacyImport:saveReport', { sourceId: id, format: 'csv' })).error?.code).toBe('VALIDATION')
    await call(h, 'legacyImport:preview', { sourceId: id })
    const r = await call(h, 'legacyImport:saveReport', { sourceId: id, format: 'csv' })
    expect(r.data).toEqual({ saved: true })
    expect(written[0]!.path).toBe('C:\\out\\r.csv')
    expect(written[0]!.text.startsWith('section,file,detail')).toBe(true)
    await call(h, 'legacyImport:saveReport', { sourceId: id, format: 'text' })
    expect(written[1]!.text).toContain('Source: Bills')
  })

  it('a cancelled Save dialog writes nothing; a failed write is IO_ERROR', async () => {
    const a = setup({}, { savePath: async () => null })
    const ia = (await call(a.h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    await call(a.h, 'legacyImport:preview', { sourceId: ia })
    expect((await call(a.h, 'legacyImport:saveReport', { sourceId: ia, format: 'text' })).data).toBeNull()
    expect(a.written).toHaveLength(0)
    const svc = setup().svc
    const h = legacyImportHandlers(svc, { picker: { pickFolder: async () => 'C:\\b', pickFiles: async () => null, savePath: async () => 'C:\\o.txt' }, writeText: async () => { throw new Error('EPERM') }, emit: () => undefined })
    const ib = (await call(h, 'legacyImport:pick', { kind: 'folder' })).data.sourceId as string
    await call(h, 'legacyImport:preview', { sourceId: ib })
    expect((await call(h, 'legacyImport:saveReport', { sourceId: ib, format: 'text' })).error?.code).toBe('IO_ERROR')
  })

  it('undo, list and billTag go to the service; payloads are validated', async () => {
    const { h, svc } = setup()
    expect((await call(h, 'legacyImport:undo', { batchId: 'b1' })).data).toMatchObject({ deleted: 2 })
    expect(svc.undo).toHaveBeenCalledWith('b1')
    expect((await call(h, 'legacyImport:list')).data).toEqual([])
    expect((await call(h, 'legacyImport:billTag', { billId: 'imp' })).data).toEqual({ legacyRef: 'BR1_106', importBatchId: 'b1' })
    expect((await call(h, 'legacyImport:billTag', { billId: 'mine' })).data).toBeNull()
    expect((await call(h, 'legacyImport:undo', {})).error?.code).toBe('VALIDATION')
    expect((await call(h, 'legacyImport:pick', { kind: 'zip' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'legacyImport:preview', { sourceId: 'x', choices: { f: 'maybe' } })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'legacyImport:preview', { sourceId: 'x', path: 'C:\\evil' })).error?.code).toBe('VALIDATION')
  })
})
