import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyGame, checkGame, extractGame, scanText, unifiedDiff, validateWorksheet, writeWorksheet } from '../games-i18n.mjs'
import type { Worksheet } from '../games-i18n.mjs'

// Chinese test strings are written as \u escapes so this file stays ASCII.
const KAI = '\u5f00\u59cb' // "start"
const ZHONG = '\u4e2d\u6587' // "Chinese"
const SCORE = '\u5f97\u5206' // "score"
const NAME = '\u82f9\u679c' // "apple"
const ONE = '\u4e00'
const PERIOD = '\u3002' // full-width full stop

let root: string
let n = 0
const make = (files: Record<string, string>): { dir: string; id: string; opts: { worksheetPath: string; patchDir: string } } => {
  const id = `g${++n}`
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'LICENSE'), 'MIT License (test fixture)\n') // the audit requires a LICENSE file
  for (const [f, c] of Object.entries(files)) { const p = join(dir, f); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c) }
  return { dir, id, opts: { worksheetPath: join(root, 'ws', `${id}.json`), patchDir: join(root, 'patches') } }
}
const read = (p: string): string => readFileSync(p, 'utf8')
/** extract, then fill every empty `en` from a map of zh -> en (default: "T<index>") */
const extractAndFill = (g: ReturnType<typeof make>, map: Record<string, string> = {}): Worksheet => {
  const r = extractGame(g.dir, g.opts)
  expect(r.ok).toBe(true)
  const ws = JSON.parse(read(g.opts.worksheetPath)) as Worksheet
  ws.entries.forEach((e, i) => { if (!e.en) e.en = map[e.zh] ?? `T${i}` })
  writeWorksheet(g.opts.worksheetPath, ws)
  return ws
}
/** tiny unified-diff applier: proves the written diff really turns the old text into the new text */
const applyUnified = (oldText: string, diff: string): string => {
  const old = oldText.split('\n')
  const out: string[] = []
  let pos = 0
  const lines = diff.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(lines[i]!)
    if (!m) continue
    const start = Number(m[1]) - 1
    while (pos < start) out.push(old[pos++]!)
    for (i++; i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('--- '); i++) {
      const l = lines[i]!
      if (l.startsWith('\\')) continue
      if (l.startsWith(' ')) { expect(old[pos]).toBe(l.slice(1)); out.push(old[pos++]!) }
      else if (l.startsWith('-')) { expect(old[pos]).toBe(l.slice(1)); pos++ }
      else if (l.startsWith('+')) out.push(l.slice(1))
    }
    i--
  }
  while (pos < old.length) out.push(old[pos++]!)
  return out.join('\n')
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'q3-i18n-test-')) })
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('tools/games-i18n.mjs scanner (Phase 206, M20)', () => {
  it('finds an HTML text node, an attribute, strings of each quote type, a template static part and CSS content, and leaves comments alone', () => {
    const html = `<!-- ${ZHONG} --><p title="${KAI}">${KAI}</p><style>/* ${ZHONG} */ a::after { content: "${SCORE}"; }</style>` +
      `<script>// ${ZHONG}\nconst a = '${KAI}', b = "${SCORE}", c = \`${NAME} \${x} ${ONE}\`; /* ${ZHONG} */</script>`
    const { segs, commentCjk } = scanText('.html', html)
    const found = segs.filter((s) => /[\u4e00-\u9fff]/.test(s.dec)).map((s) => `${s.kind}:${s.dec}`)
    expect(found).toEqual([`attr:${KAI}`, `text:${KAI}`, `css:${SCORE}`, `js:${KAI}`, `js:${SCORE}`, `js:${NAME} `, `js: ${ONE}`])
    expect(commentCjk).toBe(8)
  })
  it('does not mistake a regex literal or a URL in a string for a comment', () => {
    const js = `const re = /["']/g; const u = "http://x.test/${ZHONG}"; const t = 1 / 2 // ${ZHONG}\n`
    const { segs, commentCjk } = scanText('.js', js)
    expect(segs.filter((s) => /[\u4e00-\u9fff]/.test(s.dec)).map((s) => s.dec)).toEqual([`http://x.test/${ZHONG}`])
    expect(commentCjk).toBe(2)
  })
  it('lists a JSON value as json and a JSON key as other', () => {
    const { segs } = scanText('.json', `{"${NAME}": "${KAI}"}`)
    expect(segs.map((s) => `${s.kind}:${s.dec}`)).toEqual([`other:${NAME}`, `json:${KAI}`])
  })
})

