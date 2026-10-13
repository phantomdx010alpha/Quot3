import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, fail, ok, wrapHandler } from '../envelope'

describe('envelope', () => {
  it('ok / fail shapes', () => {
    expect(ok(5)).toEqual({ ok: true, data: 5 })
    expect(fail('NOT_FOUND', 'x')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } })
    expect(fail('DB_ERROR', 'x', { a: 1 })).toEqual({
      ok: false,
      error: { code: 'DB_ERROR', message: 'x', details: { a: 1 } }
    })
  })

  it('returns data on valid input', async () => {
    const h = wrapHandler(z.object({ n: z.number() }), ({ n }) => n * 2)
    expect(await h({ n: 4 })).toEqual({ ok: true, data: 8 })
  })

  it('rejects invalid / extra input with VALIDATION and never calls the handler', async () => {
    let called = false
    const h = wrapHandler(z.object({ n: z.number() }).strict(), () => {
      called = true
    })
    const r1 = await h({ n: 'x' })
    const r2 = await h({ n: 1, evil: true })
    const r3 = await h(undefined)
    for (const r of [r1, r2, r3]) {
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('VALIDATION')
    }
    expect(called).toBe(false)
  })

  it('maps AppError to its code', async () => {
    const h = wrapHandler(z.object({}), () => {
      throw new AppError('IO_ERROR', 'disk')
    })
    expect(await h({})).toEqual({ ok: false, error: { code: 'IO_ERROR', message: 'disk' } })
  })

  it('converts unexpected throws to UNKNOWN without leaking the message', async () => {
    const h = wrapHandler(z.object({}), async () => {
      throw new Error('secret path C:\\Users\\x')
    })
    const r = await h({})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('UNKNOWN')
      expect(r.error.message).not.toContain('secret')
    }
  })

  it('validates output too', async () => {
    const h = wrapHandler(
      z.object({}),
      () => ({ a: 1 }) as unknown as { a: string },
      z.object({ a: z.string() })
    )
    const r = await h({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN')
  })
})
