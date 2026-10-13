import { describe, expect, it } from 'vitest'
import { clipboardHandlers, MAX_CLIPBOARD_CHARS, QUOT3_CLIPBOARD_FORMAT } from '../clipboard'
import { QUOT3_GRID_MIME } from '../../../shared/tsv/gridClip'

const h = (text: string, flavour?: string | 'throw') =>
  clipboardHandlers({ readText: async () => text, readFlavour: async () => { if (flavour === 'throw') throw new Error('x'); return flavour ?? null }, write: async () => undefined })['clipboard:readGrid'] as (raw: unknown) => Promise<unknown>

describe('clipboard:readGrid', () => {
  it('format string matches the shared MIME constant', () => { expect(QUOT3_CLIPBOARD_FORMAT).toBe(QUOT3_GRID_MIME) })
  it('returns text, and the flavour when present', async () => {
    expect(await h('a\tb')({})).toEqual({ ok: true, data: { tsv: 'a\tb' } })
    expect(await h('a', '{"v":1}')({})).toEqual({ ok: true, data: { tsv: 'a', quot3: '{"v":1}' } })
  })
  it('empty clipboard → empty object; a throwing flavour read is ignored', async () => {
    expect(await h('')({})).toEqual({ ok: true, data: {} })
    expect(await h('x', 'throw')({})).toEqual({ ok: true, data: { tsv: 'x' } })
  })
  it('oversized text is dropped; extra input is rejected', async () => {
    expect(await h('x'.repeat(MAX_CLIPBOARD_CHARS + 1))({})).toEqual({ ok: true, data: {} })
    const r = (await h('x')({ a: 1 })) as { ok: boolean }
    expect(r.ok).toBe(false)
  })
})

describe('clipboard:writeTsv', () => {
  const mk = (fail = false) => {
    const written: Array<{ text: string; html?: string }> = []
    const h = clipboardHandlers({ readText: async () => '', readFlavour: async () => null, write: async (d) => { if (fail) throw new Error('locked'); written.push(d) } })['clipboard:writeTsv'] as (raw: unknown) => Promise<{ ok: boolean; error?: { code: string } }>
    return { h, written }
  }
  it('writes text and html through the port and returns {}', async () => {
    const { h, written } = mk()
    expect(await h({ text: 'a\tb', html: '<table></table>' })).toEqual({ ok: true, data: {} })
    expect(written).toEqual([{ text: 'a\tb', html: '<table></table>' }])
  })
  it('html is optional', async () => {
    const { h, written } = mk()
    await h({ text: 'x' })
    expect(written).toEqual([{ text: 'x' }])
  })
  it('rejects empty/oversized text, wrong types and extra keys without writing', async () => {
    const { h, written } = mk()
    for (const bad of [{ text: '' }, { text: 'x'.repeat(MAX_CLIPBOARD_CHARS + 1) }, { text: 1 }, { text: 'x', extra: 1 }, {}, null]) expect((await h(bad)).ok).toBe(false)
    expect(written).toEqual([])
  })
  it('a failing OS write becomes an error result, not a throw', async () => {
    const r = await mk(true).h({ text: 'x' })
    expect(r.ok).toBe(false)
  })
})

