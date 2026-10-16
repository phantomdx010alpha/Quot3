import { describe, expect, it, vi } from 'vitest'
import { themeHandlers } from '../themes'
import type { ThemeService } from '../../services/themeService'
import type { ThemeShareService } from '../../sync/themeShare'

const status = { enabled: false, available: true, shared: [], aside: [], tooNew: 0, notice: '', last: null, running: false }
const fakeShare = (): ThemeShareService => ({
  status: vi.fn(() => status), setEnabled: vi.fn(async (e: boolean) => ({ ...status, enabled: e })), runNow: vi.fn(async () => ({ sent: 1, received: 0, setAside: 0, skipped: 0 })),
  kick: vi.fn(), removeShared: vi.fn(() => status), start: vi.fn(), stop: vi.fn()
})
const h = (share?: ThemeShareService) => themeHandlers({} as ThemeService, share)

describe('themes:share* IPC (Phase 171)', () => {
  it('validates strictly: unknown keys and wrong types are refused, nothing reaches the service', async () => {
    const share = fakeShare()
    const handlers = h(share)
    expect((await handlers['themes:shareSetEnabled']!({ enabled: 'yes' }) as { ok: boolean }).ok).toBe(false)
    expect((await handlers['themes:shareSetEnabled']!({ enabled: true, extra: 1 }) as { ok: boolean }).ok).toBe(false)
    expect((await handlers['themes:shareStatus']!({ x: 1 }) as { ok: boolean }).ok).toBe(false)
    expect((await handlers['themes:shareSyncNow']!({ x: 1 }) as { ok: boolean }).ok).toBe(false)
    expect((await handlers['themes:removeShared']!({ id: '' }) as { ok: boolean }).ok).toBe(false)
    expect((await handlers['themes:removeShared']!({ id: 'a', more: 1 }) as { ok: boolean }).ok).toBe(false)
    expect(share.setEnabled).not.toHaveBeenCalled()
    expect(share.removeShared).not.toHaveBeenCalled()
  })

  it('passes valid calls through', async () => {
    const share = fakeShare()
    const handlers = h(share)
    expect(await handlers['themes:shareSetEnabled']!({ enabled: true })).toMatchObject({ ok: true, data: { enabled: true } })
    expect(await handlers['themes:shareStatus']!({})).toMatchObject({ ok: true })
    expect(await handlers['themes:shareSyncNow']!({})).toMatchObject({ ok: true, data: { run: { sent: 1 } } })
    expect(await handlers['themes:removeShared']!({ id: 'amber' })).toMatchObject({ ok: true })
    expect(share.removeShared).toHaveBeenCalledWith('amber')
  })

  it('answers with an error (not a throw) when sharing is not built in', async () => {
    expect((await h()['themes:shareStatus']!({}) as { ok: boolean }).ok).toBe(false)
  })
})
