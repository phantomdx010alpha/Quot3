import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { E5_SMALL, type ModelConfig } from '../../src/shared/ai/modelConfig'
import { fetchModel, hfUrl, pinReport, planProblems, sha256Hex, shouldSkip } from '../fetch-ai-model.mjs'

const BODY: Record<string, string> = { 'config.json': '{"a":1}', 'onnx/m.onnx': 'fake-bytes' }
const res = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: (n: string) => (n === 'x-repo-commit' ? 'c'.repeat(40) : null) }, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer })
const fakeFetch = (urls: string[]) => async (url: string) => { urls.push(url); const p = url.split('/resolve/')[1]!.split('/').slice(1).join('/'); return res(BODY[p] ?? '', p in BODY) }
const pinnedCfg = (over: Partial<ModelConfig> = {}): ModelConfig => ({ ...E5_SMALL, revision: 'a'.repeat(40), files: Object.keys(BODY).map((path) => ({ path, sha256: sha256Hex(Buffer.from(BODY[path]!)) })), ...over })
/** The real E5_SMALL is pinned since the owner's first fetch, so the "unpinned" cases use this copy with the pin removed. */
const UNPINNED_E5: ModelConfig = { ...E5_SMALL, revision: '', files: E5_SMALL.files.map((f) => ({ path: f.path, sha256: '' })) }
const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'q3ai-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('fetch-ai-model tool (fake fetch, temp folder, no network)', () => {
  it('url shape and refusal reasons', () => {
    expect(hfUrl('o/r', 'abc', 'onnx/m.onnx')).toBe('https://huggingface.co/o/r/resolve/abc/onnx/m.onnx')
    expect(planProblems(UNPINNED_E5).join(' ')).toContain('not fully pinned')
    expect(planProblems(UNPINNED_E5, { allowUnpinned: true })).toEqual([])
    expect(planProblems(E5_SMALL)).toEqual([])
    expect(planProblems({ ...E5_SMALL, licence: 'CC-BY-NC-4.0' }, { allowUnpinned: true }).join(' ')).toContain('permissive')
    expect(planProblems({ ...E5_SMALL, files: [{ path: '../x', sha256: '' }] }, { allowUnpinned: true }).join(' ')).toContain('unsafe')
  })
  it('a pinned run downloads, verifies, writes files and a manifest; a second run keeps them', async () => {
    const out = tmp(); const urls: string[] = []; const cfg = pinnedCfg()
    const r1 = await fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch(urls) })
    expect(r1.files.map((f) => f.status)).toEqual(['downloaded', 'downloaded'])
    expect(readFileSync(join(out, cfg.id, 'onnx', 'm.onnx'), 'utf8')).toBe('fake-bytes')
    expect(existsSync(join(out, cfg.id, 'model-manifest.json'))).toBe(true)
    const r2 = await fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch(urls) })
    expect(r2.files.map((f) => f.status)).toEqual(['kept', 'kept'])
    expect(urls.length).toBe(2)
  })
  it('a hash mismatch refuses and leaves no file', async () => {
    const out = tmp(); const cfg = pinnedCfg(); cfg.files = cfg.files.map((f, i) => (i === 1 ? { ...f, sha256: '0'.repeat(64) } : f))
    await expect(fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch([]) })).rejects.toThrow(/SHA-256 mismatch/)
    expect(existsSync(join(out, cfg.id, 'onnx', 'm.onnx'))).toBe(false)
    expect(existsSync(join(out, cfg.id, 'onnx', 'm.onnx.part'))).toBe(false)
  })
  it('an unpinned run needs --allow-unpinned, then reports the commit and every hash to paste', async () => {
    const out = tmp(); const cfg: ModelConfig = { ...UNPINNED_E5, files: Object.keys(BODY).map((path) => ({ path, sha256: '' })) }
    await expect(fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch([]) })).rejects.toThrow(/not fully pinned/)
    const r = await fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch([]), allowUnpinned: true })
    expect(r.revision).toBe('c'.repeat(40))
    const report = pinReport(cfg, r)
    expect(report).toContain(sha256Hex(Buffer.from('fake-bytes')))
    expect(report).toContain("revision: '" + 'c'.repeat(40) + "'")
  })
  it('a failed download throws with the file name', async () => {
    const out = tmp(); const cfg = pinnedCfg({ files: [{ path: 'missing.bin', sha256: 'd'.repeat(64) }] })
    await expect(fetchModel(cfg, { outRoot: out, fetchImpl: fakeFetch([]) })).rejects.toThrow(/missing\.bin/)
  })
  it('--skip-if-unpinned only skips an unpinned model (so a release is never blocked, and a pinned one is still fetched)', () => {
    expect(shouldSkip(UNPINNED_E5, { skipIfUnpinned: true })).toBe(true)
    expect(shouldSkip(UNPINNED_E5, { skipIfUnpinned: true, allowUnpinned: true })).toBe(false)
    expect(shouldSkip(UNPINNED_E5, {})).toBe(false)
    expect(shouldSkip(E5_SMALL, { skipIfUnpinned: true })).toBe(false)
    expect(shouldSkip(pinnedCfg(), { skipIfUnpinned: true })).toBe(false)
  })
})
