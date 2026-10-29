import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gameCsp, handleGameRequest, isLeaveGameInput, mimeFor, parseGameUrl, shouldCancelGameRequest } from '../gameProtocol'

let root: string
let outside: string
const deps = (): { gamesRoot: string; frameAncestors: string; allowSelftest: boolean } => ({ gamesRoot: root, frameAncestors: 'file:', allowSelftest: true })
const get = (url: string, extra: { method?: string; range?: string } = {}): ReturnType<typeof handleGameRequest> => handleGameRequest({ url, ...extra }, deps())
const text = (b: Buffer | null): string => (b ? b.toString('utf8') : '')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'q3games-'))
  outside = mkdtempSync(join(tmpdir(), 'q3outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET')
  mkdirSync(join(root, 'snake', 'sub'), { recursive: true })
  mkdirSync(join(root, '_selftest'), { recursive: true })
  mkdirSync(join(root, 'other'), { recursive: true })
  writeFileSync(join(root, 'snake', 'index.html'), '<p>snake</p>')
  writeFileSync(join(root, 'snake', 'sub', 'a b.js'), 'var x=1')
  writeFileSync(join(root, 'snake', 'sound.ogg'), Buffer.from('0123456789'))
  writeFileSync(join(root, 'other', 'index.html'), '<p>other</p>')
  writeFileSync(join(root, '_selftest', 'index.html'), '<p>selftest</p>')
  writeFileSync(join(root, 'manifest.json'), '{}')
  try {
    symlinkSync(outside, join(root, 'snake', 'link-dir'))
    symlinkSync(join(outside, 'secret.txt'), join(root, 'snake', 'link-file.txt'))
    symlinkSync(resolve(root, 'other'), join(root, 'snake', 'to-other'))
  } catch { /* no symlink permission on this machine: those assertions are skipped below */ }
})
afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) })

describe('parseGameUrl', () => {
  it('accepts a normal game url and splits the path', () => {
    expect(parseGameUrl('q3game://snake/index.html')).toEqual({ ok: true, id: 'snake', segments: ['index.html'] })
    expect(parseGameUrl('q3game://snake/sub/a%20b.js?v=1#x')).toEqual({ ok: true, id: 'snake', segments: ['sub', 'a b.js'] })
    expect(parseGameUrl('Q3GAME://Snake/index.html')).toMatchObject({ ok: true, id: 'snake' })
  })
  it('refuses traversal in every spelling, absolute and drive paths, backslashes, NUL', () => {
    for (const p of ['/../x', '/a/../x', '/%2e%2e/x', '/%2E%2E/x', '/a%2f..%2fx', '/a%5cx', '/a\\x', '/C:/x', '/a//b', '/./x', '/%00x', '/a/%2e/b', '/a%00']) {
      expect(parseGameUrl('q3game://snake' + p).ok, p).toBe(false)
    }
  })
  it('refuses other schemes, bad ids and a bare folder', () => {
    expect(parseGameUrl('https://snake/index.html').ok).toBe(false)
    expect(parseGameUrl('file:///etc/passwd').ok).toBe(false)
    expect(parseGameUrl('q3game:///index.html')).toMatchObject({ ok: false, status: 404 })
    expect(parseGameUrl('q3game://bad id/index.html').ok).toBe(false)
    expect(parseGameUrl('q3game://snake/')).toMatchObject({ ok: false })
    expect(parseGameUrl('q3game://snake')).toMatchObject({ ok: false })
  })
  it('_selftest is only addressable when the test switch is on', () => {
    expect(parseGameUrl('q3game://_selftest/index.html').ok).toBe(false)
    expect(parseGameUrl('q3game://_selftest/index.html', { allowSelftest: true }).ok).toBe(true)
  })
})