describe('extract', () => {
  it('writes a worksheet with zh filled and en empty; the same string in one file is one entry; comments are not listed', () => {
    const g = make({ 'index.html': `<p>${KAI}</p><p>${KAI}</p><!-- ${ZHONG} --><script>let s = "${SCORE}"; let t = "${SCORE}"; // ${ZHONG}\n</script>` })
    const r = extractGame(g.dir, g.opts)
    expect(r).toMatchObject({ ok: true, added: 2, total: 2, empty: 2 })
    const ws = JSON.parse(read(g.opts.worksheetPath)) as Worksheet
    expect(ws.game).toBe(g.id)
    expect(ws.entries.map((e) => [e.kind, e.zh, e.en])).toEqual([['text', KAI, ''], ['js', SCORE, '']])
  })
  it('never loses an entry: a second extract keeps the English, and a worksheet of an applied game stays whole', () => {
    const g = make({ 'index.html': `<button>${KAI}</button>` })
    extractAndFill(g, { [KAI]: 'Start' })
    expect(extractGame(g.dir, g.opts)).toMatchObject({ ok: true, added: 0, total: 1, empty: 0 })
    expect(applyGame(g.dir, g.opts).status).toBe('applied')
    expect(extractGame(g.dir, g.opts)).toMatchObject({ ok: true, added: 0, total: 1 })
    expect((JSON.parse(read(g.opts.worksheetPath)) as Worksheet).entries[0]!.en).toBe('Start')
  })
  it('marks a string that is measured, split or compared as risky', () => {
    const g = make({ 'index.html': `<script>const n = "${KAI}".length; if (mode === "${SCORE}") {} </script>` })
    extractGame(g.dir, g.opts)
    const ws = JSON.parse(read(g.opts.worksheetPath)) as Worksheet
    expect(ws.entries.map((e) => !!e.risky)).toEqual([true, true])
  })
  it('refuses a worksheet that belongs to another game', () => {
    const g = make({ 'index.html': `<p>${KAI}</p>` })
    mkdirSync(join(root, 'ws'), { recursive: true })
    writeFileSync(g.opts.worksheetPath, JSON.stringify({ version: 1, game: 'other', entries: [] }))
    expect(extractGame(g.dir, g.opts).ok).toBe(false)
  })
})

