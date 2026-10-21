import type { SettingDefaults } from '../data/settingsRepo'

/** Pure helpers for the phone Settings (Phase 185). */
export type CompanyProfile = SettingDefaults['company.profile']

export const COMPANY_LIMITS = { name: 120, phone: 40, address: 400 } as const
export const LOGO_MAX_BYTES = 200 * 1024
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type CompanyCheck = { ok: true; value: CompanyProfile } | { ok: false; errors: Partial<Record<'name' | 'phone' | 'address', string>> }

/** Trims the text fields and checks lengths. The company name may be blank (the Professional output then has no company block). */
export function checkCompany(p: CompanyProfile): CompanyCheck {
  const value: CompanyProfile = { name: p.name.trim(), phone: p.phone.trim(), address: p.address.trim(), logoDataUrl: p.logoDataUrl }
  const errors: Partial<Record<'name' | 'phone' | 'address', string>> = {}
  for (const k of ['name', 'phone', 'address'] as const)
    if (value[k].length > COMPANY_LIMITS[k]) errors[k] = `Too long (up to ${COMPANY_LIMITS[k]} characters).`
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value }
}

/** null = fine, otherwise the reason the logo file is refused. */
export function checkLogoFile(f: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(f.type)) return 'Choose a PNG, JPEG or WebP picture.'
  if (f.size > LOGO_MAX_BYTES) return 'The logo is too big. Use a picture under 200 KB.'
  return null
}

/** "Last export: 3 days ago" for the storage page. */
export function lastExportText(lastExportAt: string | null, now: Date): string {
  if (!lastExportAt) return 'never'
  const t = Date.parse(lastExportAt)
  if (Number.isNaN(t)) return 'never'
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

export type ResetStep = 'idle' | 'first' | 'second'
/** The reset needs TWO separate confirms; only the second one erases. Anything else keeps the person where they are. */
export function nextResetStep(step: ResetStep, action: 'start' | 'confirm' | 'cancel'): { step: ResetStep; erase: boolean } {
  if (action === 'cancel') return { step: 'idle', erase: false }
  if (action === 'start') return { step: step === 'idle' ? 'first' : step, erase: false }
  if (step === 'first') return { step: 'second', erase: false }
  if (step === 'second') return { step: 'idle', erase: true }
  return { step, erase: false }
}
