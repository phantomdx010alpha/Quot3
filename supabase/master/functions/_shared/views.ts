/** Phase 260 - row -> wire shape helpers shared by the functions. */
import type { ProfileView } from '../../../../src/shared/master/schemas'
import type { CompanyRow } from './types'

/** A company with no profile set answers `{ version: 0, name: <company label>, phone: '', address: '', logo: null }`. */
export function profileView(c: CompanyRow): ProfileView {
  const p = c.profile ?? {}
  return {
    version: c.profile_version,
    name: c.profile_version === 0 ? c.label : (p.name ?? c.label),
    phone: p.phone ?? '',
    address: p.address ?? '',
    logo: p.logo ?? null
  }
}
