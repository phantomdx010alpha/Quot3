import { z } from 'zod'
import { wrapHandler } from './envelope'

/** Phase 16 — the slice of Electron's `clipboard` this module needs (injected so it is testable without Electron). */
export interface ClipboardPort {
  readText(): Promise<string>
  /** Text of one custom clipboard flavour, or `null` when the clipboard does not carry it. Never throws. */
  readFlavour(format: string): Promise<string | null>
  /** Phase 31: put plain text (and an optional HTML table flavour) on the OS clipboard. */
  write(data: { text: string; html?: string }): Promise<void> | void
}

/** Same string as `QUOT3_GRID_MIME` in `src/shared/tsv/gridClip.ts` (main does not import renderer-facing modules for one constant). */
export const QUOT3_CLIPBOARD_FORMAT = 'application/x-quot3-grid'
/** Clipboard text above this is ignored (a pasted novel must not stall the UI or the IPC pipe). */
export const MAX_CLIPBOARD_CHARS = 2_000_000

const empty = z.object({}).strict()
const output = z.object({ tsv: z.string().optional(), quot3: z.string().optional() }).strict()
const writeInput = z.object({ text: z.string().min(1).max(MAX_CLIPBOARD_CHARS), html: z.string().max(MAX_CLIPBOARD_CHARS * 2).optional() }).strict()

/** `clipboard:*` handlers: `readGrid` (Phase 16) and `writeTsv` (Phase 31). */
export function clipboardHandlers(cb: ClipboardPort): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'clipboard:readGrid': wrapHandler(
      empty,
      async () => {
        const out: { tsv?: string; quot3?: string } = {}
        const text = await cb.readText()
        if (text !== '' && text.length <= MAX_CLIPBOARD_CHARS) out.tsv = text
        try {
          const flavour = await cb.readFlavour(QUOT3_CLIPBOARD_FORMAT)
          if (flavour && flavour.length <= MAX_CLIPBOARD_CHARS) out.quot3 = flavour
        } catch { /* no such format on the clipboard: plain TSV only */ }
        return out
      },
      output
    ),
    'clipboard:writeTsv': wrapHandler(
      writeInput,
      async (input) => { await cb.write(input.html === undefined ? { text: input.text } : { text: input.text, html: input.html }); return {} },
      empty
    )
  }
}
