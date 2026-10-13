import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ImportReport } from '../../shared/legacyImport'
import { renderReport, type LegacyPickResult, type LegacyProgress } from '../../shared/legacyImport/uiModel'
import type { LegacyImportService, LegacySource } from '../services/legacyImportService'
import { AppError, wrapHandler } from './envelope'

/** Native dialogs for the legacy import (the only Electron part; the paths never leave main). */
export interface LegacyPicker {
  pickFolder(): Promise<string | null>
  pickFiles(): Promise<string[] | null>
  /** Save dialog for the report; null = cancelled. */
  savePath(defaultName: string, ext: 'txt' | 'csv'): Promise<string | null>
}

export interface LegacyIpcDeps {
  picker: LegacyPicker
  writeText(path: string, text: string): Promise<void>
  emit(channel: 'legacyImport:progress', payload: LegacyProgress): void
  now?: () => Date
}

/** Last path segment with either separator, so a label never carries a folder path (also correct for a Windows path seen on another OS). */
export const lastSegment = (p: string): string => p.split(/[\\/]+/).filter((x) => x !== '').pop() ?? ''

const empty = z.object({}).strict()
const sourceId = z.string().min(1).max(64)
const choices = z.record(z.string().min(1).max(260), z.enum(['import', 'skip', 'renumber'])).refine((r) => Object.keys(r).length <= 20_000, 'Too many choices')
const pickInput = z.object({ kind: z.enum(['folder', 'files']) }).strict()
const runInput = z.object({ sourceId, choices: choices.optional(), send: z.boolean().optional() }).strict()
const saveInput = z.object({ sourceId, format: z.enum(['text', 'csv']) }).strict()
const batchInput = z.object({ batchId: z.string().min(1).max(64) }).strict()
const billInput = z.object({ billId: z.string().min(1).max(64) }).strict()
const releaseInput = z.object({ sourceId }).strict()

/** Sources the renderer may refer to at once; the oldest is forgotten first. */
export const MAX_SOURCES = 8

interface Held { source: LegacySource; label: string; kind: 'folder' | 'files'; last: { report: ImportReport; poPrefix: string; at: string } | null }

/**
 * `legacyImport:*` handlers (Phase 86). The renderer holds only an opaque `sourceId`; the chosen path stays in this closure.
 * One reading / importing run at a time; `cancel` aborts it until the service's transaction starts.
 */
export function legacyImportHandlers(svc: LegacyImportService, deps: LegacyIpcDeps): Record<string, (raw: unknown) => Promise<unknown>> {
  const held = new Map<string, Held>()
  let active: AbortController | null = null
  const now = deps.now ?? ((): Date => new Date())

  const hold = (source: LegacySource, label: string, kind: 'folder' | 'files'): LegacyPickResult => {
    const id = randomUUID()
    held.set(id, { source, label, kind, last: null })
    while (held.size > MAX_SOURCES) held.delete(held.keys().next().value as string)
    return { sourceId: id, label, kind }
  }
  const get = (id: string): Held => {
    const h = held.get(id)
    if (!h) throw new AppError('NOT_FOUND', 'That import source is no longer available. Choose the folder or files again.')
    return h
  }
  const run = async <T>(id: string, fn: (opts: { signal: AbortSignal; onProgress: (p: { done: number; total: number }) => void }) => Promise<T>): Promise<T> => {
    if (active) throw new AppError('VALIDATION', 'Another import step is still running. Wait for it or cancel it.')
    const ctl = new AbortController()
    active = ctl
    try { return await fn({ signal: ctl.signal, onProgress: (p) => deps.emit('legacyImport:progress', { sourceId: id, done: p.done, total: p.total }) }) }
    finally { active = null }
  }

  return {
    'legacyImport:pick': wrapHandler(pickInput, async (i): Promise<LegacyPickResult | null> => {
      if (i.kind === 'folder') {
        const path = await deps.picker.pickFolder()
        return path ? hold({ kind: 'folder', path }, lastSegment(path) || 'Chosen folder', 'folder') : null
      }
      const paths = await deps.picker.pickFiles()
      return paths && paths.length > 0 ? hold({ kind: 'files', paths }, paths.length === 1 ? lastSegment(paths[0]!) : `${paths.length} files`, 'files') : null
    }),

    'legacyImport:preview': wrapHandler(runInput, async (i) => {
      const h = get(i.sourceId)
      const res = await run(i.sourceId, (o) => svc.preview(h.source, i.choices, o))
      h.last = { report: res.report, poPrefix: res.poPrefix, at: now().toISOString() }
      return res
    }),

    'legacyImport:commit': wrapHandler(runInput, async (i) => {
      const h = get(i.sourceId)
      const res = await run(i.sourceId, (o) => svc.commit(h.source, i.choices, o, i.send))
      h.last = { report: res.report, poPrefix: res.poPrefix, at: now().toISOString() }
      return res
    }),

    'legacyImport:cancel': wrapHandler(empty, () => { active?.abort(); return {} }),
    'legacyImport:release': wrapHandler(releaseInput, (i) => { held.delete(i.sourceId); return {} }),

    'legacyImport:saveReport': wrapHandler(saveInput, async (i) => {
      const h = get(i.sourceId)
      if (!h.last) throw new AppError('VALIDATION', 'There is no report to save yet.')
      const ext = i.format === 'csv' ? 'csv' : 'txt'
      const path = await deps.picker.savePath(`legacy-import-report.${ext}`, ext)
      if (!path) return null
      try { await deps.writeText(path, renderReport(i.format, h.last.report, { sourceLabel: h.label, poPrefix: h.last.poPrefix, at: h.last.at })) }
      catch { throw new AppError('IO_ERROR', 'The report could not be saved there.') }
      return { saved: true as const }
    }),

    'legacyImport:undo': wrapHandler(batchInput, (i) => svc.undo(i.batchId)),
    'legacyImport:list': wrapHandler(empty, () => svc.listBatches()),
    'legacyImport:billTag': wrapHandler(billInput, (i) => svc.billTag(i.billId))
  }
}
