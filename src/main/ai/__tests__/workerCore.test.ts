import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cosine, norm } from '../../../shared/ai/vectorMath'
import { EMBED_BATCH } from '../../../shared/ai/aiStatus'
import { E5_SMALL } from '../../../shared/ai/modelConfig'
import { createFakeEmbedder, fakeVector } from '../fakeEmbedder'
import { modelFilesPresent } from '../modelFiles'
import type { FromWorker } from '../workerProtocol'
import { createWorkerCore, type Extractor } from '../workerCore'

const INIT = { type: 'init' as const, modelRoot: '/x', model: { id: 'm', dtype: 'int8' as const, pooling: 'mean' as const, normalize: true, maxTokens: 64 } }

describe('workerCore', () => {
  it('batches texts by EMBED_BATCH and keeps the order', async () => {
    const sizes: number[] = []
    const ex: Extractor = async (t) => { sizes.push(t.length); return createFakeEmbedder(8)(t) }
    const out: FromWorker[] = []
    const core = createWorkerCore({ load: async () => ex, post: (m) => out.push(m) })
    await core.handle(INIT)
    const texts = Array.from({ length: 40 }, (_, i) => `item ${i}`)
    await core.handle({ type: 'embed', id: 7, texts })
    expect(sizes).toEqual([EMBED_BATCH, EMBED_BATCH, 40 - 2 * EMBED_BATCH])
    const r = out[1]!
    expect(r.type === 'result' && r.id === 7 && r.vectors.length === 40).toBe(true)
    if (r.type === 'result') expect(Array.from(r.vectors[5]!)).toEqual(Array.from(fakeVector('item 5', 8)))
  })
  it('load failure posts an error without an id; embed before init posts an error with the id', async () => {
    const out: FromWorker[] = []
    const core = createWorkerCore({ load: async () => { throw new Error('no model') }, post: (m) => out.push(m) })
    await core.handle({ type: 'embed', id: 1, texts: ['a'] })
    await core.handle(INIT)
    expect(out).toEqual([{ type: 'error', id: 1, message: 'model not loaded' }, { type: 'error', message: 'no model' }])
  })
  it('a wrong vector count or a throwing extractor becomes an error for that id only', async () => {
    const out: FromWorker[] = []
    let mode: 'short' | 'throw' | 'ok' = 'short'
    const ex: Extractor = async (t) => { if (mode === 'throw') throw new Error('boom'); return mode === 'short' ? [] : createFakeEmbedder(4)(t) }
    const core = createWorkerCore({ load: async () => ex, post: (m) => out.push(m) })
    await core.handle(INIT)
    await core.handle({ type: 'embed', id: 2, texts: ['a'] })
    mode = 'throw'
    await core.handle({ type: 'embed', id: 3, texts: ['a'] })
    mode = 'ok'
    await core.handle({ type: 'embed', id: 4, texts: ['a'] })
    expect(out.slice(1).map((m) => (m.type === 'error' ? `e${m.id}` : `r${(m as { id: number }).id}`))).toEqual(['e2', 'e3', 'r4'])
  })
})

describe('fakeEmbedder', () => {
  it('is deterministic, unit length, ignores the e5 prefix, and ranks look-alikes higher', () => {
    const a = fakeVector('red tomato'), b = fakeVector('red tomato')
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a.length).toBe(384)
    expect(norm(a)).toBeCloseTo(1, 5)
    expect(Array.from(fakeVector('query: red tomato'))).toEqual(Array.from(fakeVector('passage: red tomato')))
    expect(cosine(a, fakeVector('tomato red'))).toBeGreaterThan(cosine(a, fakeVector('steel nail')))
    expect(cosine(fakeVector('brown sugar'), fakeVector('sugar brown'))).toBeGreaterThan(0.8)
    expect(norm(fakeVector(''))).toBe(0) // empty text has no trigrams: a zero vector, never NaN
  })
})

describe('modelFilesPresent', () => {
  it('is true only when every pinned file name exists under the model folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'q3m-'))
    try {
      expect(modelFilesPresent(E5_SMALL, root)).toBe(false)
      for (const f of E5_SMALL.files) { mkdirSync(join(root, ...f.path.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(root, ...f.path.split('/')), 'x') }
      expect(modelFilesPresent(E5_SMALL, root)).toBe(true)
      rmSync(join(root, 'config.json'))
      expect(modelFilesPresent(E5_SMALL, root)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
