import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Enforces the import rules at the bottom of PROJECT_STRUCTURE.md.
const SRC = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs: string[] = []
  const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) specs.push((m[1] ?? m[2] ?? m[3] ?? m[4])!)
  return specs
}

/** Which top-level src area does an import resolve into (relative or alias)? */
function area(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@shared/')) return 'shared'
  if (spec.startsWith('@renderer/')) return 'renderer'
  if (spec.startsWith('.')) {
    const rel = relative(SRC, resolve(fromFile, '..', spec)).split(sep)
    if (rel[0] === '..') return null
    return rel[0] ?? null
  }
  return null
}

const NODE_BUILTIN = /^(node:|fs$|path$|os$|child_process$|crypto$|url$|net$|http$|https$|zlib$|stream$|util$|worker_threads$)/

interface Rule {
  name: string
  dir: string
  forbidden: (spec: string, file: string) => boolean
}

const rules: Rule[] = [
  {
    name: 'renderer must not import electron, node builtins, db/supabase, or src/main',
    dir: 'renderer',
    forbidden: (s, f) =>
      s === 'electron' || NODE_BUILTIN.test(s) || s === 'better-sqlite3' || s.startsWith('@supabase/') ||
      area(s, f) === 'main'
  },
  {
    name: 'shared must be pure: no electron, node builtins, src/main, src/renderer, db/supabase',
    dir: 'shared',
    forbidden: (s, f) =>
      s === 'electron' || NODE_BUILTIN.test(s) || s === 'better-sqlite3' || s.startsWith('@supabase/') ||
      area(s, f) === 'main' || area(s, f) === 'renderer'
  },
  {
    name: 'preload may use electron + shared only (no src/main, no src/renderer, no node builtins)',
    dir: 'preload',
    forbidden: (s, f) => NODE_BUILTIN.test(s) || area(s, f) === 'main' || area(s, f) === 'renderer'
  }
]

describe('import boundaries', () => {
  for (const rule of rules) {
    it(rule.name, () => {
      const offenders: string[] = []
      for (const file of walk(join(SRC, rule.dir))) {
        if (file.includes(`${sep}__tests__${sep}`)) continue // tests may use node:fs
        for (const spec of importsOf(file)) {
          if (rule.forbidden(spec, file)) offenders.push(`${relative(SRC, file)} -> ${spec}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('@supabase/supabase-js only under src/main/sync (and the ONE phone transport file), better-sqlite3 only under src/main/db', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (file.includes(`${sep}__tests__${sep}`)) continue
      const rel = relative(SRC, file).split(sep).join('/')
      for (const spec of importsOf(file)) {
        if (spec.startsWith('@supabase/') && !rel.startsWith('main/sync/') && rel !== 'pwa/sync/supabaseTransport.ts') offenders.push(`${rel} -> ${spec}`)
        if (spec === 'better-sqlite3' && !rel.startsWith('main/db/'))
          offenders.push(`${rel} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the checker itself detects a violation (sanity)', () => {
    expect(importsOf(__filename)).toContain('vitest')
    expect(NODE_BUILTIN.test('node:fs')).toBe(true)
    expect(area('../main/x', join(SRC, 'renderer', 'a.ts'))).toBe('main')
  })
})
