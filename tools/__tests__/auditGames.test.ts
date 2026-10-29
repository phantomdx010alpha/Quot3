import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs tool without types
import { auditGameFolder, auditGamesRoot } from '../audit-games.mjs'

type Finding = { rule: string; file: string; line: number; text: string }
type Result = { ok: boolean; failures: Finding[]; warnings: Finding[]; files: number }
const audit = auditGameFolder as (dir: string, opts?: { entry?: string }) => Result
const auditRoot = auditGamesRoot as (root: string) => Record<string, Result>

let root: string
const MIT = 'MIT License\n\nCopyright (c) 2026 Invented Person\n'
const CLEAN_HTML = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><canvas id="c"></canvas><script src="game.js"></script></body></html>\n'
const CLEAN_JS = 'const c = document.getElementById("c")\nlet score = Number(localStorage.getItem("score") || 0)\nfunction tick() { score++; localStorage.setItem("score", String(score)); requestAnimationFrame(tick) }\ntick()\n'

function make(name: string, files: Record<string, string | Buffer>, license = true): string {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  if (license) writeFileSync(join(d, 'LICENSE'), MIT)
  for (const [f, c] of Object.entries(files)) {
    const p = join(d, f)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, c)
  }
  return d
}
const rules = (r: Result): string[] => r.failures.map((f) => f.rule)

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'auditgames-')) })
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('audit-games', () => {
  it('a clean game passes', () => {
    const r = audit(make('clean', { 'index.html': CLEAN_HTML, 'style.css': 'body{margin:0;background:url(bg.png)}', 'game.js': CLEAN_JS, 'bg.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) }), { entry: 'index.html' })
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('a CDN script, stylesheet, font and css url each fail', () => {
    expect(rules(audit(make('cdn1', { 'index.html': '<script src="https://cdn.example.com/lib.js"></script>' })))).toContain('remote-src')
    expect(rules(audit(make('cdn2', { 'index.html': '<script src="//cdn.example.com/lib.js"></script>' })))).toContain('remote-src')
    expect(rules(audit(make('cdn3', { 'index.html': '<link rel="stylesheet" href="https://fonts.example.com/css">' })))).toContain('remote-link-tag')
    expect(rules(audit(make('cdn4', { 'a.css': '@import url("https://x.example.com/a.css");' })))).toContain('remote-css-import')
    expect(rules(audit(make('cdn5', { 'a.css': '@font-face{src:url(https://x.example.com/f.woff2)}' })))).toContain('remote-css-url')
    expect(rules(audit(make('cdn6', { 'a.js': 'import x from "https://x.example.com/m.js"' })))).toContain('remote-js-import')
  })
  it('fetch, XMLHttpRequest, WebSocket, sendBeacon each fail', () => {
    expect(rules(audit(make('f1', { 'a.js': 'fetch("/x").then(r => r.json())' })))).toContain('fetch')
    expect(rules(audit(make('f2', { 'a.js': 'const x = new XMLHttpRequest()' })))).toContain('xhr')
    expect(rules(audit(make('f3', { 'a.js': 'const s = new WebSocket("wss://x.example.com")' })))).toContain('websocket')
    expect(rules(audit(make('f4', { 'a.js': 'navigator.sendBeacon("/log", "x")' })))).toContain('sendBeacon')
  })
  it('eval and new Function fail, but a name that merely ends in "eval" does not', () => {
    expect(rules(audit(make('e1', { 'a.js': 'const v = eval("1+1")' })))).toContain('eval')
    expect(rules(audit(make('e2', { 'a.js': 'const f = new Function("a", "return a")' })))).toContain('new-function')
    expect(audit(make('e3', { 'a.js': 'function retrieval(x) { return x }\nconst o = { eval2: 1 }; o.evaluate(); retrieval(1)' })).ok).toBe(true)
  })
  it('trackers, cookie writes, window.open and navigating away fail', () => {
    expect(rules(audit(make('t1', { 'a.js': 'gtag("config", "G-1")' })))).toContain('tracker')
    expect(rules(audit(make('t2', { 'index.html': '<script async src="game.js" data-x="adsbygoogle"></script>' })))).toContain('tracker')
    expect(rules(audit(make('t3', { 'a.js': 'document.cookie = "a=1"' })))).toContain('cookie-write')
    expect(rules(audit(make('t4', { 'a.js': 'window.open("x.html")' })))).toContain('window-open')
    expect(rules(audit(make('t5', { 'a.js': 'location.href = "https://example.com"' })))).toContain('navigate-away')
  })
  it('reading document.cookie or using a relative location is fine', () => {
    expect(audit(make('ok1', { 'a.js': 'const c = document.cookie\nif (c === "") location.href = "index.html"\nconst x = a == b' })).ok).toBe(true)
  })
  it('an oversized file fails', () => {
    const d = make('big', { 'index.html': CLEAN_HTML })
    writeFileSync(join(d, 'huge.wav'), Buffer.alloc(26 * 1024 * 1024))
    const r = audit(d)
    expect(rules(r)).toContain('too-large')
  })
  it('executables and disallowed file types fail; images, audio, fonts and wasm are fine', () => {
    expect(rules(audit(make('x1', { 'run.exe': Buffer.from('MZ\x90\x00') })))).toEqual(expect.arrayContaining(['file-type', 'executable']))
    expect(rules(audit(make('x2', { 'data.bin': Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]) })))).toEqual(expect.arrayContaining(['executable']))
    expect(rules(audit(make('x3', { 'setup.bat': '@echo off' })))).toContain('file-type')
    expect(audit(make('x4', { 'a.wasm': Buffer.from([0, 0x61, 0x73, 0x6d]), 's.ogg': Buffer.from('OggS'), 'f.woff2': Buffer.from('wOF2') })).ok).toBe(true)
  })
  it('minified-only code fails; a .min.js with its readable twin passes', () => {
    const mini = 'var a=1;'.repeat(2000) + '\n'
    expect(rules(audit(make('m1', { 'lib.min.js': mini })))).toContain('minified-only')
    expect(rules(audit(make('m2', { 'game.js': mini })))).toContain('minified-only')
    expect(audit(make('m3', { 'lib.min.js': mini, 'lib.js': CLEAN_JS })).ok).toBe(true)
  })
  it('a missing LICENSE and a missing entry fail', () => {
    expect(rules(audit(make('nolic', { 'index.html': CLEAN_HTML }, false)))).toContain('no-license')
    expect(rules(audit(make('noentry', { 'index.html': CLEAN_HTML }), { entry: 'play.html' }))).toContain('entry-missing')
  })
  it('a symbolic link fails', () => {
    const d = make('sym', { 'index.html': CLEAN_HTML })
    try { symlinkSync(join(d, 'index.html'), join(d, 'link.html')) } catch { return }
    expect(rules(audit(d))).toContain('symlink')
  })
  it('a plain link in text or a comment is a warning, not a failure; svg / w3.org namespaces are ignored', () => {
    const r = audit(make('warn', { 'index.html': CLEAN_HTML, 'a.js': '// source: https://github.com/example/games\nconst x = 1\n', 's.svg': '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>' }))
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.rule)).toEqual(['plain-link'])
  })
  it('auditGamesRoot audits each sub folder and ignores loose files', () => {
    const rr = join(root, 'rootcase')
    mkdirSync(join(rr, 'good'), { recursive: true }); mkdirSync(join(rr, 'bad'), { recursive: true })
    writeFileSync(join(rr, 'manifest.json'), '{}')
    writeFileSync(join(rr, 'good', 'LICENSE'), MIT); writeFileSync(join(rr, 'good', 'index.html'), CLEAN_HTML)
    writeFileSync(join(rr, 'bad', 'LICENSE'), MIT); writeFileSync(join(rr, 'bad', 'a.js'), 'eval("1")')
    const res = auditRoot(rr)
    expect(Object.keys(res).sort()).toEqual(['bad', 'good'])
    expect(res.good!.ok).toBe(true)
    expect(res.bad!.ok).toBe(false)
  })
})
