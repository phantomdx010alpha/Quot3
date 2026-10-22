import { TidyBillView } from '../tidy/TidyBillView'
import { TidyBills } from '../tidy/TidyBills'
import { GuidedEditor } from './GuidedEditor'
import { GuidedHome } from './GuidedHome'
import { GUIDED_TABS, GuidedShell } from './GuidedShell'
import { guidedInterceptBack } from './guidedStep'
import { createElement } from 'react'
import type { BuiltLayoutDefinition, ScreenProps } from '../types'

/** The Guided bill view: the Tidy bill view, but the "Saved" sheet is not shown again (the Review step already said "Saved as ..."). */
const GuidedBillView = (p: ScreenProps) => createElement(TidyBillView, { ...p, justSaved: false })

/** Layout B, "Guided flow" (Phase 193). Home, the three-step editor and the shell are new; Bills and the bill view reuse the Tidy screens (two-line rows,
 *  names wrap); Customers, Settings, About, Recently deleted and a customer page are the classic pages inside this shell. */
export const guidedLayout: BuiltLayoutDefinition = {
  id: 'guided',
  Shell: GuidedShell,
  screens: { home: GuidedHome, history: TidyBills, billview: GuidedBillView },
  Editor: GuidedEditor,
  navItems: GUIDED_TABS.map((t) => ({ route: t.route, label: t.label, Icon: t.Icon })),
  reusesClassic: ['customers', 'customer', 'settings', 'about', 'trash'],
  interceptBack: guidedInterceptBack
}
