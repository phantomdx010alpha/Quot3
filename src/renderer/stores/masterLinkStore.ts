import { create } from 'zustand'
import type { MasterStatus } from '@shared/master/clientTypes'
import { EMPTY_LINK_FORM, validateLinkForm, type LinkField, type LinkFieldErrors } from '@shared/master/linkForm'

/**
 * Phase 264 - Settings > Company seats: the master status line and the seat-1 "Link to master" wizard (API_CONTRACTS.md M24-J).
 * The service_role key is typed into `serviceRoleKey`, and taken OUT of state before the call starts; so it is absent from state while the
 * call runs and after success AND failure. It is never put in a message. Main owns the truth; this only mirrors it.
 */
type Fail = { message: string }
type Res<T> = { ok: true; data: T } | { ok: false; error: Fail }
export interface MasterLinkBridge { status(): Promise<Res<MasterStatus>>; link(input: { enrolToken: string; label: string; serviceRoleKey: string }): Promise<Res<MasterStatus>> }
type SharedStatusBridge = { status(): Promise<Res<{ state: 'not_activated' | 'activated'; seatNo: number | null }>> }
type Win = { quot3?: { master?: MasterLinkBridge; syncShared?: SharedStatusBridge } }
const win = (): Win['quot3'] => (window as unknown as Win).quot3

const NO_BRIDGE = 'Company seats are not available (no connection to the app).'
const SOMETHING = 'Something went wrong. Try again.'

export type LinkStep = 'idle' | 'form' | 'working' | 'done' | 'failed'

export interface MasterLinkState {
  status: MasterStatus | null
  sharedActive: boolean
  sharedSeatNo: number | null
  step: LinkStep
  enrolToken: string
  label: string
  serviceRoleKey: string
  fieldErrors: LinkFieldErrors
  /** Plain-words result of the last load / link. */
  message: string
  load: () => Promise<void>
  openWizard: () => void
  closeWizard: () => void
  setField: (field: LinkField, value: string) => void
  submit: () => Promise<boolean>
}

const INITIAL = { status: null, sharedActive: false, sharedSeatNo: null, step: 'idle' as LinkStep, ...EMPTY_LINK_FORM, fieldErrors: {} as LinkFieldErrors, message: '' }

export const useMasterLinkStore = create<MasterLinkState>((set, get) => ({
  ...INITIAL,
  async load() {
    const q = win()
    if (!q?.master) { set({ message: NO_BRIDGE }); return }
    try {
      const r = await q.master.status()
      if (r.ok) set({ status: r.data }); else set({ message: r.error.message })
    } catch { set({ message: SOMETHING }) }
    try {
      const s = await q.syncShared?.status()
      if (s && s.ok) set({ sharedActive: s.data.state === 'activated', sharedSeatNo: s.data.seatNo })
    } catch { /* the status line still works without it; the wizard just stays hidden */ }
  },
  openWizard: () => set({ step: 'form', fieldErrors: {}, message: '' }),
  closeWizard: () => set({ step: 'idle', ...EMPTY_LINK_FORM, fieldErrors: {} }),
  setField: (field, value) => set((s) => ({ [field]: value, fieldErrors: { ...s.fieldErrors, [field]: undefined } }) as Partial<MasterLinkState>),
  async submit() {
    const q = win()
    const { enrolToken, label, serviceRoleKey } = get()
    const errors = validateLinkForm({ enrolToken, label, serviceRoleKey })
    if (Object.keys(errors).length > 0) { set({ fieldErrors: errors }); return false }
    if (!q?.master) { set({ serviceRoleKey: '', step: 'failed', message: NO_BRIDGE }); return false }
    // The key leaves state NOW; the local copy lives only for this one call.
    set({ serviceRoleKey: '', step: 'working', fieldErrors: {}, message: '' })
    try {
      const r = await q.master.link({ enrolToken: enrolToken.trim(), label: label.trim(), serviceRoleKey: serviceRoleKey.trim() })
      if (r.ok) {
        set({ status: r.data, step: 'done', enrolToken: '', serviceRoleKey: '', message: r.data.companyLabel ? `Linked. This PC is seat 1 of ${r.data.companyLabel}.` : 'Linked. This PC is seat 1.' })
        return true
      }
      set({ step: 'failed', serviceRoleKey: '', message: r.error.message })
      return false
    } catch {
      set({ step: 'failed', serviceRoleKey: '', message: SOMETHING })
      return false
    }
  }
}))
