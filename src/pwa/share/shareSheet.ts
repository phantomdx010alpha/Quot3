/**
 * Phase 184 - phone share, step 4: hand a file to the system share sheet (Web Share with files, so it can go straight to WhatsApp),
 * or save it as a normal download when sharing is unavailable. The environment is injected so every path is testable.
 * Sharing never touches the bill. Real Android behaviour (WhatsApp receives the file) is NOT proven from the sandbox.
 */
export interface ShareNavigator {
  canShare?: (data: { files?: File[]; title?: string }) => boolean
  share?: (data: { files?: File[]; title?: string }) => Promise<void>
}
export interface ShareEnv {
  nav: ShareNavigator | undefined
  /** Make a File (the browser's `new File`). */
  makeFile: (bytes: Uint8Array, name: string, mime: string) => File
  /** Save a file the normal way (an <a download> click). */
  download: (file: File) => void
}
export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'
export interface ShareResult { outcome: ShareOutcome; fileName: string }

export function browserShareEnv(): ShareEnv {
  return {
    nav: typeof navigator !== 'undefined' ? (navigator as unknown as ShareNavigator) : undefined,
    makeFile: (bytes, name, mime) => new File([bytes as BlobPart], name, { type: mime }),
    download: (file) => {
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url; a.download = file.name; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  }
}

/** True when this browser can share this file through the system sheet. */
export function canShareFile(env: ShareEnv, file: File): boolean {
  const n = env.nav
  if (!n || typeof n.share !== 'function' || typeof n.canShare !== 'function') return false
  try { return n.canShare({ files: [file] }) === true } catch { return false }
}

export async function shareFile(env: ShareEnv, bytes: Uint8Array, fileName: string, mime: string, title: string): Promise<ShareResult> {
  const file = env.makeFile(bytes, fileName, mime)
  if (canShareFile(env, file)) {
    try {
      await env.nav!.share!({ files: [file], title })
      return { outcome: 'shared', fileName }
    } catch (e) {
      // The person closed the sheet: not an error, and no download. Anything else (blocked, expired tap): fall back to a download.
      if (e instanceof Error && e.name === 'AbortError') return { outcome: 'cancelled', fileName }
    }
  }
  env.download(file)
  return { outcome: 'downloaded', fileName }
}

/** `Quotation-<PO>-<party>.png`: letters, digits, dot, dash only; never empty; bounded length. */
export function shareFileName(poNumber: string, party: string, ext: 'png' | 'pdf'): string {
  const clean = (s: string, max: number): string => s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '')
  const parts = ['Quotation', clean(poNumber, 30), clean(party, 30)].filter((p) => p !== '')
  return `${parts.join('-')}.${ext}`
}
