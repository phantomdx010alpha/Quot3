/**
 * Phase 53: canonical JSON for the sync payload. Pure.
 * Same value in => same bytes out, on every machine: object keys sorted by UTF-16 code unit, no whitespace,
 * `undefined` object members dropped (as JSON.stringify does), `undefined` inside arrays becomes `null`.
 * Refuses what JSON cannot represent faithfully (NaN, Infinity, bigint, functions, symbols, class instances,
 * cycles) instead of silently turning it into `null`. Money is a decimal STRING in this project, so numbers are rare.
 */
export function canonicalJson(value: unknown): string {
  return write(value, [])
}

function write(v: unknown, stack: object[]): string {
  if (v === null) return 'null'
  switch (typeof v) {
    case 'string': return JSON.stringify(v)
    case 'boolean': return v ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number')
      return Object.is(v, -0) ? '0' : JSON.stringify(v)
    case 'object': break
    default: throw new TypeError(`canonicalJson: unsupported ${typeof v}`)
  }
  const o = v as object
  if (stack.includes(o)) throw new TypeError('canonicalJson: cycle')
  stack.push(o)
  let out: string
  if (Array.isArray(o)) {
    out = '[' + o.map((x) => (x === undefined ? 'null' : write(x, stack))).join(',') + ']'
  } else {
    const proto = Object.getPrototypeOf(o) as unknown
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: only plain objects')
    const rec = o as Record<string, unknown>
    const parts: string[] = []
    for (const k of Object.keys(rec).sort()) {
      const x = rec[k]
      if (x !== undefined) parts.push(JSON.stringify(k) + ':' + write(x, stack))
    }
    out = '{' + parts.join(',') + '}'
  }
  stack.pop()
  return out
}
