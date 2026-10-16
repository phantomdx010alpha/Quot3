import { describe, expect, it } from 'vitest'
import { THEME_SHARE_DEFAULT, THEME_SHARE_MAX_BYTES, decideIncoming, minReaderFor, planPush, themeContentHash, tooNewNotice, chunk, type IncomingTheme } from '../themeShare'
import { SETTING_DEFAULTS } from '../../settings'

const theme = { id: 'amber', name: 'Amber', base: 'navy-ember', tokens: { '--accent': '#FFB347' } }
const item = (over: Partial<IncomingTheme> = {}, payload: Record<string, unknown> = theme): IncomingTheme => ({
  themeId: 'amber', version: 2, payload, payloadHash: themeContentHash(payload), minReaderVer: 1, editedAt: '2026-10-16T10:00:00.000Z', origin: 'Shop A', ...over
})

describe('theme sharing rules (Phase 171)', () => {
  it('is OFF by default and the key is a known setting', () => {
    expect(THEME_SHARE_DEFAULT).toBe(false)
    expect(SETTING_DEFAULTS['themes.share']).toBe(false)
  })

  it('hash ignores key order and whitespace; reader version follows the schema', () => {
    expect(themeContentHash({ b: 1, a: { y: 2, x: 1 } })).toBe(themeContentHash({ a: { x: 1, y: 2 }, b: 1 }))
    expect(minReaderFor({ schema: 2 })).toBe(2)
    expect(minReaderFor({ id: 'x' })).toBe(1)
  })

  it('writes a valid new theme; skips what is already here or was removed here', () => {
    expect(decideIncoming({ item: item(), state: null, removed: null, local: null })).toEqual({ action: 'write', replacesLocal: false })
    expect(decideIncoming({ item: item(), state: { hash: item().payloadHash, version: 2, editedAt: '', serverSeq: 1, origin: null }, removed: null, local: null })).toEqual({ action: 'skip', why: 'same' })
    expect(decideIncoming({ item: item(), state: null, removed: { version: 2, hash: 'x' }, local: null })).toEqual({ action: 'skip', why: 'removed' })
    expect(decideIncoming({ item: item({ version: 3 }), state: null, removed: { version: 2, hash: 'x' }, local: null }).action).toBe('write')
  })

  it('sets aside too-new, too-big, invalid, built-in id, id mismatch and bad checksum; a v1 theme stays valid', () => {
    const d = (i: IncomingTheme) => decideIncoming({ item: i, state: null, removed: null, local: null })
    expect(d(item({ minReaderVer: 3 }))).toMatchObject({ action: 'aside', reason: 'too_new' })
    const big = { ...theme, tokens: { '--accent': '#FFB347' }, pad: 'x'.repeat(THEME_SHARE_MAX_BYTES) }
    expect(d(item({}, big))).toMatchObject({ action: 'aside', reason: 'too_big' })
    const evil = { id: 'evil', name: 'Evil', tokens: { '--surface-base': 'url(x)' } }
    expect(d(item({ themeId: 'evil' }, evil))).toMatchObject({ action: 'aside', reason: 'invalid' })
    const paper = { id: 'paper', name: 'P', tokens: {} }
    expect(d(item({ themeId: 'paper' }, paper))).toMatchObject({ action: 'aside', reason: 'invalid' })
    expect(d(item({ themeId: 'other' }))).toMatchObject({ action: 'aside', reason: 'invalid' })
    expect(d(item({ payloadHash: 'abcdef12' }))).toMatchObject({ action: 'aside', reason: 'invalid' })
  })

  it('a local unsent edit that is newer stays; an older one is replaced', () => {
    const local = { hash: 'other', editedAtMs: Date.parse('2026-10-16T11:00:00.000Z') }
    expect(decideIncoming({ item: item(), state: null, removed: null, local })).toEqual({ action: 'skip', why: 'local_newer' })
    expect(decideIncoming({ item: item(), state: null, removed: null, local: { ...local, editedAtMs: Date.parse('2026-10-16T09:00:00.000Z') } })).toEqual({ action: 'write', replacesLocal: true })
    // an unchanged (already exchanged) local file never blocks a newer version
    expect(decideIncoming({ item: item(), state: { hash: 'other', version: 1, editedAt: '', serverSeq: 1, origin: null }, removed: null, local })).toEqual({ action: 'write', replacesLocal: true })
  })

  it('push plan: only changed themes, oversize ones reported, edit time skew-corrected, batches of 20', () => {
    const c = (id: string, extra = {}) => { const json = { id, name: id, tokens: {}, ...extra }; return { id, json, hash: themeContentHash(json), editedAtMs: 1_000_000 } }
    const a = c('a'), b = c('b'), big = c('big', { pad: 'x'.repeat(THEME_SHARE_MAX_BYTES) })
    const states = new Map([['a', { hash: a.hash, version: 1, editedAt: '', serverSeq: 1, origin: null }]])
    const p = planPush([a, b, big], states, 5000)
    expect(p.items.map((i) => i.themeId)).toEqual(['b'])
    expect(p.tooBig).toEqual(['big'])
    expect(p.items[0]?.editedAt).toBe(new Date(1_005_000).toISOString())
    expect(p.items[0]).toMatchObject({ schemaVer: 1, minReaderVer: 1 })
    expect(chunk(Array.from({ length: 45 }, (_, i) => i), 20).map((x) => x.length)).toEqual([20, 20, 5])
  })

  it('the notice reads "Update the app to use N themes"', () => {
    expect(tooNewNotice(0)).toBe('')
    expect(tooNewNotice(1)).toBe('Update the app to use 1 theme.')
    expect(tooNewNotice(3)).toBe('Update the app to use 3 themes.')
  })
})
