/**
 * Phase 264 - the "Link to master" form rules (API_CONTRACTS.md M24-J). Pure: no Electron / Node / DOM imports.
 * The limits match the `master:link` zod input in `main/ipc/master.ts`, so a form this accepts is never refused for its size.
 * The service_role key is only ever looked at here, never returned, logged or put in a message.
 */

export const ENROL_TOKEN_MIN = 8
export const ENROL_TOKEN_MAX = 200
export const LINK_LABEL_MAX = 80
export const SERVICE_KEY_MIN = 20
export const SERVICE_KEY_MAX = 4000

export interface LinkForm { enrolToken: string; label: string; serviceRoleKey: string }
export type LinkField = keyof LinkForm
export type LinkFieldErrors = Partial<Record<LinkField, string>>

export const EMPTY_LINK_FORM: LinkForm = { enrolToken: '', label: '', serviceRoleKey: '' }

/** The claim `role` of a Supabase key (a JWT), or null when it is not one. Used only to catch the anon key pasted by mistake. */
function keyRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob === 'function' ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) : ''
    const role = (JSON.parse(json) as { role?: unknown }).role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/** Plain-words problems per field; an empty object means the form can be sent. */
export function validateLinkForm(form: LinkForm): LinkFieldErrors {
  const errors: LinkFieldErrors = {}
  const token = form.enrolToken.trim()
  if (token === '') errors.enrolToken = 'Type the enrol token the owner gave you.'
  else if (token.length < ENROL_TOKEN_MIN || token.length > ENROL_TOKEN_MAX) errors.enrolToken = 'That enrol token does not look right. Copy it again.'
  const label = form.label.trim()
  if (label === '') errors.label = 'Type a name for this company.'
  else if (label.length > LINK_LABEL_MAX) errors.label = `Keep the company name under ${LINK_LABEL_MAX + 1} letters.`
  const key = form.serviceRoleKey.trim()
  if (key === '') errors.serviceRoleKey = 'Paste the service_role key of the company project.'
  else if (key.length < SERVICE_KEY_MIN || key.length > SERVICE_KEY_MAX) errors.serviceRoleKey = 'That key does not look right. Copy it again.'
  else if (keyRole(key) === 'anon') errors.serviceRoleKey = 'That is the public anon key. Paste the service_role key instead.'
  return errors
}

/** True when this PC may be offered "Link to master": configured build, not linked yet, shared sync signed in as seat 1. */
export function canOfferLink(i: { configured: boolean; linked: boolean; sharedActive: boolean; sharedSeatNo: number | null }): boolean {
  return i.configured && !i.linked && i.sharedActive && i.sharedSeatNo === 1
}

/** The one-line status every PC shows. */
export function seatStatusLine(s: { linked: boolean; seatNo: number | null; companyLabel: string | null } | null): string {
  if (!s || !s.linked || s.seatNo === null) return 'Not linked to master'
  return s.companyLabel ? `Linked as seat ${s.seatNo} of ${s.companyLabel}` : `Linked as seat ${s.seatNo}`
}
