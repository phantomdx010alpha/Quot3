/**
 * Phase 218 (M21-2 / M21-3): the one pure "step through an ordered list of IDs" rule behind bill stepping and party paging.
 * No DOM, no Electron, no Node. IDs only, never row numbers. No wrap-around.
 */

export type StepDir = 'prev' | 'next'

export interface StepResult {
  /** The ID to show, or null when there is nothing to show (empty list / every ID missing). */
  id: string | null
  /** True when the key must do nothing because the first / last item was already reached (the UI shows a quiet end marker). */
  atEnd: boolean
}

export interface StepOptions {
  /** IDs that no longer exist (deleted, trashed, synced away). They are skipped. */
  missing?: ReadonlySet<string>
}

/**
 * Rules (design section 5 / 5.1):
 *  - IDs in `missing` are skipped; duplicates keep their first position.
 *  - Current is live: next / prev move one live item; at the first / last live item the result is `{ id: current, atEnd: true }`.
 *  - Current is in the list but missing: step from its old position (next = first live after it, prev = last live before it);
 *    if there is none in that direction the nearest live item the other way is returned with `atEnd: true`.
 *  - Current is not in the list at all: next = first live item, prev = last live item (`atEnd: false`).
 *  - Empty list, or no live item: `{ id: null, atEnd: true }`. One live item that is the current: `atEnd: true`.
 */
export function stepInList(orderedIds: readonly string[], currentId: string | null, dir: StepDir, opts: StepOptions = {}): StepResult {
  const missing = opts.missing
  const seen = new Set<string>()
  const live: string[] = []
  let curPos = -1 // position of current within `live` (live current) or the insertion point (missing current)
  let curInList = false
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    if (id === currentId) {
      curInList = true
      curPos = live.length
    }
    if (missing?.has(id)) continue
    live.push(id)
  }
  if (live.length === 0) return { id: null, atEnd: true }
  if (!curInList) return { id: dir === 'next' ? live[0]! : live[live.length - 1]!, atEnd: false }
  const curLive = live[curPos] === currentId
  if (curLive) {
    const to = dir === 'next' ? curPos + 1 : curPos - 1
    if (to < 0 || to >= live.length) return { id: currentId, atEnd: true }
    return { id: live[to]!, atEnd: false }
  }
  // Current is in the list but gone: `curPos` is the index of the first live item that came after it.
  const to = dir === 'next' ? curPos : curPos - 1
  if (to >= 0 && to < live.length) return { id: live[to]!, atEnd: false }
  const nearest = dir === 'next' ? live[live.length - 1]! : live[0]!
  return { id: nearest, atEnd: true }
}
