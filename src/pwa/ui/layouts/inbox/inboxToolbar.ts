/** Bills inbox editor (Phase 194): the cell order and the docked toolbar's Previous / Next, pure. A cell key is `<rowId>:<field>`. The order is the
 *  existing Next / Done order of the other layouts: name, qty, rate (then GST % when the bill has it), then the next row; Next on the last cell adds a row. */
export type PaperField = 'name' | 'qty' | 'rate' | 'gstRate'

export function cellOrder(rowIds: readonly string[], hasGst: boolean): string[] {
  const fields: PaperField[] = hasGst ? ['name', 'qty', 'rate', 'gstRate'] : ['name', 'qty', 'rate']
  return rowIds.flatMap((id) => fields.map((f) => `${id}:${f}`))
}

/** The cell after / before `cur`. `null` after the last cell means "add a row"; before the first cell it stays (null). */
export function nextCell(order: readonly string[], cur: string | null): string | null {
  if (cur === null) return order[0] ?? null
  const i = order.indexOf(cur)
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : null
}
export function prevCell(order: readonly string[], cur: string | null): string | null {
  if (cur === null) return null
  const i = order.indexOf(cur)
  return i > 0 ? order[i - 1]! : null
}
