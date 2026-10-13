import { describe, expect, it } from 'vitest'
import { CLOCK_WARN_MS, correctedEditedAt, explainPair, isClockSkewLarge, offsetFromServerTime, planCounts, planSync, resolveConflict, type LocalEntry, type RemoteEntry } from '../diff'
import { encodeRecord, hashPayload } from '../codecV2'

const L = (recId: string, hash: string, baseVersion?: number, baseHash?: string | null): LocalEntry => ({ recId, hash, ...(baseVersion !== undefined ? { baseVersion } : {}), ...(baseHash !== undefined ? { baseHash } : {}) })
const R = (recId: string, payloadHash: string, version = 1, serverSeq = 1, deleted = false): RemoteEntry => ({ recId, payloadHash, version, serverSeq, deleted })

describe('planSync - the table of spec section 7', () => {
  it('same id, same hash -> skip, carrying the server version for base_version', () => {
    const p = planSync([L('a', 'h')], [R('a', 'h', 4, 40)])
    expect(p).toEqual({ skip: [{ recId: 'a', version: 4, hash: 'h', serverSeq: 40 }], upload: [], download: [], conflict: [] })
  })
  it('only local -> upload with base 0; only server -> download', () => {
    const p = planSync([L('a', 'h')], [R('b', 'x', 2, 9, true)])
    expect(p.upload).toEqual([{ recId: 'a', hash: 'h', baseVersion: 0 }])
    expect(p.download).toEqual([{ recId: 'b', version: 2, hash: 'x', serverSeq: 9, deleted: true }])
  })
  it('differ, local unchanged since base -> download', () => {
    const p = planSync([L('a', 'old', 3, 'old')], [R('a', 'new', 5)])
    expect(p.download).toHaveLength(1)
    expect(explainPair(L('a', 'old', 3, 'old'), R('a', 'new', 5))).toBe('local_unchanged')
  })
  it('differ, server still at local base version -> upload with that base', () => {
    const p = planSync([L('a', 'mine', 3, 'old')], [R('a', 'old', 3)])
    expect(p.upload).toEqual([{ recId: 'a', hash: 'mine', baseVersion: 3 }])
  })
  it('differ, both changed -> conflict', () => {
    const p = planSync([L('a', 'mine', 3, 'old')], [R('a', 'theirs', 5)])
    expect(p.conflict).toEqual([{ recId: 'a', localHash: 'mine', remoteHash: 'theirs', remoteVersion: 5, baseVersion: 3, serverSeq: 1 }])
  })
  it('differ, no base known -> conflict (never a silent overwrite either way)', () => {
    for (const l of [L('a', 'mine'), L('a', 'mine', 0, null), L('a', 'mine', 2, ''), L('a', 'mine', 2, null)]) {
      expect(planSync([l], [R('a', 'theirs', 5)]).conflict).toHaveLength(1)
    }
    expect(explainPair(L('a', 'mine'), R('a', 'theirs'))).toBe('no_base')
    expect(explainPair(L('a', 'mine', 3, 'old'), R('a', 'theirs', 5))).toBe('both_changed')
  })
  it('a tombstone is content: deleted here and live there differ; the same tombstone on both sides is skipped', () => {
    expect(planSync([L('a', 'h-deleted', 2, 'h-live')], [R('a', 'h-live', 2)]).upload).toHaveLength(1)
    expect(planSync([L('a', 'h-deleted')], [R('a', 'h-deleted', 3, 1, true)]).skip).toHaveLength(1)
  })
  it('every record lands in exactly one bucket; output is deterministic', () => {
    const local = [L('a', '1'), L('b', '2'), L('c', '3', 1, '3'), L('d', '4', 1, 'z')]
    const remote = [R('a', '1'), R('c', 'c2', 2), R('d', 'd2', 2), R('e', '5')]
    const p = planSync(local, remote)
    expect(planCounts(p)).toEqual({ skip: 1, upload: 1, download: 2, conflict: 1, total: 5 })
    expect(planSync(local, remote)).toEqual(p)
    expect(p.download.map((d) => d.recId)).toEqual(['c', 'e'])
  })
  it('the codec hash feeds it: same content on two computers is skipped even when revision / updatedAt differ', () => {
    const mk = (revision: number, updatedAt: string) => encodeRecord({
      kind: 'party', recId: 'p1', deleted: false, editedAt: updatedAt, appVer: '1',
      data: { party: { id: 'p1', name: 'Ruby', nameNorm: 'ruby', phone: null, address: null, transport: null, createdAt: 'c', updatedAt, deletedAt: null, mergedInto: null, revision } }
    })
    const a = mk(1, '2026-10-01T00:00:00Z'), b = mk(9, '2026-10-09T00:00:00Z')
    expect(hashPayload('party', a.payload)).toBe(a.payloadHash)
    expect(a.payloadHash).not.toBe(b.payloadHash) // the extra field is content here; same-shape records below
    const c = mk(1, '2026-10-09T00:00:00Z')
    expect(planSync([L('p1', a.payloadHash)], [R('p1', c.payloadHash)]).skip).toHaveLength(1)
  })
})

