import { describe, expect, it } from 'vitest'
import type { AiService } from '../../ai/aiService'
import { aiHandlers } from '../ai'

const service = { status: () => ({ state: 'ready' }) } as unknown as AiService

describe('ai:suggestGroups IPC (Phase 227)', () => {
  it('is registered only when the service is given, and validates its input', async () => {
    expect(aiHandlers({ service })['ai:suggestGroups']).toBeUndefined()
    const calls: string[] = []
    const h = aiHandlers({ service, groupSuggest: { suggestGroups: ({ groupId }) => { calls.push(groupId); return { suggestions: [], embeddingsUsed: false } } } })
    for (const bad of [{}, { groupId: '' }, { groupId: 1 }, { groupId: 'a', extra: 1 }, null]) {
      expect(((await h['ai:suggestGroups']!(bad)) as { ok: boolean }).ok).toBe(false)
    }
    expect(calls).toEqual([])
    expect(await h['ai:suggestGroups']!({ groupId: 'A B' })).toEqual({ ok: true, data: { suggestions: [], embeddingsUsed: false } })
    expect(calls).toEqual(['A B'])
  })
})