describe('apply', () => {
  const page = (body: string, head = ''): string => `<!doctype html><html lang="zh-CN"><head><title>${KAI}</title>${head}</head><body>${body}</body></html>`

  it('replaces text, attribute, CSS content and every quote type, escapes quotes, keeps ${} in templates, sets <html lang>, leaves comments', () => {
    const html = page(
      `<!-- ${ZHONG} --><button title="${SCORE}">${KAI}</button><script>\n// ${ZHONG}\nconst a = '${KAI}'\nconst b = "${SCORE}"\nconst c = \`${NAME} \${x}${PERIOD}\`\n</script>`,
      `<style>a::after { content: "${ONE}"; }</style>`
    )
    const g = make({ 'index.html': html })
    extractAndFill(g, { [KAI]: "Don't stop", [SCORE]: 'Say "hi" \\ now', [NAME + ' ']: 'Apple `x` ', [ONE]: 'One', [PERIOD]: '.' })
    const r = applyGame(g.dir, g.opts)
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    const out = read(join(g.dir, 'index.html'))
    expect(out).toContain('<html lang="en">')
    expect(out).toContain(`<!-- ${ZHONG} -->`)
    expect(out).toContain(`// ${ZHONG}`)
    expect(out).toContain(`const a = 'Don\\'t stop'`)
    expect(out).toContain(`const b = "Say \\"hi\\" \\\\ now"`)
    expect(out).toContain('const c = `Apple \\`x\\` ${x}.`')
    expect(out).toContain('content: "One"')
    expect(out).toContain('<button title="Say &quot;hi&quot; \\ now">Don\'t stop</button>')
    const { segs } = scanText('.html', out)
    const script = /<script>([\s\S]*?)<\/script>/.exec(out)![1]!
    expect(() => new vm.Script(script)).not.toThrow()
    expect(segs.filter((s) => /[\u4e00-\u9fff]/.test(s.dec))).toEqual([])
  })

  it('replaces the same string in two places together, and writes a diff that reproduces the new file', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `<p>line ${i}</p>`)
    lines[3] = `<p>${KAI}</p>`
    lines[25] = `<p>${KAI}</p><p>${SCORE}</p>`
    const text = lines.join('\n') + '\n'
    const g = make({ 'index.html': text })
    extractAndFill(g, { [KAI]: 'Start', [SCORE]: 'Score' })
    expect(applyGame(g.dir, g.opts)).toMatchObject({ ok: true, status: 'applied', replaced: 3 })
    const out = read(join(g.dir, 'index.html'))
    expect(out.match(/Start/g)).toHaveLength(2)
    const diff = read(join(g.opts.patchDir, `${g.id}-en.diff`))
    expect(diff).toContain(`--- a/resources/games/${g.id}/index.html`)
    expect(diff.match(/^@@ /gm)).toHaveLength(2)
    expect(applyUnified(text, diff)).toBe(out)
  })

  it('diff keeps working when the changed line is the last line and the file has no final newline', () => {
    const text = `<p>a</p>\n<p>b</p>\n<p>${KAI}</p>`
    const out = `<p>a</p>\n<p>b</p>\n<p>Start</p>`
    const idx = text.indexOf(KAI)
    const diff = unifiedDiff('x.html', text, [{ start: idx, end: idx + KAI.length, text: 'Start' }])
    expect(diff).toContain('\\ No newline at end of file')
    expect(applyUnified(text, diff)).toBe(out)
  })

  it('translates one occurrence differently with an onlyLine entry', () => {
    const g = make({ 'index.html': `<script>\nlet a = "${KAI}"\nlet b = "${KAI}"\n</script>` })
    const ws = extractAndFill(g, { [KAI]: 'Make ' })
    ws.entries.push({ file: 'index.html', kind: 'js', line: 3, zh: KAI, en: 'Served ', onlyLine: true })
    writeWorksheet(g.opts.worksheetPath, ws)
    expect(applyGame(g.dir, g.opts).ok).toBe(true)
    const out = read(join(g.dir, 'index.html'))
    expect(out).toContain('let a = "Make "')
    expect(out).toContain('let b = "Served "')
  })

  it('replaces a JSON value', () => {
    const g = make({ 'data.json': `{"name": "${NAME}"}`, 'index.html': '<p>Hi</p>' })
    extractAndFill(g, { [NAME]: 'Apple' })
    expect(applyGame(g.dir, g.opts).ok).toBe(true)
    expect(JSON.parse(read(join(g.dir, 'data.json')))).toEqual({ name: 'Apple' })
  })

  it('is idempotent: a second run says "already applied" and changes nothing', () => {
    const g = make({ 'index.html': page(`<p>${KAI}</p>`) })
    extractAndFill(g, { [KAI]: 'Start' })
    expect(applyGame(g.dir, g.opts).status).toBe('applied')
    const file = read(join(g.dir, 'index.html'))
    const diff = read(join(g.opts.patchDir, `${g.id}-en.diff`))
    expect(applyGame(g.dir, g.opts)).toMatchObject({ ok: true, status: 'already applied' })
    expect(read(join(g.dir, 'index.html'))).toBe(file)
    expect(read(join(g.opts.patchDir, `${g.id}-en.diff`))).toBe(diff)
  })

  it('refuses (and writes nothing) when an en is empty, still has Chinese, loses a placeholder, or a zh is not found', () => {
    const html = `<p>${KAI}</p><script>let a = "${SCORE} {n}"</script>`
    const g = make({ 'index.html': html })
    const ws = extractAndFill(g, { [KAI]: 'Start', [SCORE + ' {n}']: 'Score {n}' })
    const tryWith = (mut: (w: Worksheet) => void): string[] => {
      const copy = JSON.parse(JSON.stringify(ws)) as Worksheet
      mut(copy)
      writeWorksheet(g.opts.worksheetPath, copy)
      const r = applyGame(g.dir, g.opts)
      expect(r.ok).toBe(false)
      expect(read(join(g.dir, 'index.html'))).toBe(html)
      expect(existsSync(join(g.opts.patchDir, `${g.id}-en.diff`))).toBe(false)
      return r.errors!
    }
    expect(tryWith((w) => { w.entries[0]!.en = '' }).join()).toMatch(/en is empty/)
    expect(tryWith((w) => { w.entries[0]!.en = `Start ${ZHONG}` }).join()).toMatch(/Chinese/)
    expect(tryWith((w) => { w.entries[0]!.en = `Start${PERIOD}` }).join()).toMatch(/full-width/)
    expect(tryWith((w) => { w.entries[1]!.en = 'Score' }).join()).toMatch(/placeholders differ/)
    expect(tryWith((w) => { w.entries[0]!.zh = `${KAI}${KAI}` }).join()).toMatch(/not found/)
    expect(tryWith((w) => { w.entries[0]!.kind = 'attr' }).join()).toMatch(/not found/)
    expect(tryWith((w) => { w.entries[0]!.file = '../x.html' }).join()).toMatch(/inside the game folder/)
  })

  it('refuses when the audit fails on the patched game (a fixture with fetch) and writes nothing', () => {
    const html = `<p>${KAI}</p><script>fetch("x")</script>`
    const g = make({ 'index.html': html })
    extractAndFill(g, { [KAI]: 'Start' })
    const r = applyGame(g.dir, g.opts)
    expect(r.ok).toBe(false)
    expect(r.errors!.join()).toMatch(/audit fetch/)
    expect(read(join(g.dir, 'index.html'))).toBe(html)
  })

  it('validateWorksheet accepts a clean worksheet', () => {
    const ws: Worksheet = { version: 1, game: 'x', entries: [{ file: 'a.html', kind: 'text', line: 1, zh: KAI, en: 'Start' }] }
    expect(validateWorksheet(ws, 'x')).toEqual([])
  })
})

