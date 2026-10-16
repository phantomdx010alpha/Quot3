import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../logger'
import { createThemeService } from '../../services/themeService'
import { themeContentHash, THEME_SHARE_KEY } from '../../../shared/theme/themeShare'
import { createThemeShare } from '../themeShare'
import { FakeThemeServer } from './themeShareFake'

const amber = { id: 'amber', name: 'Amber', base: 'navy-ember', tokens: { '--accent': '#FFB347' } }
const amber2 = { id: 'amber', name: 'Amber Two', base: 'navy-ember', tokens: { '--accent': '#FF9933' } }

function pc(server: FakeThemeServer, branchId: string, o: { enabled?: boolean; signedIn?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'q3share-'))
  const dir = join(root, 'themes')
  mkdirSync(dir)
  const store = new Map<string, string>()
  const sync = {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => void store.set(k, v),
    remove: (ks: readonly string[]) => void ks.forEach((k) => store.delete(k)),
    keys: (p: string) => [...store.keys()].filter((k) => k.startsWith(p))
  }
  const settings = new Map<string, unknown>([[THEME_SHARE_KEY, o.enabled ?? true]])
  const themes = createThemeService({ dir, log: createLogger({ dir: root }) })
  const logs: string[] = []
  const log = { info: (m: string, d?: unknown) => void logs.push(m + JSON.stringify(d ?? '')), warn: (m: string, d?: unknown) => void logs.push(m + JSON.stringify(d ?? '')) }
  const connect = vi.fn(async () => ({ transport: server.transportFor(branchId), creds: { license: 'LIC', branchId } }))
  const changed = vi.fn()
  const share = createThemeShare({ themes, sync, settings: { get: (k) => settings.get(k), set: (k, v) => void settings.set(k, v) }, connect, isSignedIn: () => o.signedIn ?? true, appVer: '0.1.13', log, onChanged: changed })
  const put = (name: string, obj: unknown, whenMs?: number): string => {
    const f = join(dir, name)
    writeFileSync(f, JSON.stringify(obj))
    if (whenMs !== undefined) utimesSync(f, whenMs / 1000, whenMs / 1000)
    return f
  }
  return { share, themes, dir, put, store, settings, connect, logs, changed }
}

