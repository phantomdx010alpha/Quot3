import { z } from 'zod'
import type { WipeService } from '../services/wipeService'
import { PUBLISHER_EMAIL, publisherMailto } from '../../shared/appInfo'
import { AppError, wrapHandler } from './envelope'

const empty = z.object({}).strict()
const start = z.object({
  options: z.object({
    level: z.union([z.literal(1), z.literal(2)]),
    poStart: z.number().int().min(1).max(99_999_999),
    removeBackups: z.boolean(),
    removeThemes: z.boolean(),
    removeLogs: z.boolean(),
    removeAssets: z.boolean()
  }).strict(),
  confirm: z.string().max(60)
}).strict()

/** `wipe:*` handlers (Phase 90). IPC calls the service only. */
export function wipeHandlers(svc: WipeService): Record<string, (raw: unknown) => Promise<unknown>> {
  return { 'wipe:start': wrapHandler(start, (i) => svc.start(i)) }
}

/** The Electron parts of the publisher contact (injected so it is testable). The address and the mailto link are built HERE from constants; the renderer sends nothing. */
export interface PublisherPorts { writeText(text: string): void; openExternal(url: string): Promise<void> }

/** `publisher:*` handlers (Phase 90): copy the email, or open the mail app. */
export function publisherHandlers(ports: PublisherPorts): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'publisher:copyEmail': wrapHandler(empty, () => { ports.writeText(PUBLISHER_EMAIL); return { copied: true as const } }),
    'publisher:openMail': wrapHandler(empty, async () => {
      try { await ports.openExternal(publisherMailto()) } catch { throw new AppError('IO_ERROR', 'Could not open a mail app. The address was not changed; use Copy instead.') }
      return { opened: true as const }
    })
  }
}
