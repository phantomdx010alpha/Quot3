import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from '../../../shared/ai/modelConfig'
import { createAiService, type AiServiceDeps } from '../aiService'
import { createFakeSpawner, tick, type FakeControl } from './fakeWorker'

function setup(ctl: FakeControl = {}, over: Partial<AiServiceDeps> & { enabled?: boolean; present?: boolean } = {}) {
  const sp = createFakeSpawner(ctl)
  const logs: string[] = []
  const flags = { enabled: over.enabled ?? true, present: over.present ?? true }
  const svc = createAiService({ model: DEFAULT_MODEL, modelRoot: '/x', modelPresent: () => flags.present, spawn: sp.spawn, isEnabled: () => flags.enabled, log: (m) => logs.push(m), ...over })
  return { svc, sp, logs, flags }
}

describe('aiService (fake worker, fake embedder)', () => {
  it('AI off: nothing is spawned and embed says off', async () => {
    const { svc, sp, flags } = setup({}, { enabled: false })
    expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'off' })
    expect(sp.workers.length).toBe(0)
    flags.enabled = true
    expect((await svc.embed(['a'], 'query')).ok).toBe(true)
  })
  it('model files missing: notInstalled status, embed fails with notInstalled, no spawn', async () => {
    const { svc, sp } = setup({}, { present: false })
    expect(svc.status()).toMatchObject({ state: 'notInstalled', loaded: false, modelId: 'multilingual-e5-small', dim: 384 })
    expect(await svc.embed(['a'], 'passage')).toEqual({ ok: false, reason: 'notInstalled' })
    expect(sp.workers.length).toBe(0)
  })
  it('status goes ready(not loaded) -> loading -> ready(loaded); vectors carry the e5 prefix and the right size', async () => {
    const { svc, sp } = setup()
    expect(svc.status()).toMatchObject({ state: 'ready', loaded: false, embedded: 0 })
    const p = svc.embed(['red tomato', 'sugar'], 'query')
    expect(svc.status().state).toBe('loading')
    const r = await p
    expect(r.ok && r.vectors.length).toBe(2)
    expect(r.ok && r.vectors[0]!.length).toBe(384)
    expect(sp.workers[0]!.embeds()[0]!.texts).toEqual(['query: red tomato', 'query: sugar'])
    expect(svc.status()).toMatchObject({ state: 'ready', loaded: true, embedded: 2 })
    expect(svc.status().lastEmbedMs).toBeGreaterThanOrEqual(0)
    await svc.embed(['x'], 'passage')
    expect(sp.workers[0]!.embeds()[1]!.texts).toEqual(['passage: x'])
    expect(sp.workers.length).toBe(1)
  })
  it('queue order: one job at a time, answered in the order asked', async () => {
    const { svc, sp } = setup({ hold: true })
    const order: string[] = []
    const ps = ['a', 'b', 'c'].map((t) => svc.embed([t], 'query').then((r) => { order.push(t); return r }))
    await tick(5)
    expect(sp.workers[0]!.embeds().length).toBe(1) // only the first is with the worker
    sp.workers[0]!.releaseHold()
    const rs = await Promise.all(ps)
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(sp.workers[0]!.embeds().map((e) => e.texts[0])).toEqual(['query: a', 'query: b', 'query: c'])
  })
  it('back-pressure: a full queue answers queueFull at once', async () => {
    const { svc, sp } = setup({ hold: true }, { maxQueue: 2 })
    const a = svc.embed(['1'], 'query'); const b = svc.embed(['2'], 'query')
    expect(await svc.embed(['3'], 'query')).toEqual({ ok: false, reason: 'queueFull' })
    sp.workers[0]!.releaseHold()
    expect((await a).ok && (await b).ok).toBe(true)
  })
  it('cancel: queued jobs of a group (and the running one) are released; the others still run; a late reply is ignored', async () => {
    const { svc, sp } = setup({ hold: true })
    const j1 = svc.embed(['1'], 'query', { group: 'a' }); const j2 = svc.embed(['2'], 'query', { group: 'b' }); const j3 = svc.embed(['3'], 'query', { group: 'a' })
    await tick(5)
    expect(svc.cancel('a')).toBe(2 + 0) // j3 queued + j1 running
    expect(await j1).toEqual({ ok: false, reason: 'cancelled' })
    expect(await j3).toEqual({ ok: false, reason: 'cancelled' })
    sp.workers[0]!.releaseHold()
    const r2 = await j2
    expect(r2.ok && r2.vectors.length).toBe(1)
    expect(svc.cancel()).toBe(0)
  })
  it('cancel with no group drops everything queued', async () => {
    const { svc } = setup({ hold: true })
    const ps = [svc.embed(['1'], 'query'), svc.embed(['2'], 'query'), svc.embed(['3'], 'query')]
    expect(svc.cancel()).toBe(3)
    for (const r of await Promise.all(ps)) expect(r).toEqual({ ok: false, reason: 'cancelled' })
  })
  it('crash: the running job fails, the worker is restarted for the next call, one log line per failure', async () => {
    const { svc, sp, logs } = setup({ crashOnEmbed: true })
    expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'error' })
    expect(sp.workers[0]!.killed).toBe(true)
    sp.ctl.crashOnEmbed = false
    expect((await svc.embed(['a'], 'query')).ok).toBe(true)
    expect(sp.workers.length).toBe(2)
    expect(logs.length).toBe(1)
    expect(svc.status().state).toBe('ready')
  })
  it('crash limit: after maxRestarts crashes in a row it stops (error status, no more spawns) until restart()', async () => {
    const { svc, sp, logs } = setup({ crashOnEmbed: true }, { maxRestarts: 2 })
    for (let i = 0; i < 3; i++) expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'error' })
    expect(sp.workers.length).toBe(3)
    expect(svc.status()).toMatchObject({ state: 'error' })
    expect(svc.status().reason).toContain('stopped 3 times')
    expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'error' })
    expect(sp.workers.length).toBe(3)
    expect(logs.length).toBeLessThanOrEqual(5)
    sp.ctl.crashOnEmbed = false
    svc.restart()
    expect((await svc.embed(['a'], 'query')).ok).toBe(true)
    expect(sp.workers.length).toBe(4)
    expect(svc.status().state).toBe('ready')
  })
  it('a good result resets the crash count', async () => {
    const { svc, sp } = setup({}, { maxRestarts: 1 })
    for (let i = 0; i < 3; i++) {
      sp.ctl.crashOnEmbed = true
      expect((await svc.embed(['a'], 'query')).ok).toBe(false)
      sp.ctl.crashOnEmbed = false
      expect((await svc.embed(['a'], 'query')).ok).toBe(true)
    }
    expect(svc.status().state).toBe('ready')
  })
  it('model load failure: error status with the reason, no restart loop', async () => {
    const { svc, sp } = setup({ loadError: 'bad onnx file' })
    expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'error' })
    expect(svc.status()).toMatchObject({ state: 'error' })
    expect(svc.status().reason).toContain('bad onnx file')
    await svc.embed(['a'], 'query')
    expect(sp.workers.length).toBe(1)
  })
  it('timeout: the job answers timeout, the stuck worker is killed and counted as a crash', async () => {
    const { svc, sp } = setup({ hold: true }, { jobTimeoutMs: 20 })
    expect(await svc.embed(['a'], 'query')).toEqual({ ok: false, reason: 'timeout' })
    expect(sp.workers[0]!.killed).toBe(true)
    sp.ctl.hold = false
    expect((await svc.embed(['a'], 'query')).ok).toBe(true)
    expect(sp.workers.length).toBe(2)
  })
  it('shutdown releases waiting jobs and kills the worker; turning AI off mid-queue answers off', async () => {
    const a = setup({ hold: true })
    const p = a.svc.embed(['1'], 'query'); const q = a.svc.embed(['2'], 'query')
    await tick(5)
    a.svc.shutdown()
    expect(await p).toEqual({ ok: false, reason: 'cancelled' })
    expect(await q).toEqual({ ok: false, reason: 'cancelled' })
    expect(a.sp.workers[0]!.killed).toBe(true)
    const b = setup({ hold: true })
    const r1 = b.svc.embed(['1'], 'query'); const r2 = b.svc.embed(['2'], 'query')
    await tick(5)
    b.flags.enabled = false
    b.sp.workers[0]!.releaseHold()
    expect((await r1).ok).toBe(true)
    expect(await r2).toEqual({ ok: false, reason: 'off' })
  })
})