describe('handleGameRequest', () => {
  it('serves a file with its type, the CSP header and nosniff', async () => {
    const r = await get('q3game://snake/index.html')
    expect(r.status).toBe(200)
    expect(text(r.body)).toBe('<p>snake</p>')
    expect(r.headers['Content-Type']).toContain('text/html')
    expect(r.headers['Content-Security-Policy']).toBe(gameCsp('file:'))
    expect(r.headers['X-Content-Type-Options']).toBe('nosniff')
    expect((await get('q3game://snake/sub/a%20b.js')).headers['Content-Type']).toContain('javascript')
  })
  it('serves the self-test game and gives each answer the CSP (also errors)', async () => {
    expect((await get('q3game://_selftest/index.html')).status).toBe(200)
    const e = await get('q3game://snake/nope.html')
    expect(e.status).toBe(404)
    expect(e.headers['Content-Security-Policy']).toContain("default-src 'self' data: blob:")
  })
  it('the game CSP matches the contract and has no unsafe-eval, no remote sources', () => {
    const csp = gameCsp('http://localhost:5173')
    expect(csp).toBe("default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors http://localhost:5173")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/https?:\/\/(?!localhost)/)
  })
  it('unknown game id, missing file, a folder and a loose file in the root are 404', async () => {
    expect((await get('q3game://nothere/index.html')).status).toBe(404)
    expect((await get('q3game://snake/missing.png')).status).toBe(404)
    expect((await get('q3game://snake/sub')).status).toBe(404)
    expect((await get('q3game://manifest.json/x')).status).toBe(404)
  })
  it('traversal attempts never reach the disk or another game', async () => {
    for (const u of ['q3game://snake/../other/index.html', 'q3game://snake/%2e%2e/other/index.html', 'q3game://snake/..%2fother%2findex.html', `q3game://snake/${encodeURIComponent(join(outside, 'secret.txt'))}`, 'q3game://snake//etc/passwd']) {
      const r = await get(u)
      expect(r.status, u).toBeGreaterThanOrEqual(400)
      expect(text(r.body)).not.toContain('SECRET')
      expect(text(r.body)).not.toContain('other')
    }
  })
  it('a symlink that leaves the game folder is refused (file, folder, and a link into another game)', async () => {
    for (const u of ['q3game://snake/link-file.txt', 'q3game://snake/link-dir/secret.txt', 'q3game://snake/to-other/index.html']) {
      const r = await get(u)
      expect([200, 404]).toContain(r.status) // 200 only if the machine could not create the link and... it cannot: the file would not exist
      expect(text(r.body)).not.toContain('SECRET')
      expect(text(r.body)).not.toContain('<p>other</p>')
    }
  })
  it('read-only: only GET and HEAD; HEAD has no body', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) expect((await get('q3game://snake/index.html', { method: m })).status).toBe(405)
    const h = await get('q3game://snake/index.html', { method: 'HEAD' })
    expect(h.status).toBe(200)
    expect(h.body).toBeNull()
    expect(h.headers['Content-Length']).toBe('12')
  })
  it('range requests for audio: partial content, suffix ranges, and 416 when out of range', async () => {
    const a = await get('q3game://snake/sound.ogg', { range: 'bytes=2-4' })
    expect(a.status).toBe(206)
    expect(text(a.body)).toBe('234')
    expect(a.headers['Content-Range']).toBe('bytes 2-4/10')
    expect(text((await get('q3game://snake/sound.ogg', { range: 'bytes=-3' })).body)).toBe('789')
    expect(text((await get('q3game://snake/sound.ogg', { range: 'bytes=7-' })).body)).toBe('789')
    expect((await get('q3game://snake/sound.ogg', { range: 'bytes=50-60' })).status).toBe(416)
    expect((await get('q3game://snake/sound.ogg', { range: 'garbage' })).status).toBe(200)
  })
  it('mime types', () => {
    expect(mimeFor('a.wasm')).toBe('application/wasm')
    expect(mimeFor('a.PNG')).toBe('image/png')
    expect(mimeFor('a.zzz')).toBe('application/octet-stream')
  })
})

describe('shouldCancelGameRequest (network filter)', () => {
  const from = 'q3game://snake'
  it('cancels anything a game page asks for outside q3game / data / blob', () => {
    for (const url of ['https://example.com/x.js', 'http://localhost:5173/', 'file:///C:/Users/x/secret.db', 'ws://example.com/', 'ftp://x/y', 'not a url']) expect(shouldCancelGameRequest({ url, initiator: from }), url).toBe(true)
    expect(shouldCancelGameRequest({ url: 'https://example.com/', referrer: 'q3game://snake/index.html' })).toBe(true)
  })
  it('lets a game load its own files, data: and blob:', () => {
    for (const url of ['q3game://snake/a.js', 'data:image/png;base64,AAAA', 'blob:q3game://snake/1234']) expect(shouldCancelGameRequest({ url, initiator: from }), url).toBe(false)
  })
  it('never touches the app itself (no game initiator)', () => {
    expect(shouldCancelGameRequest({ url: 'https://example.com/' })).toBe(false)
    expect(shouldCancelGameRequest({ url: 'https://example.com/', initiator: 'file://' })).toBe(false)
    expect(shouldCancelGameRequest({ url: 'https://example.com/', initiator: 'http://localhost:5173' })).toBe(false)
  })
})

describe('isLeaveGameInput (Alt+Left)', () => {
  it('only a plain Alt+Left key-down', () => {
    expect(isLeaveGameInput({ type: 'keyDown', key: 'ArrowLeft', alt: true })).toBe(true)
    expect(isLeaveGameInput({ type: 'keyUp', key: 'ArrowLeft', alt: true })).toBe(false)
    expect(isLeaveGameInput({ type: 'keyDown', key: 'ArrowLeft' })).toBe(false)
    expect(isLeaveGameInput({ type: 'keyDown', key: 'ArrowLeft', alt: true, control: true })).toBe(false)
    expect(isLeaveGameInput({ type: 'keyDown', key: 'ArrowLeft', alt: true, shift: true })).toBe(false)
    expect(isLeaveGameInput({ type: 'keyDown', key: 'ArrowRight', alt: true })).toBe(false)
  })
})
