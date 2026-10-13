import { z } from 'zod'
import type { DashboardService } from '../services/dashboardService'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()

/** `dashboard:*` handlers (Phase 46). IPC calls the service only. */
export function dashboardHandlers(svc: DashboardService): Record<string, (raw: unknown) => Promise<unknown>> {
  return { 'dashboard:stats': wrapHandler(empty, () => svc.stats()) }
}
