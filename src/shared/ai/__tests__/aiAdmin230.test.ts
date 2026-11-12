import { describe, expect, it } from 'vitest'
import { AI_PRIVACY_LINE, aiDiagnosticsLine, describeAiStatus, describeIndexProgress, formatBytes, indexButtons } from '../aiAdmin'
import type { AiStatus } from '../aiStatus'
import { buildDiagnosticsText } from '../../diagnostics'
import { ACTIONS } from '../../shortcuts'

const st = (o: Partial<AiStatus> = {}): AiStatus => ({ state: 'ready', modelId: 'm1', dim: 384, loaded: true, embedded: 5, ...o })

describe('Phase 230 - Settings > AI text (pure)', () => {
  it('says Off whatever the model state is when the master switch is off', () => {
    expect(describeAiStatus(false, st({ state: 'error', reason: 'boom' })).label).toBe('Off')
  })
  it('gives the plain reason for notInstalled and error', () => {
    expect(describeAiStatus(true, st({ state: 'notInstalled', reason: 'The AI model files are not installed.' }))).toMatchObject({ label: 'Not installed', detail: 'The AI model files are not installed.' })
    expect(describeAiStatus(true, st({ state: 'error', reason: 'the model could not be loaded: x' })).detail).toContain('could not be loaded')
    expect(describeAiStatus(true, st({ state: 'loading' })).label).toBe('Loading')
    expect(describeAiStatus(true, st({ loaded: false })).detail).toContain('starts when it is first needed')
  })
  it('formats the model size', () => {
    expect(formatBytes(undefined)).toBe('unknown size')
    expect(formatBytes(120 * 1024 * 1024)).toBe('120.0 MB')
    expect(formatBytes(2048)).toBe('2 KB')
  })
  it('describes progress and offers the right buttons', () => {
    expect(describeIndexProgress(false, { state: 'running', total: 4, done: 1, pending: 3 })).toBe('Indexing is off.')
    expect(describeIndexProgress(true, { state: 'running', total: 10, done: 4, pending: 6 })).toBe('Indexing: 4 of 10 item names.')
    expect(describeIndexProgress(true, { state: 'paused', total: 10, done: 4, pending: 6 })).toContain('6 left')
    expect(describeIndexProgress(true, { state: 'error', total: 1, done: 0, pending: 1, lastError: 'Embedding failed (error).' })).toContain('Resume')
    expect(describeIndexProgress(true, { state: 'idle', total: 0, done: 0, pending: 0 })).toContain('Nothing to index')
    expect(indexButtons(true, { state: 'running', total: 1, done: 0, pending: 1 })).toEqual({ pause: true, resume: false })
    expect(indexButtons(true, { state: 'paused', total: 1, done: 0, pending: 1 })).toEqual({ pause: false, resume: true })
    expect(indexButtons(true, { state: 'error', total: 1, done: 0, pending: 1 })).toEqual({ pause: false, resume: true })
    expect(indexButtons(false, { state: 'paused', total: 1, done: 0, pending: 1 })).toEqual({ pause: false, resume: false })
  })
  it('the diagnostics line has model id, dim, vectors and last embed ms; and goes into Copy diagnostics', () => {
    const line = aiDiagnosticsLine(true, { status: st({ lastEmbedMs: 12.4 }), vectors: 99 })
    expect(line).toBe('AI: on, ready, model m1, dim 384, vectors 99, last embed 12 ms')
    expect(aiDiagnosticsLine(false, { status: st(), vectors: 0 })).toContain('AI: off')
    const base = { now: new Date('2026-11-12T00:00:00Z'), app: { version: '0.1.51', electron: '1', chrome: '1', node: '22', dev: false }, os: { platform: 'win32', release: '10', arch: 'x64' }, db: { schemaVersion: 10, writable: true, counts: {} }, sync: { activated: false, mode: 'idle' }, lastCrash: null, logLines: [] }
    expect(buildDiagnosticsText({ ...base, ai: line })).toContain(line)
    expect(buildDiagnosticsText(base)).not.toContain('AI:')
  })
  it('has the privacy line and the palette action', () => {
    expect(AI_PRIVACY_LINE).toBe('Runs on this PC. Nothing leaves it.')
    expect(ACTIONS.some((a) => a.id === 'settings.ai')).toBe(true)
  })
})
