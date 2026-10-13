import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../logger'
import { BUILTIN_THEMES } from '../../../shared/theme/tokens'
import { createThemeService } from '../themeService'

const BUILTIN_COUNT = BUILTIN_THEMES.length

function setup(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'q3theme-'))
  const dir = join(root, 'themes')
  mkdirSync(dir)
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  const svc = createThemeService({ dir, log: createLogger({ dir: root }) })
  return { svc, dir, root }
}
const t = (o: object): string => JSON.stringify(o)

describe('themeService', () => {
  it('lists built-ins first, even with no themes folder', () => {
    const svc = createThemeService({ dir: join(tmpdir(), 'q3-does-not-exist'), log: createLogger({ dir: tmpdir() }) })
    expect(svc.list().themes.map((x) => x.id)).toEqual(['navy-ember', 'paper', 'glossy-glass', 'space', 'red-navy', 'red-black'])
    expect(svc.list().themes.every((x) => x.builtin)).toBe(true)
  })

  it('loads valid custom themes and skips + reports bad ones', () => {
    const { svc } = setup({
      'a-good.json': t({ id: 'amber', name: 'Amber', base: 'navy-ember', tokens: { '--accent': '#FFB347' } }),
      'b-bad-json.json': '{ nope',
      'c-hostile.json': t({ id: 'evil', name: 'Evil', tokens: { '--surface-base': 'url(http://x/y.png)' } }),
      'd-reserved.json': t({ id: 'paper', name: 'Fake Paper' }),
      'e-dup.json': t({ id: 'amber', name: 'Amber 2' }),
      'notes.txt': 'ignored'
    })
    const l = svc.list()
    expect(l.themes.map((x) => x.id)).toEqual(['navy-ember', 'paper', 'glossy-glass', 'space', 'red-navy', 'red-black', 'amber'])
    expect(l.errors.map((e) => e.file)).toEqual(['b-bad-json.json', 'c-hostile.json', 'd-reserved.json', 'e-dup.json'])
    expect(JSON.stringify(l.themes)).not.toContain('url(')
  })

  it('rejects oversized files and non-regular files', () => {
    const { svc, dir } = setup({ 'big.json': t({ id: 'big', name: 'Big', pad: 'x'.repeat(70 * 1024) }) })
    symlinkSync(join(dir, 'big.json'), join(dir, 'link.json'))
    const l = svc.list()
    expect(l.themes).toHaveLength(BUILTIN_COUNT)
    expect(l.errors.map((e) => e.file).sort()).toEqual(['big.json', 'link.json'])
  })

  it('reload picks up files added after the first list', () => {
    const { svc, dir } = setup({})
    expect(svc.list().themes).toHaveLength(BUILTIN_COUNT)
    writeFileSync(join(dir, 'new.json'), t({ id: 'fresh', name: 'Fresh' }))
    expect(svc.list().themes).toHaveLength(BUILTIN_COUNT) // cached
    expect(svc.reload().themes.map((x) => x.id)).toContain('fresh')
  })

  it('load / setActive: NOT_FOUND for unknown ids; falls back when active theme disappears', () => {
    const { svc, dir } = setup({ 'x.json': t({ id: 'tmp', name: 'Tmp' }) })
    expect(svc.load('paper').builtin).toBe(true)
    expect(() => svc.load('zzz')).toThrow(/not found/i)
    expect(() => svc.setActive('zzz')).toThrow()
    expect(svc.getActive()).toBe('navy-ember')
    svc.setActive('tmp')
    expect(svc.getActive()).toBe('tmp')
    writeFileSync(join(dir, 'x.json'), '{}') // now invalid
    svc.reload()
    expect(svc.getActive()).toBe('navy-ember')
  })
})

describe('themeService Phase 49: openFolder + exportStarter', () => {
  const mk = (openPath?: (d: string) => Promise<string>) => {
    const root = mkdtempSync(join(tmpdir(), 'q3theme49-'))
    const dir = join(root, 'themes')
    return { dir, svc: createThemeService({ dir, log: createLogger({ dir: root }), openPath }) }
  }
  it('openFolder creates the folder first and reports a failed open', async () => {
    let opened = ''
    const a = mk(async (d) => { opened = d; return '' })
    await a.svc.openFolder()
    expect(opened).toBe(a.dir)
    await expect(mk(async () => 'boom').svc.openFolder()).rejects.toThrow(/could not open/i)
  })
  it('exportStarter writes a valid, loadable file, never overwrites, and the next list sees it', () => {
    const { svc, dir } = mk()
    const r = svc.exportStarter({ id: 'navy-ember', computed: { '--accent': '#FF7B7B', '--row-height': '26px' } })
    expect(r.file).toBe('navy-ember-copy.json')
    expect(JSON.parse(readFileSync(join(dir, r.file), 'utf8'))).toMatchObject({ base: 'navy-ember', tokens: { '--accent': '#FF7B7B' } })
    expect(svc.list().themes.map((x) => x.id)).toContain('navy-ember-copy')
    expect(svc.exportStarter({ id: 'navy-ember', computed: { '--accent': '#000' } }).id).toBe('navy-ember-copy-2')
  })
  it('exportStarter refuses unknown themes and unreadable values', () => {
    const { svc } = mk()
    expect(() => svc.exportStarter({ id: 'zzz', computed: { '--accent': '#fff' } })).toThrow(/not found/i)
    expect(() => svc.exportStarter({ id: 'paper', computed: { '--nope': '1' } })).toThrow(/could not read/i)
  })
})

describe('themeService Phase 98: setTitleBar', () => {
  it('validates the colours and hands a clean overlay to the window port', () => {
    const root = mkdtempSync(join(tmpdir(), 'q3theme-'))
    const seen: unknown[] = []
    const svc = createThemeService({ dir: join(root, 'themes'), log: createLogger({ dir: root }), applyTitleBar: (o) => seen.push(o) })
    svc.setTitleBar({ bg: 'rgb(11, 20, 36)', symbol: '#E6ECF7', height: '90px' })
    expect(seen).toEqual([{ color: '#0b1424', symbolColor: '#e6ecf7', height: 40 }])
  })
  it('rejects unusable colours with VALIDATION and does not touch the window', () => {
    const root = mkdtempSync(join(tmpdir(), 'q3theme-'))
    const seen: unknown[] = []
    const svc = createThemeService({ dir: join(root, 'themes'), log: createLogger({ dir: root }), applyTitleBar: (o) => seen.push(o) })
    expect(() => svc.setTitleBar({ bg: 'url(x)', symbol: '#fff', height: '32px' })).toThrow(/Title bar colours/)
    expect(seen).toEqual([])
  })
})