describe('theme sharing client (Phase 171, fake server)', () => {
  it('a new theme on PC A arrives on PC B, validated, with its origin', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a'), b = pc(s, 'branch-b')
    a.put('amber.json', amber)
    expect((await a.share.runNow()).sent).toBe(1)
    const r = await b.share.runNow()
    expect(r.received).toBe(1)
    expect(JSON.parse(readFileSync(join(b.dir, 'amber.json'), 'utf8')).tokens['--accent']).toBe('#FFB347')
    expect(b.share.status().shared).toEqual([expect.objectContaining({ id: 'amber', name: 'Amber', origin: 'Shop A' })])
    expect(a.share.status().shared[0]?.origin).toBe('This PC')
    expect(b.changed).toHaveBeenCalled()
    // a second run exchanges nothing (own themes come back and are recognised)
    expect(await a.share.runNow()).toMatchObject({ sent: 0, received: 0 })
    expect(await b.share.runNow()).toMatchObject({ sent: 0, received: 0 })
  })

  it('switch OFF (the default) sends and pulls nothing and never connects', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a', { enabled: false })
    a.put('amber.json', amber)
    expect(await a.share.runNow()).toEqual({ sent: 0, received: 0, setAside: 0, skipped: 0 })
    expect(s.pushes + s.pulls).toBe(0)
    expect(a.connect).not.toHaveBeenCalled()
    const b = pc(s, 'branch-b', { signedIn: false })
    b.put('amber.json', amber)
    await b.share.runNow()
    expect(b.connect).not.toHaveBeenCalled()
    // turning it on sends
    const c = pc(s, 'branch-a', { enabled: false })
    c.put('x.json', { id: 'x-theme', name: 'X', tokens: {} })
    await c.share.setEnabled(true)
    expect(s.rows.has('x-theme')).toBe(true)
    expect(c.settings.get(THEME_SHARE_KEY)).toBe(true)
  })

  it('same id: the newer edit wins, the older local file is kept in history', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a'), b = pc(s, 'branch-b')
    const now = Date.now()
    a.put('amber.json', amber, now - 60_000)
    await a.share.runNow(); await b.share.runNow()
    // B edits later; A pulls it
    b.put('amber.json', amber2, now + 60_000)
    expect((await b.share.runNow()).sent).toBe(1)
    expect(s.rows.get('amber')?.version).toBe(2)
    expect(s.history.some((h) => h.reason === 'superseded')).toBe(true)
    const r = await a.share.runNow()
    expect(r.received).toBe(1)
    expect(JSON.parse(readFileSync(join(a.dir, 'amber.json'), 'utf8')).name).toBe('Amber Two')
    expect(readdirSync(join(a.dir, 'history')).filter((f) => f.startsWith('amber.'))).toHaveLength(1)
    // not deleted: the old content is in the history file
    const old = JSON.parse(readFileSync(join(a.dir, 'history', readdirSync(join(a.dir, 'history'))[0]!), 'utf8'))
    expect(old.name).toBe('Amber')
  })

  it('an older local edit loses on the server and the newer version replaces it', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a'), b = pc(s, 'branch-b')
    const now = Date.now()
    a.put('amber.json', amber, now + 120_000)
    await a.share.runNow()
    b.put('amber.json', amber2, now - 120_000) // older than what the server holds
    const r = await b.share.runNow()
    expect(r.received).toBe(1) // pull comes first: the newer server version wins here before any push
    expect(JSON.parse(readFileSync(join(b.dir, 'amber.json'), 'utf8')).name).toBe('Amber')
    expect(s.rows.get('amber')?.version).toBe(1)
  })

  it('a local unsent edit that is newer than the server copy is kept and wins the push', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a'), b = pc(s, 'branch-b')
    const now = Date.now()
    a.put('amber.json', amber, now - 120_000)
    await a.share.runNow()
    b.put('amber.json', amber2, now + 120_000)
    const r = await b.share.runNow()
    expect(r).toMatchObject({ received: 0, sent: 1 })
    expect(JSON.parse(readFileSync(join(b.dir, 'amber.json'), 'utf8')).name).toBe('Amber Two')
    expect(s.rows.get('amber')?.version).toBe(2)
  })

  it('a bad theme is set aside, never written, never blocks the cursor, and is listed without contents', async () => {
    const s = new FakeThemeServer()
    const b = pc(s, 'branch-b')
    const hostile = { id: 'evil', name: 'Evil', tokens: { '--surface-base': 'url(http://x/y.png)' } }
    s.inject('evil', hostile, { payloadHash: themeContentHash(hostile) })
    const wrongHash = { id: 'sneaky', name: 'Sneaky', tokens: { '--accent': '#112233' } }
    s.inject('sneaky', wrongHash, { payloadHash: 'deadbeefdeadbeef' })
    const paper = { id: 'paper', name: 'Fake Paper', tokens: {} }
    s.inject('paper', paper, { payloadHash: themeContentHash(paper) })
    s.inject('good-one', { id: 'good-one', name: 'Good', tokens: {} }, { payloadHash: themeContentHash({ id: 'good-one', name: 'Good', tokens: {} }) })
    const r = await b.share.runNow()
    expect(r).toMatchObject({ received: 1, setAside: 3 })
    expect(existsSync(join(b.dir, 'evil.json'))).toBe(false)
    expect(existsSync(join(b.dir, 'good-one.json'))).toBe(true)
    const st = b.share.status()
    expect(st.aside.map((a) => a.id)).toEqual(['evil', 'paper', 'sneaky'])
    expect(st.aside.every((a) => a.reason === 'invalid')).toBe(true)
    expect(JSON.stringify(st)).not.toContain('http://x')
    expect(b.logs.join('\n')).not.toContain('http://x')
    expect(b.logs.join('\n')).not.toContain('#112233')
    // the cursor moved past all four: a second run pulls nothing new
    expect((await b.share.runNow()).setAside).toBe(0)
  })

  it('a theme that needs a newer app is set aside with the "Update the app" notice, not applied', async () => {
    const s = new FakeThemeServer()
    const b = pc(s, 'branch-b')
    const fut = { schema: 3, id: 'future', name: 'Future', tokens: {} }
    s.inject('future', fut, { payloadHash: themeContentHash(fut), minReaderVer: 3, schemaVer: 3 })
    await b.share.runNow()
    const st = b.share.status()
    expect(st.tooNew).toBe(1)
    expect(st.notice).toBe('Update the app to use 1 theme.')
    expect(existsSync(join(b.dir, 'future.json'))).toBe(false)
    // it is kept (with its payload) for after the update, and re-checked each run without being counted as new
    expect((await b.share.runNow()).setAside).toBe(0)
    expect(b.share.status().tooNew).toBe(1)
  })

  it('Remove is local only; the theme stays on the server and does not come back until a NEWER version arrives', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a'), b = pc(s, 'branch-b')
    const now = Date.now()
    a.put('amber.json', amber, now - 60_000)
    await a.share.runNow(); await b.share.runNow()
    const st = b.share.removeShared('amber')
    expect(st.shared).toHaveLength(0)
    expect(existsSync(join(b.dir, 'amber.json'))).toBe(false)
    expect(readdirSync(join(b.dir, 'history')).some((f) => f.startsWith('amber.'))).toBe(true) // not deleted outright
    expect(s.rows.has('amber')).toBe(true)
    expect(await b.share.runNow()).toMatchObject({ received: 0, sent: 0 })
    expect(existsSync(join(b.dir, 'amber.json'))).toBe(false)
    a.put('amber.json', amber2, now + 60_000)
    await a.share.runNow()
    expect((await b.share.runNow()).received).toBe(1)
    expect(existsSync(join(b.dir, 'amber.json'))).toBe(true)
    expect(() => b.share.removeShared('nothing-here')).toThrow()
  })

  it('built-in themes are never sent, and an unreachable server is reported without contents', async () => {
    const s = new FakeThemeServer()
    const a = pc(s, 'branch-a')
    a.put('amber.json', amber)
    a.connect.mockRejectedValueOnce(new Error('connection to secret.example refused with token abc'))
    const r = await a.share.runNow()
    expect(r.sent).toBe(0)
    const last = a.share.status().last
    expect(last?.error).toBe('Themes could not be synced.')
    expect(JSON.stringify(last)).not.toContain('secret')
    await a.share.runNow()
    expect([...s.rows.keys()]).toEqual(['amber'])
  })
})
