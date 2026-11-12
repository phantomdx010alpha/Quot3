import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aiHandlers, type AiAdminPort } from '../../ipc/ai'
import { modelFilesBytes } from '../modelFiles'
import { DEFAULT_MODEL } from '../../../shared/ai/modelConfig'
import type { AiAdminState } from '../../../shared/ai/aiAdmin'

const state = (): AiAdminState => ({ status: { state: 'ready', modelId: 'm', dim: 384, loaded: false, embedded: 0 }, progress: { state: 'idle', total: 0, done: 0, pending: 0 }, vectors: 3 })

function fake() {
  const calls: string[] = []
  const admin: AiAdminPort = { state, pause: () => { calls.push('pause') }, resume: () => { calls.push('resume') }, rebuild: () => { calls.push('rebuild') }, deleteData: () => { calls.push('delete'); return { ok: true, removed: 3 } } }
  return { calls, h: aiHandlers({ service: { status: () => state().status } as never, admin }) }
}

describe('Phase 230 - ai admin channels', () => {
  it('registers the five channels only when an admin port exists', () => {
    expect(Object.keys(fake().h)).toEqual(expect.arrayContaining(['ai:admin', 'ai:pause', 'ai:resume', 'ai:rebuild', 'ai:deleteData']))
    expect(Object.keys(aiHandlers({ service: {} as never }))).not.toContain('ai:admin')
  })
  it('each control calls its port method and answers the new state; delete answers the count', async () => {
    const { h, calls } = fake()
    expect(await h['ai:admin']!({})).toMatchObject({ ok: true, data: { vectors: 3 } })
    for (const c of ['pause', 'resume', 'rebuild']) expect(await h[`ai:${c}`]!({})).toMatchObject({ ok: true, data: { vectors: 3 } })
    expect(await h['ai:deleteData']!({})).toMatchObject({ ok: true, data: { ok: true, removed: 3 } })
    expect(calls).toEqual(['pause', 'resume', 'rebuild', 'delete'])
  })
  it('refuses a payload with extra fields', async () => {
    const { h, calls } = fake()
    const r = await h['ai:deleteData']!({ all: true }) as { ok: boolean }
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })
  it('modelFilesBytes adds up the files and counts a missing one as 0', () => {
    const root = mkdtempSync(join(tmpdir(), 'q3ai-'))
    const first = DEFAULT_MODEL.files[0]!.path.split('/')
    mkdirSync(join(root, ...first.slice(0, -1)), { recursive: true })
    writeFileSync(join(root, ...first), 'abcde')
    expect(modelFilesBytes(DEFAULT_MODEL, root)).toBe(5)
  })
})
