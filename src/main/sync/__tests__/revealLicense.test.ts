import { describe, expect, it, vi } from 'vitest'
import { syncSharedHandlers } from '../../ipc/syncShared'
import { createSharedSyncService, type SharedSyncDeps } from '../sharedSyncService'

// Version 0.1.31 - the owner can read the license key stored on a signed-in computer. Fakes only: no Electron, no Supabase.
const KEY = 'Q3-ABCD-EFGH-JKLM'

function svc(creds: { license: string } | null) {
  const info = vi.fn()
  const deps = {
    activation: { credentials: () => creds, isActivated: () => creds !== null },
    branches: {}, compare: { needed: () => false, run: async () => ({}) }, engine: { start: () => undefined, stop: () => undefined, afterCompare: () => undefined },
    cutoverNeeded: () => false, log: { info, warn: vi.fn(), error: vi.fn() }
  } as unknown as SharedSyncDeps
  return { service: createSharedSyncService(deps), info }
}

describe('revealLicense', () => {
  it('returns the stored key while signed in, and never writes it to the log', () => {
    const { service, info } = svc({ license: KEY })
    expect(service.revealLicense()).toEqual({ license: KEY })
    expect(JSON.stringify(info.mock.calls)).not.toContain(KEY)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('refuses with a plain message when no login is stored', () => {
    const { service } = svc(null)
    expect(() => service.revealLicense()).toThrow(/not stored on this computer/)
  })

  it('the IPC channel answers an envelope with the key, and rejects a payload with extra fields', async () => {
    const { service } = svc({ license: KEY })
    const h = syncSharedHandlers(service)
    expect(Object.keys(h)).toContain('syncShared:revealLicense')
    const ok = (await h['syncShared:revealLicense']!({})) as { ok: boolean; data?: { license: string } }
    expect(ok.ok).toBe(true)
    expect(ok.data).toEqual({ license: KEY })
    const bad = (await h['syncShared:revealLicense']!({ other: 1 })) as { ok: boolean }
    expect(bad.ok).toBe(false)
  })

  it('the IPC channel answers a failure envelope (not a throw) when nothing is stored', async () => {
    const { service } = svc(null)
    const r = (await syncSharedHandlers(service)['syncShared:revealLicense']!({})) as { ok: boolean; error?: { message: string } }
    expect(r.ok).toBe(false)
    expect(r.error?.message).toMatch(/not stored/)
  })
})