describe("the owner's real shapes (counts only, invented hashes)", () => {
  it('1 927 identical bills all skip, 761 only-local upload, 40 same-id-different-content conflict, 12 893 customers plan in linear time', () => {
    const local: LocalEntry[] = [], remote: RemoteEntry[] = []
    for (let i = 0; i < 1927; i++) { local.push(L(`same${i}`, `h${i}`)); remote.push(R(`same${i}`, `h${i}`, 1, i + 1)) }
    for (let i = 0; i < 761; i++) local.push(L(`mine${i}`, `m${i}`))
    for (let i = 0; i < 40; i++) { local.push(L(`diff${i}`, `a${i}`)); remote.push(R(`diff${i}`, `b${i}`, 2)) }
    for (let i = 0; i < 12_893; i++) local.push(L(`cust${i}`, `c${i}`))
    const t = Date.now()
    const p = planSync(local, remote)
    expect(Date.now() - t).toBeLessThan(500)
    expect(planCounts(p)).toMatchObject({ skip: 1927, upload: 761 + 12_893, conflict: 40, download: 0 })
  })
})

describe('convergence (property test)', () => {
  // A tiny two-sided model: records are {hash, editedAt, branch}; the server holds version + hash.
  function rng(seed: number): () => number { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000) }
  it('plan, then apply on both sides: every record ends identical, none is lost', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      type Rec = { hash: string; at: number; branch: string }
      const local = new Map<string, Rec & { baseV: number; baseH: string | null }>()
      const server = new Map<string, Rec & { version: number }>()
      for (let i = 0; i < 40; i++) {
        const id = `r${i}`, kind = Math.floor(r() * 7)
        const base: Rec = { hash: `${id}-v0`, at: 1000 + i, branch: 'A' }
        const mine: Rec = { hash: `${id}-mine${seed}`, at: 2000 + Math.floor(r() * 50), branch: 'A' }
        const theirs: Rec = { hash: `${id}-theirs${seed}`, at: 2000 + Math.floor(r() * 50), branch: 'B' }
        if (kind === 0) local.set(id, { ...mine, baseV: 0, baseH: null })
        else if (kind === 1) server.set(id, { ...theirs, version: 3 })
        else if (kind === 2) { local.set(id, { ...base, baseV: 2, baseH: base.hash }); server.set(id, { ...base, version: 2 }) }
        else if (kind === 3) { local.set(id, { ...base, baseV: 2, baseH: base.hash }); server.set(id, { ...theirs, version: 4 }) }
        else if (kind === 4) { local.set(id, { ...mine, baseV: 2, baseH: base.hash }); server.set(id, { ...base, version: 2 }) }
        else if (kind === 5) { local.set(id, { ...mine, baseV: 2, baseH: base.hash }); server.set(id, { ...theirs, version: 4 }) }
        else { local.set(id, { ...mine, baseV: 0, baseH: null }); server.set(id, { ...theirs, version: 4 }) }
      }
      const before = new Set([...local.keys(), ...server.keys()])
      const plan = planSync([...local].map(([recId, v]) => L(recId, v.hash, v.baseV, v.baseH)), [...server].map(([recId, v]) => R(recId, v.hash, v.version)))
      for (const u of plan.upload) { const l = local.get(u.recId)!; server.set(u.recId, { hash: l.hash, at: l.at, branch: l.branch, version: (server.get(u.recId)?.version ?? 0) + 1 }) }
      for (const d of plan.download) { const s = server.get(d.recId)!; local.set(d.recId, { hash: s.hash, at: s.at, branch: s.branch, baseV: s.version, baseH: s.hash }) }
      for (const c of plan.conflict) {
        const l = local.get(c.recId)!, s = server.get(c.recId)!
        if (resolveConflict({ editedAt: new Date(l.at).toISOString(), branchId: l.branch }, { editedAt: new Date(s.at).toISOString(), branchId: s.branch }) === 'a') server.set(c.recId, { hash: l.hash, at: l.at, branch: l.branch, version: s.version + 1 })
        else local.set(c.recId, { hash: s.hash, at: s.at, branch: s.branch, baseV: s.version, baseH: s.hash })
      }
      expect(new Set([...local.keys(), ...server.keys()])).toEqual(before)
      expect(local.size).toBe(server.size)
      for (const [id, l] of local) expect(l.hash, `seed ${seed} ${id}`).toBe(server.get(id)!.hash)
    }
  })
})

