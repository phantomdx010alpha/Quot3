import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs tool without types
import { classifyGameFolder, classifyGamesRoot, classifyText, countCjk, stripCodeComments } from '../games-lang.mjs'

type Res = { visible: number; code: number; total: number; lang: 'en' | 'zh' }
const classify = classifyGameFolder as (dir: string) => Res
const classifyRoot = classifyGamesRoot as (root: string) => Record<string, Res>
const text = classifyText as (ext: string, t: string) => { visible: number; code: number }
const strip = stripCodeComments as (s: string, o?: { slashSlash?: boolean }) => string
const cjk = countCjk as (s: string) => number

let root: string
const make = (name: string, files: Record<string, string>): string => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  for (const [f, c] of Object.entries(files)) { const p = join(d, f); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c) }
  return d
}
beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'q3-lang-')) })
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('tools/games-lang.mjs (Phase 205, M20)', () => {
  it('counts ideographs, kana and hangul, not Latin text or full-width punctuation', () => {
    expect(cjk('Score: 10 \u5f00\u59cb')).toBe(2)
    expect(cjk('\u3053\u3093 \ud55c')).toBe(3)
    expect(cjk('hello, world! \uff01')).toBe(0)
  })
  it('ignores comments in JS, CSS and HTML but keeps string contents', () => {
    expect(cjk(strip('// \u4e2d\u6587\nlet a = 1 /* \u4e2d\u6587 */'))).toBe(0)
    expect(cjk(strip('let s = "http://x \u4e2d"'))).toBe(1)
    expect(cjk(strip("let t = `\u4e2d // \u6587`"))).toBe(2)
    expect(text('.html', '<!-- \u4e2d\u6587 --><p>Hi</p>')).toEqual({ visible: 0, code: 0 })
    expect(text('.css', '/* \u4e2d */ a { color: red }')).toEqual({ visible: 0, code: 0 })
  })
  it('puts HTML text and attributes under visible, script strings under code, CSS content under visible', () => {
    expect(text('.html', '<button title="\u5f00">\u5f00\u59cb</button>')).toEqual({ visible: 3, code: 0 })
    expect(text('.html', '<script>const m = "\u5f00\u59cb"</script>')).toEqual({ visible: 0, code: 2 })
    expect(text('.html', '<style>a::after { content: "\u5f00"; } .x { font-family: "\u5b8b\u4f53" }</style>')).toEqual({ visible: 1, code: 2 })
    expect(text('.css', 'a::after { content: "\u5f00" }')).toEqual({ visible: 1, code: 0 })
    expect(text('.js', 'const a = "\u5f00" // \u4e2d')).toEqual({ visible: 0, code: 1 })
  })
  it('classifies a clean game en, a Chinese interface zh, and a few code-only characters (<= 10) en', () => {
    expect(classify(make('clean', { 'index.html': '<p>Play</p><script src="g.js"></script>', 'g.js': 'let score = 0 // \u5206\u6570' })).lang).toBe('en')
    expect(classify(make('chinese-ui', { 'index.html': '<button>\u5f00\u59cb\u6e38\u620f</button>' })).lang).toBe('zh')
    const few = classify(make('few-code', { 'index.html': '<script src="g.js"></script>', 'g.js': 'const k = "\u5f00\u59cb"' }))
    expect(few).toMatchObject({ visible: 0, code: 2, total: 2, lang: 'en' })
    expect(classify(make('many-code', { 'index.html': '<p>Hi</p><script src="g.js"></script>', 'g.js': 'const k = "' + '\u4e2d'.repeat(11) + '"' })).lang).toBe('zh')
    expect(classify(make('one-visible', { 'index.html': '<p>\u4e2d</p>' })).lang).toBe('zh')
  })
  it('skips LICENSE and binary files and folders starting with an underscore', () => {
    make('lic', { 'index.html': '<p>Hi</p>', LICENSE: '\u4e2d\u6587\u4e2d\u6587', 'pic.png': '\u4e2d\u6587' })
    make('_hidden', { 'index.html': '<p>\u4e2d</p>' })
    const all = classifyRoot(root)
    expect(all.lic!.lang).toBe('en')
    expect(all._hidden).toBeUndefined()
  })
})
