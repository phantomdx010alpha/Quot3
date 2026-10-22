import { TidyBillView } from './TidyBillView'
import { TidyBills } from './TidyBills'
import { TidyEditor } from './TidyEditor'
import { TidyHome } from './TidyHome'
import { TIDY_TABS, TidyShell } from './TidyShell'
import type { BuiltLayoutDefinition } from '../types'

/** Layout A, "Tidy tabs" (Phase 192). Home, Bills and the bill view are drawn here; Customers, Settings, About, Recently deleted and a customer page are the
 *  classic pages drawn by App.tsx inside this shell (restyled only by the larger tokens). */
export const tidyLayout: BuiltLayoutDefinition = {
  id: 'tidy',
  Shell: TidyShell,
  screens: { home: TidyHome, history: TidyBills, billview: TidyBillView },
  Editor: TidyEditor,
  navItems: TIDY_TABS.map((t) => ({ route: t.route, label: t.label, Icon: t.Icon })),
  reusesClassic: ['customers', 'customer', 'settings', 'about', 'trash']
}
