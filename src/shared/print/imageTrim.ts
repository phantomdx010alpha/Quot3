/**
 * Hotfix (Phase 127): a safety net for the image copy. A capture must be "content + padding" and nothing else. If a capture method
 * returns a big white surface with the bill small inside (seen with Professional mode), this finds the real content so the port can
 * reject that capture or trim it. Pure: works on raw BGRA bytes (Electron's `nativeImage.toBitmap()` order; R / B swapped is harmless here
 * because the test is "is every channel near white").
 */

export interface PixelBounds { x: number; y: number; width: number; height: number }

/** A channel at or above this counts as paper white (anti-aliased page edge pixels stay inside the content). */
export const WHITE_MIN = 248

/** Bounding box of every pixel that is not white (alpha 0 counts as white). Null for an all-white or malformed buffer. */
export function nonWhiteBounds(bgra: Uint8Array, width: number, height: number): PixelBounds | null {
  if (!(width > 0) || !(height > 0) || bgra.length < width * height * 4) return null
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      const i = row + x * 4
      if (bgra[i + 3] === 0) continue
      if (bgra[i]! < WHITE_MIN || bgra[i + 1]! < WHITE_MIN || bgra[i + 2]! < WHITE_MIN) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Share of the image's width and height the content covers (1 = content touches all edges). */
export function fillRatio(b: PixelBounds, width: number, height: number): { w: number; h: number } {
  return { w: b.width / width, h: b.height / height }
}

/** True when the content (plus the usual padding) fills the image: both dimensions at least `min` (default 85 %). */
export function isTight(b: PixelBounds | null, width: number, height: number, min = 0.85): boolean {
  if (!b) return false
  const r = fillRatio(b, width, height)
  return r.w >= min && r.h >= min
}

/** The crop that keeps `pad` pixels around the content, clamped to the image. */
export function trimRect(b: PixelBounds, width: number, height: number, pad: number): PixelBounds {
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad)
  const right = Math.min(width, b.x + b.width + pad), bottom = Math.min(height, b.y + b.height + pad)
  return { x, y, width: right - x, height: bottom - y }
}
