import { z } from 'zod'
import { AUDIT_PAGE_MAX, AUDIT_SEARCH_MAX } from '../../shared/audit'
import type { AuditService } from '../services/auditService'
import type { DiagnosticsService } from '../services/diagnosticsService'
import { wrapHandler } from './envelope'

const none = z.object({}).strict()
const short = z.string().min(1).max(64)
const iso = z.string().min(10).max(40)
const listInput = z.object({
  entity: short.optional(),
  action: short.optional(),
  from: iso.optional(),
  to: iso.optional(),
  search: z.string().max(AUDIT_SEARCH_MAX).optional(),
  beforeId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(AUDIT_PAGE_MAX).optional()
}).strict()
const reportInput = z.object({
  kind: z.enum(['error', 'rejection', 'render']),
  message: z.string().max(2000),
  stack: z.string().max(20_000).optional()
}).strict()

/** `audit:*` (Phase 61 viewer, read-only) and `diagnostics:*` (renderer error reports, Copy diagnostics, the launch crash notice). */
export function auditHandlers(audit: AuditService, diagnostics: DiagnosticsService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'audit:list': wrapHandler(listInput, (q) => audit.list(q)),
    'audit:facets': wrapHandler(none, () => audit.facets()),
    'diagnostics:report': wrapHandler(reportInput, (r) => diagnostics.report(r)),
    'diagnostics:copy': wrapHandler(none, () => diagnostics.copy()),
    'diagnostics:crashNotice': wrapHandler(none, () => ({ notice: diagnostics.crashNotice() })),
    'diagnostics:dismissCrash': wrapHandler(none, () => { diagnostics.dismissCrash(); return {} })
  }
}
