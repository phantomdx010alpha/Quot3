// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MasterStatus } from '@shared/master/clientTypes'
import { useMasterLinkStore } from '../masterLinkStore'

const KEY = 'invented-service-role-key-' + 'k'.repeat(30)
const TOKEN = 'invented-enrol-token-123'
const ST = (o: Partial<MasterStatus> = {}): MasterStatus => ({ configured: true, linked: false, companyLabel: null, seatNo: null, seatLabel: null, isAdmin: false, profileVersion: null, lastError: '', ...o })
const LINKED = ST({ linked: true, companyLabel: 'Acme', seatNo: 1, seatLabel: 'Seat 1', isAdmin: true })

let link: ReturnType<typeof vi.fn>
const install = (): void => {
  ;(window as unknown as { quot3: unknown }).quot3 = {
    master: { status: vi.fn(async () => ({ ok: true, data: ST() })), link },
    syncShared: { status: vi.fn(async () => ({ ok: true, data: { state: 'activated', seatNo: 1 } })) }
  }
}
const fill = (): void => { const s = useMasterLinkStore.getState(); s.setField('enrolToken', TOKEN); s.setField('label', 'Acme'); s.setField('serviceRoleKey', KEY) }
const dump = (): string => JSON.stringify(useMasterLinkStore.getState())

beforeEach(() => { link = vi.fn(); install(); useMasterLinkStore.setState({ status: null, sharedActive: false, sharedSeatNo: null, step: 'idle', enrolToken: '', label: '', serviceRoleKey: '', fieldErrors: {}, message: '' }) })
afterEach(() => { delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 264 master link store', () => {
  it('load reads the master status and the shared sync seat', async () => {
    await useMasterLinkStore.getState().load()
    const s = useMasterLinkStore.getState()
    expect(s.status?.configured).toBe(true)
    expect(s.sharedActive).toBe(true)
    expect(s.sharedSeatNo).toBe(1)
  })
  it('an invalid form shows field errors and makes no call', async () => {
    useMasterLinkStore.getState().openWizard()
    expect(await useMasterLinkStore.getState().submit()).toBe(false)
    expect(link).not.toHaveBeenCalled()
    expect(Object.keys(useMasterLinkStore.getState().fieldErrors)).toHaveLength(3)
  })
  it('SUCCESS: sends the key once, and the key is absent from state afterwards (and so is the token)', async () => {
    let during = ''
    link.mockImplementation(async () => { during = dump(); return { ok: true, data: LINKED } })
    useMasterLinkStore.getState().openWizard(); fill()
    expect(await useMasterLinkStore.getState().submit()).toBe(true)
    expect(link).toHaveBeenCalledWith({ enrolToken: TOKEN, label: 'Acme', serviceRoleKey: KEY })
    expect(during).not.toContain(KEY)
    const s = useMasterLinkStore.getState()
    expect(dump()).not.toContain(KEY)
    expect(dump()).not.toContain(TOKEN)
    expect(s.step).toBe('done')
    expect(s.status?.linked).toBe(true)
    expect(s.message).toBe('Linked. This PC is seat 1 of Acme.')
  })
  it('FAILURE: the plain-words error shows, the key is absent from state, the token is kept for a retry', async () => {
    link.mockResolvedValue({ ok: false, error: { message: 'That enrol token has already been used.' } })
    useMasterLinkStore.getState().openWizard(); fill()
    expect(await useMasterLinkStore.getState().submit()).toBe(false)
    const s = useMasterLinkStore.getState()
    expect(dump()).not.toContain(KEY)
    expect(s.step).toBe('failed')
    expect(s.message).toBe('That enrol token has already been used.')
    expect(s.enrolToken).toBe(TOKEN)
    expect(s.serviceRoleKey).toBe('')
  })
  it('a thrown bridge call also leaves no key behind and says something generic', async () => {
    link.mockRejectedValue(new Error('boom ' + KEY))
    useMasterLinkStore.getState().openWizard(); fill()
    expect(await useMasterLinkStore.getState().submit()).toBe(false)
    expect(dump()).not.toContain(KEY)
    expect(useMasterLinkStore.getState().message).toBe('Something went wrong. Try again.')
  })
  it('Cancel clears every field', () => {
    useMasterLinkStore.getState().openWizard(); fill()
    useMasterLinkStore.getState().closeWizard()
    expect(dump()).not.toContain(KEY)
    expect(useMasterLinkStore.getState().step).toBe('idle')
  })
})
