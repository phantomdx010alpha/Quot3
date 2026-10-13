import { z } from 'zod'
import type { PartyImportService } from '../services/partyImportService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const col = z.number().int().min(0).max(500).nullable()
const mapping = z.object({ name: col, phone: col, address: col, transport: col }).strict()
const source = {
  filePath: z.string().min(1).max(1024),
  sheet: z.string().min(1).max(100).optional(),
  headerRow: z.number().int().min(1).max(100_000).optional()
}
const mode = z.enum(['skip', 'update'])
const previewInput = z.object({ ...source, mapping: mapping.optional(), mode: mode.optional() }).strict()
const commitInput = z.object({ ...source, mapping, mode }).strict()
const undoInput = z.object({ importId: z.string().min(1).max(64) }).strict()

export interface FilePicker { pick(): Promise<string | null> }

/** `partyImport:*` handlers (Phase 47). IPC calls the service (and the native file dialog port) only. */
export function partyImportHandlers(svc: PartyImportService, picker: FilePicker): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'partyImport:pickFile': wrapHandler(empty, async () => {
      const filePath = await picker.pick()
      return filePath ? { filePath } : null
    }),
    'partyImport:preview': wrapHandler(previewInput, (i) => svc.preview(i)),
    'partyImport:commit': wrapHandler(commitInput, (i) => svc.commit(i)),
    'partyImport:undo': wrapHandler(undoInput, (i) => svc.undo(i.importId)),
    'partyImport:list': wrapHandler(empty, () => svc.list())
  }
}
