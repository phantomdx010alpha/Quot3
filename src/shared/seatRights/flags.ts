/**
 * Phase 286 (M25) - per-phone rights, the pure rules (API_CONTRACTS.md M25-4). PHONES ONLY (owner decision D4): the desktop is never restricted.
 * The flags hide and block things IN THE APP. They are not a security boundary: the records still sit on the phone and the shared image / PDF
 * still carry customer address and contact (D6). The words "secure" and "leak-proof" are never used.
 * Presets Staff / Viewer are [A] proposals (M25-12 #8); the owner can change any seat's flags in the desktop panel.
 */
export const SEAT_RIGHT_FLAGS = [
  'seeAddress', 'seeContact', 'seePriceList', 'seeSales', 'seePayments', 'shareBills', 'exportData', 'deleteBills', 'editOldBills', 'editCustomers', 'editPayments'
] as const
export type SeatFlag = (typeof SEAT_RIGHT_FLAGS)[number]
export type SeatFlags = Record<SeatFlag, boolean>

/** The words the desktop panel and the Profile page show (M25-4, FINAL). */
export const SEAT_RIGHT_LABELS: Readonly<Record<SeatFlag, string>> = {
  seeAddress: 'See customer addresses',
  seeContact: 'See customer phone numbers',
  seePriceList: 'Use the Price List',
  seeSales: 'See sales totals',
  seePayments: 'See the Payments page',
  shareBills: 'Share bills (image, PDF, QR)',
  exportData: "Export, import or reset the phone's data",
  deleteBills: 'Delete bills',
  editOldBills: 'Change bills dated before today',
  editCustomers: 'Add, change or merge customers',
  editPayments: 'Change the Payments list'
}

/** What the phone does when the flag is OFF (one line each; the panel shows it as the toggle's help text). */
export const SEAT_RIGHT_OFF_EFFECT: Readonly<Record<SeatFlag, string>> = {
  seeAddress: 'No customer address anywhere in the app.',
  seeContact: 'No customer phone or contact in the app, and no call or WhatsApp buttons.',
  seePriceList: 'No Price List screens, search, entries or automatic rates.',
  seeSales: 'No Dashboard sales, History totals or customer totals.',
  seePayments: 'No Payments screen, and the phone does not keep the payments list.',
  shareBills: 'Cannot share an image, a PDF or a QR.',
  exportData: 'Cannot export, import or reset the phone\'s data.',
  deleteBills: 'Cannot delete bills.',
  editOldBills: 'Bills dated before today are view only.',
  editCustomers: 'Customers are view only.',
  editPayments: 'Cannot save changes to the Payments list.'
}

/** "needs See customer addresses" - the short refusal wording (the Price List uses "needs Overwrite"). */
export const seatNeedsWord = (f: SeatFlag): string => `needs "${SEAT_RIGHT_LABELS[f]}"`
export const seatNeedsWords = (flags: readonly SeatFlag[]): string => flags.map(seatNeedsWord).join(', ')

/** The honest-limit sentence shown in the desktop panel and Settings. Never softened, never says "secure". */
export const SEAT_RIGHTS_HONEST_LIMIT =
  'These rights hide and block things in the app only. The records still sit on the phone, and a shared image or PDF still carries the customer address and phone, so a technical person holding the phone could read them.'

export const ALL_SEAT_RIGHTS: Readonly<SeatFlags> = Object.freeze(Object.fromEntries(SEAT_RIGHT_FLAGS.map((f) => [f, true])) as SeatFlags)
export const NO_SEAT_RIGHTS: Readonly<SeatFlags> = Object.freeze(Object.fromEntries(SEAT_RIGHT_FLAGS.map((f) => [f, false])) as SeatFlags)

/** Stored / received flags -> all eleven keys, each a real boolean (anything but a real `true` is false; unknown keys dropped; non-object = all false). */
export function normalizeSeatFlags(raw: unknown): SeatFlags {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = {} as SeatFlags
  for (const f of SEAT_RIGHT_FLAGS) out[f] = r[f] === true
  return out
}

const pick = (on: readonly SeatFlag[]): SeatFlags => { const o = { ...NO_SEAT_RIGHTS }; for (const f of on) o[f] = true; return o }

export type PresetName = 'Full' | 'Staff' | 'Viewer'
export const PRESET_NAMES: readonly PresetName[] = ['Full', 'Staff', 'Viewer']
export const PRESETS: Readonly<Record<PresetName, Readonly<SeatFlags>>> = Object.freeze({
  Full: { ...ALL_SEAT_RIGHTS },
  Staff: pick(['shareBills', 'seePriceList', 'editCustomers']),
  Viewer: pick(['seeAddress', 'seeContact', 'seePriceList', 'seeSales', 'seePayments'])
})
/** The preset a flag set equals, else null ("Custom"). */
export function presetOf(flags: unknown): PresetName | null {
  const n = normalizeSeatFlags(flags)
  return PRESET_NAMES.find((p) => SEAT_RIGHT_FLAGS.every((f) => PRESETS[p][f] === n[f])) ?? null
}

/** What seat 1 may store for any seat: seat 1's own flags are forced all-true. */
export const seatFlagsToStore = (seatNo: number, flags: unknown): SeatFlags => (seatNo === 1 ? { ...ALL_SEAT_RIGHTS } : normalizeSeatFlags(flags))

export type ServerKnowsRights = 'yes' | 'no' | 'unknown'
export interface EffectiveRightsInput {
  seatNo: number | null
  linked: boolean
  /** The last server answer for this seat (cached); anything unreadable counts as all false. */
  granted: unknown
  /** The server's `configured` for this seat; null = no answer yet. */
  configured: boolean | null
  serverKnows: ServerKnowsRights
}
/** The table of M25-4, exactly. Pure; never throws. */
export function effectiveRights(i: EffectiveRightsInput): SeatFlags {
  if (i.seatNo === 1) return { ...ALL_SEAT_RIGHTS }
  if (!i.linked) return { ...ALL_SEAT_RIGHTS }
  // An old company project: everything, except the bank details which stay seat 1 only (M25-12 #3).
  if (i.serverKnows === 'no') return { ...ALL_SEAT_RIGHTS, editPayments: false }
  if (i.serverKnows === 'yes' && i.configured === true) return normalizeSeatFlags(i.granted)
  return { ...PRESETS.Staff }
}

/** The pure helper every screen uses to ask. */
export const canDo = (flags: Readonly<SeatFlags>, flag: SeatFlag): boolean => flags[flag] === true
/** The flags in `needed` that are off. */
export const missingSeatFlags = (flags: Readonly<SeatFlags>, needed: readonly SeatFlag[]): SeatFlag[] => needed.filter((f) => flags[f] !== true)

/** One seat as the server lists it (desktop panel). */
export interface SeatRightsRow { seatNo: number; branchName: string | null; flags: SeatFlags; configured: boolean; updatedAt: string | null }
/** This seat's own answer (`qt_seat_rights_get`). */
export interface SeatRightsAnswer { seatNo: number; flags: SeatFlags; configured: boolean }

/** The line the panel shows for a seat's current setting: the preset name, "Staff (default)" for a seat the server never configured, or "Custom". */
export function seatRightsSummary(row: Pick<SeatRightsRow, 'flags' | 'configured'>): string {
  if (!row.configured) return 'Staff (default)'
  return presetOf(row.flags) ?? 'Custom'
}
