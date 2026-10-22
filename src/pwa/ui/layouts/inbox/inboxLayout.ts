import { InboxBillView } from './InboxBillView'
import { InboxEditor } from './InboxEditor'
import { InboxHome } from './InboxHome'
import { InboxShell } from './InboxShell'
import type { BuiltLayoutDefinition } from '../types'

/** Layout C, "Bills inbox" (Phase 194). No bottom nav: Home is the bills list, Settings is a gear in the top bar. `history` shows the same list. Customers, Settings,
 *  About, Recently deleted and a customer page are the classic pages inside this shell. */
export const inboxLayout: BuiltLayoutDefinition = {
  id: 'inbox',
  Shell: InboxShell,
  screens: { home: InboxHome, history: InboxHome, billview: InboxBillView },
  Editor: InboxEditor,
  navItems: [],
  reusesClassic: ['customers', 'customer', 'settings', 'about', 'trash']
}
