import { useCallback, useEffect, useRef } from 'react'
import { createEmptyBill } from '@shared/billModel'
import type { Quot3Bridge } from '@shared/ipc'
import { GridStatus, BillGrid } from '../components/grid'
import { PartyBar } from '../components/create/PartyBar'
import { FormatToolbar } from '../components/create/FormatToolbar'
import { ExtraColsToolbar } from '../components/create/ExtraColsToolbar'
import { BottomBar } from '../components/create/BottomBar'
import { CalcDrawer } from '../components/create/CalcDrawer'
import { SaveFlow } from '../components/create/SaveFlow'
import { RemoteChangeBanner } from '../components/create/RemoteChangeBanner'
import { useBillStore } from '../stores/billStore'
import { useBehaviourStore } from '../stores/behaviourStore'
import { createSession, useCreateSession } from '../stores/createSession'
import { usePartyUiStore } from '../stores/partyUiStore'
import { startImagePrerender } from '../stores/imagePrerender'

/**
 * Phase 25 — first version of the Create page: party/detail bar, the grid, the toolbars and a stub bottom bar (Phase 30
 * fills it). A fresh empty bill is opened on EVERY entry (Phase 118 hard rule) unless the bill was deliberately loaded for this visit (edit / recovered draft / restored revision). Save, PO allocation,
 * the Esc guard and draft recovery arrive in Phases 27–29; the branch id is a placeholder until Phase 27/50.
 */
export default function Create(): React.JSX.Element {
  const gridHost = useRef<HTMLDivElement>(null)
  const nonce = useCreateSession((s) => s.nonce)

  useEffect(() => {
    if (useBillStore.getState().billId !== null && useBillStore.getState().billId === createSession.get()) return
    const bill = createEmptyBill({ branchId: 'local', rowCount: 0, roundOff: useBehaviourStore.getState().roundOff })
    createSession.set(bill.id)
    useBillStore.getState().loadBill(bill)
    if (nonce > 0) queueMicrotask(() => usePartyUiStore.getState().focusParty?.()) // New bill while on this page: start at Party name
    // Phase 27: take the local branch id, default format and the machine's local date from main (when the bridge exists).
    // Only applied if nothing was typed meanwhile and something actually differs (so a focused cell is not rebuilt for nothing).
    const api = (window as unknown as { quot3?: Pick<Quot3Bridge, 'bills'> }).quot3?.bills
    void api?.newDefaults().then((r) => {
      if (!r.ok) return
      const s = useBillStore.getState()
      if (s.billId !== bill.id || s.dirty) return
      const d = r.data
      if (d.branchId === s.meta.branchId && d.formatId === s.formatId && d.billDate === s.billDate) return
      s.loadBill({ ...bill, branchId: d.branchId, formatId: d.formatId, billDate: d.billDate })
    }).catch(() => undefined)
  }, [nonce])

  // Phase 71: while Create is open, an idle pause after edits pre-renders the image copy in main (best effort, silent).
  useEffect(() => startImagePrerender(), [])

  /** Transport → grid row 1 / Item Name (KB §7). Focusing the grid root activates its first cell in Append mode. */
  const toGrid = useCallback(() => { gridHost.current?.querySelector<HTMLElement>('[role=grid]')?.focus() }, [])

  return (
    <div className="q3-create">
      <RemoteChangeBanner />
      <PartyBar onLeaveToGrid={toGrid} />
      <div className="q3-create__tools">
        <FormatToolbar />
        <ExtraColsToolbar />
      </div>
      <div className="q3-create__grid" ref={gridHost}>
        <BillGrid />
      </div>
      <CalcDrawer />
      <BottomBar actions>
        <GridStatus />
      </BottomBar>
      <SaveFlow />
    </div>
  )
}
