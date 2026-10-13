import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 36 lint-style guard: the owner's thresholds (40 / 30 / 80 / 70) live ONLY in `shared/paper/paperConstants.ts`.
 * Scans every non-test source file that deals with paper/print decisions (path contains paper/print, or the code uses
 * decidePaper / PaperDecision / the threshold names; comments removed) for those numbers as standalone numeric literals. Files that have
 * nothing to do with paper (pixel sizes, string-length caps, calendar days, the perf harness) are out of scope by design.
 */
const SRC = join(__dirname, '..', '..', '..')
const OWNER = ['shared', 'paper', 'paperConstants.ts'].join(sep)
const PAPERISH_CODE = /\b(decidePaper|PaperDecision|A5_MAX_ROWS|A4_MAX_ROWS|paperRules|paperConstants)\b/

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== '__fixtures__' && name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const NUM = /(?<![\w.$#-])(?:40|30|80|70)(?![\w.%])/g

describe('Phase 36 - threshold numbers appear only in paperConstants.ts', () => {
  it('no other source file contains 40 / 30 / 80 / 70 as a literal', () => {
    const hits: string[] = []
    let scanned = 0
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file)
      if (rel === OWNER) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      if (!/paper|print/i.test(rel) && !PAPERISH_CODE.test(code)) continue
      scanned++
      code.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(NUM)) {
          hits.push(`${rel}:${i + 1} (${m[0]}) -> ${line.trim().slice(0, 90)}`)
        }
      })
    }
    expect(scanned).toBeGreaterThan(5) // the guard must actually be looking at the print/paper code
    expect(hits).toEqual([])
  })
  it('the guard really sees a literal (self-check on the matcher)', () => {
    expect('const x = 40'.match(NUM)).not.toBeNull()
    expect('rows >= 80)'.match(NUM)).not.toBeNull()
    expect('width: 4.0, id40, 140, 0.30, 300'.match(NUM)).toBeNull()
  })
})
