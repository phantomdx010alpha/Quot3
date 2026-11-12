import { describe, expect, it } from 'vitest'
import type { AiService } from '../../ai/aiService'
import type { EmbedOutcome } from '../../../shared/ai/aiStatus'
import { aiHandlers } from '../ai'

const status = { state: 'ready' as const, modelId: 'm', dim: 4, loaded: false, embedded: 0 }
function svc(outcome: EmbedOutcome): AiService & { calls: unknown[] } {
  const calls: unknown[] = []
  return { calls, status: () => status, embed: async (t, k) => { calls.push([t, k]); return outcome }, cancel: () => 0, restart: () => {}, shutdown: () => {} }
}

describe('ai IPC', () => {
  it('ai:status returns the service status and accepts only an empty object', async () => {
    const h = aiHandlers({ service: svc({ ok: false, reason: 'off' }) })
    expect(await h['ai:status']!({})).toEqual({ ok: true, data: status })
    expect(((await h['ai:status']!({ x: 1 })) as { ok: boolean }).ok).toBe(false)
  })
  it('ai:embed validates texts and kind before the service is touched', async () => {
    const s = svc({ ok: true, vectors: [new Float32Array([1, 0])] })
    const h = aiHandlers({ service: s })
    const bad: unknown[] = [{}, { texts: [], kind: 'query' }, { texts: ['a'], kind: 'other' }, { texts: [1], kind: 'query' }, { texts: Array(65).fill('a'), kind: 'query' }, { texts: ['a'.repeat(513)], kind: 'query' }, { texts: ['a'], kind: 'query', extra: 1 }, null, 'x']
    for (const b of bad) {
      const r = (await h['ai:embed']!(b)) as { ok: boolean; error?: { code: string } }
      expect(r.ok).toBe(false)
      expect(r.error?.code).toBe('VALIDATION')
    }
    expect(s.calls).toEqual([])
    const good = (await h['ai:embed']!({ texts: ['a'], kind: 'passage' })) as { ok: true; data: { vectors: Float32Array[] } }
    expect(good.ok && good.data.vectors.length).toBe(1)
    expect(s.calls).toEqual([[['a'], 'passage']])
  })
  it('a failing AI is a normal answer, not an error: vectors null with a reason', async () => {
    const h = aiHandlers({ service: svc({ ok: false, reason: 'notInstalled' }) })
    expect(await h['ai:embed']!({ texts: ['a'], kind: 'query' })).toEqual({ ok: true, data: { vectors: null, reason: 'notInstalled' } })
  })
  it('ai:suggestForParty is registered only with a suggest port, validates input and passes it through', async () => {
    expect(aiHandlers({ service: svc({ ok: false, reason: 'off' }) })['ai:suggestForParty']).toBeUndefined()
    const seen: unknown[] = []
    const h = aiHandlers({ service: svc({ ok: false, reason: 'off' }), suggest: { suggestForParty: async (i) => { seen.push(i); return { suggestions: [], embeddingsUsed: false } } } })
    for (const bad of [{}, { partyId: 1, partyName: 'a', text: 'b' }, { partyId: 'p', partyName: 'a', text: 'b'.repeat(201) }, { partyId: 'p', partyName: 'a', text: 'b', x: 1 }, null]) {
      expect(((await h['ai:suggestForParty']!(bad)) as { ok: boolean }).ok).toBe(false)
    }
    expect(seen).toEqual([])
    expect(await h['ai:suggestForParty']!({ partyId: null, partyName: 'Sharma', text: 'ruby' })).toEqual({ ok: true, data: { suggestions: [], embeddingsUsed: false } })
    expect(seen).toHaveLength(1)
  })
})