describe('check', () => {
  it('reports leftovers with file and line, and passes a clean game', () => {
    const bad = make({ 'index.html': `<p>Hi</p>\n<script>\nlet a = "${KAI}"\n</script>\n<!-- ${ZHONG} -->` })
    const r = checkGame(bad.dir, bad.opts)
    expect(r.ok).toBe(false)
    expect(r.leftovers).toEqual([{ file: 'index.html', line: 3, kind: 'js', text: KAI }])
    expect(r.commentCjk).toBe(2)
    const good = make({ 'index.html': '<p>Hi</p>' })
    expect(checkGame(good.dir, good.opts)).toMatchObject({ ok: true, leftovers: [] })
  })
  it('reports a Chinese <html lang> and full-width punctuation left behind', () => {
    const g = make({ 'index.html': `<html lang="zh-CN"><p>Hi${PERIOD}</p></html>` })
    const r = checkGame(g.dir, g.opts)
    expect(r.ok).toBe(false)
    expect(r.leftovers.map((l) => l.kind)).toEqual(['lang'])
    expect(r.warnings.join()).toMatch(/full-width punctuation/)
  })
  it('warns about one English text standing for two different Chinese strings', () => {
    const g = make({ 'index.html': `<p>${KAI}</p><p>${SCORE}</p>` })
    extractAndFill(g, { [KAI]: 'Go', [SCORE]: 'Go' })
    applyGame(g.dir, g.opts)
    expect(checkGame(g.dir, g.opts).warnings.join()).toMatch(/two different Chinese strings/)
  })
  it('fails when the audit fails (a fixture with fetch)', () => {
    const g = make({ 'index.html': '<script>fetch("x")</script>' })
    const r = checkGame(g.dir, g.opts)
    expect(r.ok).toBe(false)
    expect(r.audit.failures.map((f) => f.rule)).toContain('fetch')
  })
})
