import { InboxBillView } from './InboxBillView'
import { InboxEditor } from './InboxEditor'
import { InboxHome } from './InboxHome'
import { InboxPriceList } from './InboxPriceList'
import { gatedScreen } from '../../kit/RightsGate'
import { InboxShell } from './InboxShell'
import { ProfileScreen } from '../shared/ProfileScreen'
import { PaymentsScreen } from '../shared/PaymentsScreen'
import type { BuiltLayoutDefinition } from '../types'

/** Layout C, "Bills inbox" (Phase 194). No bottom nav: Home is the bills list, Settings is a gear in the top bar. `history` shows the same list. Customers, Settings,
 *  About, Recently deleted and a customer page are the classic pages inside this shell. */
export const inboxLayout: BuiltLayoutDefinition = {
  id: 'inbox',
  Shell: InboxShell,
  screens: { home: InboxHome, history: InboxHome, billview: InboxBillView, pricelist: gatedScreen(InboxPriceList, 'seePriceList'), payments: gatedScreen(PaymentsScreen, 'seePayments'), profile: ProfileScreen },
  Editor: InboxEditor,
  navItems: [],
  reusesClassic: ['customers', 'customer', 'settings', 'about', 'trash']
}
