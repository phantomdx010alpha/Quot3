/** Phase 191 - the stack of open bottom sheets. A layout's `interceptBack` (M18-3) calls `closeTopSheet()` first, so Back and the system Back close a
 *  sheet BEFORE the screen or the unsaved-bill guard. Pure module state, no DOM. */
interface Entry { id: number; close: () => void }
const stack: Entry[] = []
let nextId = 1

/** Registers an open sheet; returns the function that removes it again (call it when the sheet closes or unmounts). */
export function registerSheet(close: () => void): () => void {
  const entry: Entry = { id: nextId++, close }
  stack.push(entry)
  return () => {
    const i = stack.findIndex((e) => e.id === entry.id)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** Closes only the newest open sheet. True when a sheet was open (the Back press is used up), false when none was. */
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}

export function openSheetCount(): number {
  return stack.length
}
