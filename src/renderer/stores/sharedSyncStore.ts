import { create } from 'zustand'
import type { SharedLicenseStatus } from '@shared/sync/license'
import { DEACTIVATE_WORD } from '@shared/sync/license'
import {
  branchNameKey, compareSentence, routeSharedError, sortBranches,
  type BranchRowUi, type NameState, type RoutedError, type SharedForm, type SharedSyncBridge, type SharedUiError, validateSharedForm
} from '@shared/sync/sharedUi'

/** The v2 bridge is added to `window.quot3` by Phase 140; until then it is absent and the Sync section keeps showing the v1 screen. */
type Win = { quot3?: { syncShared?: SharedSyncBridge } }
export const sharedBridge = (): SharedSyncBridge | undefined => (window as unknown as Win).quot3?.syncShared
export const hasSharedBridge = (): boolean => sharedBridge() !== undefined
const NO_BRIDGE = 'Sync is not available (no connection to the app).'
const SOMETHING = 'Something went wrong. Try again.'

/** Phase 139 - Settings > Sync v2: sign-in with this computer's login, branch name, branch list. Main owns the truth; this mirrors it. */
export interface SharedSyncState {
  status: SharedLicenseStatus | null
  branches: BranchRowUi[]
  busy: boolean
  /** A refusal not tied to a field, or a general failure. */
  error: string
  notice: string
  /** The refusal routed to a field / the takeover prompt / paused server, from the last sign-in or rename. */
  routed: RoutedError | null
  /** The live "is this name free?" state and the (normalised) name it was asked for. */
  nameState: NameState
  nameFor: string
  compareNote: string
  load: (check?: boolean) => Promise<void>
  loadBranches: () => Promise<void>
  checkName: (name: string, form?: SharedForm) => Promise<NameState>
  activate: (form: SharedForm) => Promise<boolean>
  rename: (name: string) => Promise<boolean>
  compare: () => Promise<boolean>
  deactivate: () => Promise<boolean>
  clearMessages: () => void
}

let nameSeq = 0

export const useSharedSyncStore = create<SharedSyncState>((set, get) => {
  const fail = (e: SharedUiError | undefined): void => {
    if (!e) { set({ busy: false, error: SOMETHING }); return }
    const r = routeSharedError(e)
    set({ busy: false, routed: r, error: r.field === undefined ? r.message : '' })
  }
  return {
    status: null, branches: [], busy: false, error: '', notice: '', routed: null, nameState: 'idle', nameFor: '', compareNote: '',
    clearMessages: () => set({ error: '', notice: '', routed: null, compareNote: '' }),
    async load(check = false) {
      const b = sharedBridge()
      if (!b) { set({ error: NO_BRIDGE }); return }
      try {
        const r = await b.status(check ? { check: true } : undefined)
        if (r.ok) { set({ status: r.data }); if (r.data.state === 'activated') void get().loadBranches() } else set({ error: r.error.message })
      } catch { set({ error: SOMETHING }) }
    },
    async loadBranches() {
      const b = sharedBridge()
      if (!b) return
      try {
        const r = await b.listBranches()
        if (r.ok) set({ branches: sortBranches(r.data) })
      } catch { /* the list keeps showing what it had */ }
    },
    async checkName(name, form) {
      const b = sharedBridge()
      const key = branchNameKey(name)
      if (!b || key === '') { nameSeq++; set({ nameState: 'idle', nameFor: '' }); return 'idle' }
      // The name already held by this computer is "free" for itself; the server knows that too, so the call is only skipped when it is the same.
      const mine = get().status?.registered?.name
      if (mine !== undefined && branchNameKey(mine) === key) { nameSeq++; set({ nameState: 'free', nameFor: key }); return 'free' }
      let signIn: Parameters<SharedSyncBridge['branchNameFree']>[0]['signIn']
      if (get().status?.state !== 'activated') {
        if (!form) { set({ nameState: 'unknown', nameFor: key }); return 'unknown' }
        const v = validateSharedForm({ ...form, branchName: name })
        const input = v.ok ? v.input : undefined
        // Without a valid server address, key, e-mail and password the name cannot be asked yet; it is checked again when signing in.
        const needed = ['supabaseUrl', 'anonKey', 'licenseKey', 'email', 'password'] as const
        if (!input) {
          const errs = v.ok ? {} : v.errors
          if (needed.some((f) => errs[f] !== undefined)) { nameSeq++; set({ nameState: 'idle', nameFor: key }); return 'idle' }
        }
        const src = input ?? { supabaseUrl: form.supabaseUrl, anonKey: form.anonKey, licenseKey: form.licenseKey, email: form.email, password: form.password }
        signIn = { supabaseUrl: src.supabaseUrl, anonKey: src.anonKey, licenseKey: src.licenseKey, email: src.email, password: src.password }
      }
      const mySeq = ++nameSeq
      set({ nameState: 'checking', nameFor: key })
      let state: NameState = 'unknown'
      try {
        const r = await b.branchNameFree({ name, ...(signIn ? { signIn } : {}) })
        if (r.ok) state = r.data.free ? 'free' : 'taken'
      } catch { state = 'unknown' }
      if (mySeq !== nameSeq) return state // a newer check owns the field now
      set({ nameState: state })
      return state
    },
    async activate(form) {
      const b = sharedBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      const v = validateSharedForm(form)
      if (!v.ok) { set({ routed: null, error: 'Fix the highlighted fields first.' }); return false }
      set({ busy: true, error: '', notice: '', routed: null })
      try {
        const r = await b.activate(v.input)
        if (!r.ok) { fail(r.error); return false }
        set({ busy: false, status: r.data, notice: 'Signed in. This computer is now a branch of the shared notebook.', nameState: 'idle' })
        void get().loadBranches()
        return true
      } catch { set({ busy: false, error: SOMETHING }); return false }
    },
    async rename(name) {
      const b = sharedBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', notice: '', routed: null })
      try {
        const r = await b.renameBranch({ name })
        if (!r.ok) { fail(r.error); return false }
        set({ busy: false, status: r.data, notice: 'Branch name changed.', nameState: 'idle' })
        void get().loadBranches()
        return true
      } catch { set({ busy: false, error: SOMETHING }); return false }
    },
    async compare() {
      const b = sharedBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', notice: '', compareNote: '' })
      try {
        const r = await b.compare()
        if (!r.ok) { fail(r.error); return false }
        set({ busy: false, compareNote: compareSentence(r.data) })
        return r.data.state === 'done'
      } catch { set({ busy: false, error: SOMETHING }); return false }
    },
    async deactivate() {
      const b = sharedBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', notice: '', routed: null })
      try {
        const r = await b.deactivate({ confirm: DEACTIVATE_WORD })
        if (!r.ok) { fail(r.error); return false }
        set({ busy: false, status: r.data, branches: [], notice: 'Signed out on this computer. Your bills were not touched.' })
        return true
      } catch { set({ busy: false, error: SOMETHING }); return false }
    }
  }
})

/** Palette actions (Settings > Sync is already open when they run). Each answers whether it did something. */
export async function compareAndSyncNow(): Promise<boolean> {
  if (!hasSharedBridge()) return false
  return useSharedSyncStore.getState().compare()
}
/** Asks the Sync section to put the cursor in the branch-name box. */
export const SYNC_FOCUS_NAME_EVENT = 'quot3:sync-focus-name'
export function focusBranchName(): void { window.dispatchEvent(new Event(SYNC_FOCUS_NAME_EVENT)) }