describe('resolveConflict', () => {
  it('later corrected edited_at wins; tie -> greater branch id; deterministic; bad time loses', () => {
    expect(resolveConflict({ editedAt: '2026-10-12T10:00:01Z', branchId: 'a' }, { editedAt: '2026-10-12T10:00:00Z', branchId: 'z' })).toBe('a')
    expect(resolveConflict({ editedAt: '2026-10-12T10:00:00Z', branchId: 'a' }, { editedAt: '2026-10-12T10:00:05Z', branchId: 'z' })).toBe('b')
    expect(resolveConflict({ editedAt: '2026-10-12T10:00:00Z', branchId: 'a' }, { editedAt: '2026-10-12T10:00:00Z', branchId: 'b' })).toBe('b')
    expect(resolveConflict({ editedAt: '2026-10-12T10:00:00Z', branchId: 'b' }, { editedAt: '2026-10-12T10:00:00Z', branchId: 'a' })).toBe('a')
    expect(resolveConflict({ editedAt: 'garbage', branchId: 'z' }, { editedAt: '2026-10-12T10:00:00Z', branchId: 'a' })).toBe('b')
    expect(resolveConflict({ editedAt: '2026-10-12T10:00:00Z', branchId: 'a' }, { editedAt: '2026-10-12T10:00:00Z', branchId: 'a' })).toBe('a')
  })
})

describe('clock offset', () => {
  it('offset = server time minus the round-trip midpoint; unusable input -> null', () => {
    const start = Date.parse('2026-10-12T10:00:00.000Z')
    expect(offsetFromServerTime('2026-10-12T10:00:00.500Z', start, start + 1000)).toBe(0)
    expect(offsetFromServerTime('2026-10-12T10:05:00.500Z', start, start + 1000)).toBe(300_000)
    expect(offsetFromServerTime('2026-10-12T09:59:00.500Z', start, start + 1000)).toBe(-60_000)
    expect(offsetFromServerTime('nope', start, start + 1)).toBeNull()
    expect(offsetFromServerTime('2026-10-12T10:00:00Z', start + 5, start)).toBeNull()
  })
  it('warns only above 2 minutes, either direction', () => {
    expect(CLOCK_WARN_MS).toBe(120_000)
    expect(isClockSkewLarge(120_000)).toBe(false)
    expect(isClockSkewLarge(120_001)).toBe(true)
    expect(isClockSkewLarge(-130_000)).toBe(true)
    expect(isClockSkewLarge(null)).toBe(false)
  })
  it('a wrong Windows clock does not decide a conflict once corrected', () => {
    const real = Date.parse('2026-10-12T10:00:00Z')
    const slowPc = correctedEditedAt(real + 60_000 - 600_000, 600_000) // 10 min slow, edited 1 min after `real`
    const fastPc = correctedEditedAt(real + 600_000, -600_000) // 10 min fast, edited at `real`
    expect(resolveConflict({ editedAt: slowPc, branchId: 'a' }, { editedAt: fastPc, branchId: 'b' })).toBe('a')
    expect(correctedEditedAt(real, null)).toBe('2026-10-12T10:00:00.000Z')
  })
})
