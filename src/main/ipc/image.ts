import { z } from 'zod'
import type { ImageService } from '../services/imageService'
import { wrapHandler } from './envelope'
import { billForPrint, printBill } from './print'

const input = z.object({
  // The SAME bill shape as print:* (incl. `roundOff`, Phase 120) - a narrower copy here made 'Copy image' fail with 'Invalid request' once round-off was on.
  bill: printBill,
  mode: z.enum(['rough', 'professional'])
}).strict()

/** `image:*` handlers (Phase 39). IPC calls the service only. */
export function imageHandlers(svc: ImageService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'image:copy': wrapHandler(input, (i) => svc.copy({ bill: billForPrint(i.bill), mode: i.mode })),
    // Phase 71: idle pre-render into the content-hash cache; never touches the clipboard.
    'image:prerender': wrapHandler(input, (i) => svc.prerender({ bill: billForPrint(i.bill), mode: i.mode }))
  }
}
