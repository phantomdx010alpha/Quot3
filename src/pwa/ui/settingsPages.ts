/** The phone Settings sub pages (Phase 188b), in the order of the home list. Same idea as the Windows app's settings sections, phone subset. */
export const SETTINGS_PAGES = [
  { id: 'appearance', label: 'Themes', hint: 'Colours of the app' },
  { id: 'company', label: 'Company', hint: 'Name, phone, address and logo for Professional bills' },
  { id: 'sync', label: 'Branch and sync', hint: 'Sign in, PO prefix, share bills with your computers' },
  { id: 'share', label: 'Share defaults', hint: 'Rough or Professional, image or PDF' },
  { id: 'storage', label: 'Storage and backup', hint: 'Export, import and reset this phone' },
  { id: 'lock', label: 'App lock', hint: 'PIN when the app opens' },
  { id: 'about', label: 'About Quot3', hint: 'Version, publisher and contact' }
] as const

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]['id']
export const isSettingsPage = (v: unknown): v is SettingsPageId => typeof v === 'string' && SETTINGS_PAGES.some((p) => p.id === v)
export const settingsPageLabel = (id: string | undefined): string => SETTINGS_PAGES.find((p) => p.id === id)?.label ?? 'Settings'
