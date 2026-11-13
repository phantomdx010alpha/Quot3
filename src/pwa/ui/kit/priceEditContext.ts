/** Phase 246 (M23) - what the phone Price List edit controls share. Absent (null) = the screen is read only (no controls are drawn). */
import { createContext, useContext } from 'react'
import type { PhoneDb } from '../../data/db'
import type { EditResult } from '../../data/priceListEdit'
import type { PermFlags } from '../../../shared/pricelist/perms'
import type { PriceListData } from './priceListModel'

export interface PriceEditValue {
  db: PhoneDb
  data: PriceListData
  /** This seat's rights now (`rightsFor`). Every control is on or off from these, one by one. */
  flags: PermFlags
  /** False in a tab that is not the writer (another tab holds the lock). */
  writable: boolean
  now?: () => Date
  /** Runs one change, shows its plain-words result, reloads the list and kicks the push after a saved change. */
  run: (action: () => Promise<EditResult>) => Promise<EditResult>
}

export const PriceEditContext = createContext<PriceEditValue | null>(null)
export const usePriceEdit = (): PriceEditValue | null => useContext(PriceEditContext)
