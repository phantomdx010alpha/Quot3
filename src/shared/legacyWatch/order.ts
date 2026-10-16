/** Phase 158 - stable oldest-first ordering (MILESTONE15_DESIGN 3.4). Result never depends on the input order. */
export interface FileStamp { name: string; mtimeMs: number }

/** Oldest mtime first; equal mtimes by file name (plain code-unit comparison, not locale dependent). Returns a new array. */
export function orderOldestFirst<T>(items: readonly T[], stamp: (item: T) => FileStamp): T[] {
  return items
    .map((item) => ({ item, s: stamp(item) }))
    .sort((a, b) => (a.s.mtimeMs !== b.s.mtimeMs ? a.s.mtimeMs - b.s.mtimeMs : a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0))
    .map((x) => x.item)
}
