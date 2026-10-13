import { describe, expect, it } from 'vitest'
import { fillRatio, isTight, nonWhiteBounds, trimRect } from '../imageTrim'

function img(w: number, h: number, box?: { x: number; y: number; w: number; h: number }): Uint8Array {
  const b = new Uint8Array(w * h * 4).fill(255)
  if (box) for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const i = (y * w + x) * 4; b[i] = 0; b[i + 1] = 0; b[i + 2] = 0 }
  return b
}

describe('imageTrim (Phase 127 hotfix)', () => {
  it('finds the content box in a big white image (the owner\'s Professional case)', () => {
    const b = nonWhiteBounds(img(200, 150, { x: 70, y: 2, w: 60, h: 46 }), 200, 150)
    expect(b).toEqual({ x: 70, y: 2, width: 60, height: 46 })
    expect(isTight(b, 200, 150)).toBe(false)
  })
  it('a tight capture (content + padding fills the image) is tight', () => {
    const b = nonWhiteBounds(img(100, 80, { x: 3, y: 3, w: 94, h: 74 }), 100, 80)
    expect(isTight(b, 100, 80)).toBe(true)
    expect(fillRatio(b!, 100, 80).w).toBeCloseTo(0.94)
  })
  it('all white, empty and malformed buffers have no bounds and are not tight', () => {
    expect(nonWhiteBounds(img(10, 10), 10, 10)).toBeNull()
    expect(nonWhiteBounds(new Uint8Array(4), 10, 10)).toBeNull()
    expect(nonWhiteBounds(img(10, 10), 0, 10)).toBeNull()
    expect(isTight(null, 10, 10)).toBe(false)
  })
  it('transparent pixels count as white', () => {
    const b = img(4, 4, { x: 1, y: 1, w: 2, h: 2 }); b[(1 * 4 + 1) * 4 + 3] = 0
    expect(nonWhiteBounds(b, 4, 4)).toEqual({ x: 1, y: 1, width: 2, height: 2 }) // other three black pixels still count
  })
  it('trimRect keeps the padding and clamps to the image', () => {
    expect(trimRect({ x: 70, y: 2, width: 60, height: 46 }, 200, 150, 5)).toEqual({ x: 65, y: 0, width: 70, height: 53 })
    expect(trimRect({ x: 0, y: 0, width: 200, height: 150 }, 200, 150, 9)).toEqual({ x: 0, y: 0, width: 200, height: 150 })
  })
})
