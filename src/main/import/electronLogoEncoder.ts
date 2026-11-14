import { nativeImage } from 'electron'

/** Phase 270 - a real resize to PNG for the company logo that is shared through the master (<= 150 KB is checked by the caller). Electron only; not unit tested. */
export function encodeLogoPng(bytes: Uint8Array, maxSide: number): Uint8Array | null {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const out = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }) : img
  return new Uint8Array(out.toPNG())
}
