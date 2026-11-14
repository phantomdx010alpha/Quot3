import { describe, expect, it } from 'vitest'
import { MASTER_FUNCTION_NAMES } from '../../../shared/master/config'
import type { MasterService } from '../../sync/master/masterService'
import { masterHandlers } from '../master'

const CHANNELS = ['master:status', 'master:link', 'master:redeem', 'master:adopt', 'master:refresh', 'master:heartbeat', 'master:seatList', 'master:seatCreate', 'master:seatReset', 'master:seatRevoke', 'master:seatRename', 'master:seatRegen', 'master:profileGet', 'master:profileSet']
function fake() {
  const calls: Array<[string, unknown]> = []
  const rec = (n: string) => async (i?: unknown) => { calls.push([n, i]); return { n } }
  const svc = { status: () => { calls.push(['status', undefined]); return { n: 'status' } }, link: rec('link'), redeem: rec('redeem'), adopt: rec('adopt'), refreshCredentials: rec('refresh'), heartbeat: rec('heartbeat'), seatList: rec('seatList'), seatCreate: rec('seatCreate'), seatReset: rec('seatReset'), seatRevoke: rec('seatRevoke'), seatRename: rec('seatRename'), seatRegen: rec('seatRegen'), profileGet: rec('profileGet'), profileSet: rec('profileSet') } as unknown as MasterService
  return { svc, calls }
}
type R = { ok: boolean; error?: { code: string } }

describe('master IPC (Phase 263)', () => {
  it('registers exactly the 14 frozen channels of API_CONTRACTS C8', () => {
    expect(Object.keys(masterHandlers(fake().svc)).sort()).toEqual([...CHANNELS].sort())
    expect(MASTER_FUNCTION_NAMES.length).toBe(13) // 13 server functions behind 14 channels (status is local)
  })
  it('routes valid input to the service and rejects bad input before the service is touched', async () => {
    const { svc, calls } = fake(); const h = masterHandlers(svc)
    const good: Record<string, unknown> = {
      'master:status': {}, 'master:adopt': {}, 'master:refresh': {}, 'master:heartbeat': {}, 'master:seatList': {}, 'master:profileGet': {},
      'master:link': { enrolToken: 'abcdefgh-token', label: 'Acme', serviceRoleKey: 'k'.repeat(30) }, 'master:redeem': { code: 'Q3C-AAAA' },
      'master:seatCreate': { label: 'Shop' }, 'master:seatReset': { seatNo: 2 }, 'master:seatRevoke': { seatNo: 2 }, 'master:seatRename': { seatNo: 2, label: 'X' }, 'master:seatRegen': { seatNo: 2 },
      'master:profileSet': { name: 'A', phone: '', address: '', logo: null, expectVersion: 1 }
    }
    for (const c of CHANNELS) expect(((await h[c]!(good[c])) as R).ok, c).toBe(true)
    expect(calls.length).toBe(14)
    calls.length = 0
    const bad: Array<[string, unknown]> = [
      ['master:status', { x: 1 }], ['master:seatCreate', { label: '' }], ['master:seatCreate', { label: 'x'.repeat(41) }], ['master:seatReset', { seatNo: 0 }], ['master:seatReset', { seatNo: 16 }],
      ['master:seatRevoke', { seatNo: 1.5 }], ['master:seatRename', { seatNo: 2 }], ['master:link', { enrolToken: 'x', label: 'A', serviceRoleKey: 'y' }], ['master:link', { enrolToken: 'abcdefgh-token', label: 'A', serviceRoleKey: 'k'.repeat(30), extra: 1 }],
      ['master:redeem', { code: 'x'.repeat(65) }], ['master:profileSet', { name: 'x'.repeat(201), phone: '', address: '' }], ['master:profileSet', { name: 'A', phone: '', address: '', logo: 5 }], ['master:adopt', null]
    ]
    for (const [c, b] of bad) { const r = (await h[c]!(b)) as R; expect(r.ok, `${c} ${JSON.stringify(b)}`).toBe(false); expect(r.error?.code).toBe('VALIDATION') }
    expect(calls).toEqual([])
  })
  it('a service AppError reaches the renderer as a failure with the code in details', async () => {
    const { AppError } = await import('../envelope')
    const svc = { seatList: async () => { throw new AppError('SYNC_OFFLINE', 'Master unreachable, try again.', { code: 'Q3M90' }) } } as unknown as MasterService
    const r = (await masterHandlers(svc)['master:seatList']!({})) as { ok: boolean; error: { code: string; message: string; details: { code: string } } }
    expect(r).toMatchObject({ ok: false, error: { code: 'SYNC_OFFLINE', message: 'Master unreachable, try again.', details: { code: 'Q3M90' } } })
  })
})
