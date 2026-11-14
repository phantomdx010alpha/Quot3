import { create } from 'zustand'
import type { SeatView } from '@shared/master/schemas'
import { capMessage, capReached, confirmReady, seatActions, validateSeatLabel, type SeatActionKind } from '@shared/master/seatsView'

/**
 * Phase 265 - Settings > Company seats, seat 1 only: the seat list and "Add seat" (API_CONTRACTS.md M24-K). Main owns the truth (the master
 * enforces seat 1 and the cap of 15); this mirrors it. Seat codes live only in this store's memory (the master sends them to seat 1 only).
 */
type Fail = { message: string }
type Res<T> = { ok: true; data: T } | { ok: false; error: Fail }
export interface SeatCompany { id: string; label: string; maxSeats: number; status: string }
export interface MasterSeatsBridge {
  seatList(): Promise<Res<{ company: SeatCompany; seats: SeatView[] }>>
  seatCreate(input: { label: string }): Promise<Res<SeatView>>
  seatReset(input: { seatNo: number }): Promise<Res<SeatView>>
  seatRevoke(input: { seatNo: number }): Promise<Res<SeatView>>
  seatRename(input: { seatNo: number; label: string }): Promise<Res<SeatView>>
  seatRegen(input: { seatNo: number }): Promise<Res<SeatView>>
}
type Win = { quot3?: { master?: MasterSeatsBridge } }
const bridge = (): MasterSeatsBridge | undefined => (window as unknown as Win).quot3?.master

const NO_BRIDGE = 'Company seats are not available (no connection to the app).'
const SOMETHING = 'Something went wrong. Try again.'

export interface MasterSeatsState {
  company: SeatCompany | null
  seats: SeatView[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  busy: boolean
  error: string
  addLabel: string
  /** The code of the seat just created: shown once, until dismissed. */
  newCode: { no: number; label: string; code: string } | null
  shown: Record<number, boolean>
  /** Phase 266: the action waiting for its confirmation, the typed word (delete), the new name (rename) and the seat whose Price List rights are open. */
  pending: { kind: SeatActionKind; no: number } | null
  typed: string
  renameLabel: string
  rightsFor: number | null
  done: string
  load: () => Promise<void>
  setAddLabel: (v: string) => void
  add: () => Promise<boolean>
  toggleShow: (no: number) => void
  dismissNewCode: () => void
  ask: (kind: SeatActionKind, no: number) => void
  cancel: () => void
  setTyped: (v: string) => void
  setRenameLabel: (v: string) => void
  confirm: () => Promise<boolean>
  openRights: (no: number | null) => void
  clear: () => void
}

const EMPTY = { company: null, seats: [] as SeatView[], status: 'idle' as const, busy: false, error: '', addLabel: '', newCode: null, shown: {} as Record<number, boolean>, pending: null, typed: '', renameLabel: '', rightsFor: null as number | null, done: '' }

export const useMasterSeatsStore = create<MasterSeatsState>((set, get) => ({
  ...EMPTY,
  async load() {
    const b = bridge()
    if (!b) { set({ status: 'error', error: NO_BRIDGE }); return }
    set({ status: 'loading', error: '' })
    try {
      const r = await b.seatList()
      if (r.ok) set({ company: r.data.company, seats: [...r.data.seats].sort((a, c) => a.no - c.no), status: 'ready' })
      else set({ status: 'error', error: r.error.message })
    } catch { set({ status: 'error', error: SOMETHING }) }
  },
  setAddLabel: (v) => set({ addLabel: v, error: '' }),
  async add() {
    const b = bridge()
    const { addLabel, seats, company, busy } = get()
    if (busy) return false
    const bad = validateSeatLabel(addLabel)
    if (bad) { set({ error: bad }); return false }
    if (capReached(seats.length, company?.maxSeats ?? 15)) { set({ error: capMessage(company?.maxSeats ?? 15) }); return false }
    if (!b) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '' })
    try {
      const r = await b.seatCreate({ label: addLabel.trim() })
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      set({ busy: false, addLabel: '', newCode: r.data.code ? { no: r.data.no, label: r.data.label, code: r.data.code } : null })
      await get().load()
      return true
    } catch { set({ busy: false, error: SOMETHING }); return false }
  },
  toggleShow: (no) => set((s) => ({ shown: { ...s.shown, [no]: !s.shown[no] } })),
  dismissNewCode: () => set({ newCode: null }),
  ask(kind, no) {
    const seat = get().seats.find((x) => x.no === no)
    if (!seat || get().busy) return
    const allowed = seatActions(seat)
    if (!allowed[kind]) { set({ error: kind === 'regen' && seat.legacy ? 'This seat has no code yet. Reset it first to make one.' : 'That is not allowed for this seat.' }); return }
    set({ pending: { kind, no }, typed: '', renameLabel: kind === 'rename' ? seat.label : '', error: '', done: '' })
  },
  cancel: () => set({ pending: null, typed: '', renameLabel: '', error: '' }),
  setTyped: (v) => set({ typed: v, error: '' }),
  setRenameLabel: (v) => set({ renameLabel: v, error: '' }),
  openRights: (no) => set({ rightsFor: no }),
  async confirm() {
    const b = bridge()
    const { pending, typed, renameLabel, seats, busy } = get()
    if (!pending || busy) return false
    const seat = seats.find((x) => x.no === pending.no)
    if (!seat || !seatActions(seat)[pending.kind]) { set({ error: 'That is not allowed for this seat.' }); return false }
    if (!confirmReady(pending.kind, typed)) { set({ error: 'Type DELETE in capital letters to confirm.' }); return false }
    if (pending.kind === 'rename') {
      const bad = validateSeatLabel(renameLabel)
      if (bad) { set({ error: bad }); return false }
    }
    if (!b) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '' })
    try {
      const k = pending.kind
      const r = k === 'reset' ? await b.seatReset({ seatNo: seat.no })
        : k === 'delete' ? await b.seatRevoke({ seatNo: seat.no })
        : k === 'regen' ? await b.seatRegen({ seatNo: seat.no })
        : await b.seatRename({ seatNo: seat.no, label: renameLabel.trim() })
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      const code = k === 'reset' || k === 'regen' ? r.data.code : null
      const done = k === 'reset' ? `Seat ${seat.no} was reset. Everyone on it will reconnect by themselves.`
        : k === 'delete' ? `Seat ${seat.no} was deleted.`
        : k === 'regen' ? `Seat ${seat.no} has a new code. The old code no longer works.`
        : `Seat ${seat.no} is now called ${renameLabel.trim()}.`
      set({ busy: false, pending: null, typed: '', renameLabel: '', done, rightsFor: k === 'delete' && get().rightsFor === seat.no ? null : get().rightsFor,
        newCode: code ? { no: seat.no, label: r.data.label, code } : get().newCode })
      await get().load()
      return true
    } catch { set({ busy: false, error: SOMETHING }); return false }
  },
  clear: () => set({ ...EMPTY })
}))
