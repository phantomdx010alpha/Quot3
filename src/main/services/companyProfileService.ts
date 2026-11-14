/**
 * Phase 270 - the company profile on the desktop (API_CONTRACTS.md M24-P). It WRAPS `appSettingsService`; that service and the local record
 * `company.profile` (what print reads today) are not changed. Three cases, decided on every call:
 *   plain  - not linked to the master, or linked but no company default downloaded yet: exactly the old behaviour (calls go straight through).
 *   admin  - seat 1: edits the company default. Saves on this PC first, then publishes with `profileSet`; a master problem is shown as a
 *            plain-words notice, it never loses the local save and never throws.
 *   seat   - any other seat: shows the company default; editing a field sets `company.override.<field>`; "Use company default" clears it.
 * `applyProfile` is the master service's profile port: it stores the downloaded default (text in `company.master`, logo as a file in assets/).
 * `effective()` is the single getter Phase 271 will switch the print / image / share readers to.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../ipc/envelope'
import { COMPANY_PROFILE_KEY, readCompany, validateCompany, type AppSettingsState } from '../../shared/settings/appSettings'
import {
  MASTER_LOGO_FILE, MASTER_PROFILE_KEY, PROFILE_FIELDS, checkProfileSizes, diffProfile, effectiveProfile, fitLogoForMaster, NO_OVERRIDES, overrideKey,
  overridesAfterEdit, readOverrides, readStoredMaster, storedFromView, validMasterLogoBase64, type CompanyMasterView, type EffectiveProfile, type ProfileField
} from '../../shared/master/profile'
import type { ProfileView } from '../../shared/master/schemas'
import type { AppSettingsService } from './appSettingsService'
import type { SettingsService } from './settingsService'

/** The two things this service needs from the master service (late-bound: the master is built after the settings). */
export interface CompanyMasterPort {
  status(): { linked: boolean; isAdmin: boolean }
  profileSet(input: { name: string; phone: string; address: string; logo?: string | null }): Promise<ProfileView>
}

export interface CompanyProfileDeps {
  settings: SettingsService
  app: AppSettingsService
  assetsDir: string
  master(): CompanyMasterPort | null
  /** A real resize to a PNG whose longest side is at most `maxSide` (Electron nativeImage in the app, a stub in tests). Null = could not. */
  encodePng(bytes: Uint8Array, maxSide: number): Uint8Array | null
  log: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  writable?: boolean
}

export interface CompanyProfileService {
  get(): AppSettingsState
  /** Overlay for `AppSettingsService.setDecorator`: the effective company + the master state on top of the plain settings state. */
  decorate(base: AppSettingsState): AppSettingsState
  saveCompany(input: { name: string; phone: string; address: string }): Promise<AppSettingsState>
  chooseLogo(): Promise<{ cancelled: boolean; state: AppSettingsState }>
  removeLogo(): Promise<AppSettingsState>
  /** "Use company default": drops this PC's override of one field. */
  useDefault(field: ProfileField): AppSettingsState
  /** The master service's profile port: stores a downloaded company default. Throws only on a disk / settings failure (the version is then not advanced). */
  applyProfile(p: ProfileView): Promise<void>
  /** The profile this PC uses now (name / phone / address / logo FILE NAME + where each came from). */
  effective(): EffectiveProfile
  /** Seat 1 only: sends this PC's own company name / phone / address / logo to the master (a no-op on the master when nothing differs). Never throws. */
  publishLocal(): Promise<void>
}

type Mode = 'plain' | 'admin' | 'seat'

export function createCompanyProfileService(deps: CompanyProfileDeps): CompanyProfileService {
  const { settings, app } = deps
  let notice = ''
  const guard = (): void => { if (deps.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }

  const local = () => readCompany(settings.get(COMPANY_PROFILE_KEY))
  const stored = () => readStoredMaster(settings.get(MASTER_PROFILE_KEY))
  const flags = () => readOverrides(settings.getAll())
  const status = (): { linked: boolean; isAdmin: boolean } => {
    try { return deps.master()?.status() ?? { linked: false, isAdmin: false } } catch { return { linked: false, isAdmin: false } }
  }
  function mode(): Mode {
    const st = status()
    if (!st.linked) return 'plain'
    if (st.isAdmin) return 'admin'
    return stored() === null ? 'plain' : 'seat'
  }
  const setFlag = (f: ProfileField, on: boolean): void => { if (flags()[f] !== on) settings.set(overrideKey(f), on) }

  function effective(): EffectiveProfile {
    return mode() === 'seat' ? effectiveProfile(stored(), local(), flags()) : effectiveProfile(null, local(), NO_OVERRIDES)
  }

  const get = (): AppSettingsState => app.get()

  function decorate(base: AppSettingsState): AppSettingsState {
    const st = status()
    if (!st.linked) return base
    const m = stored()
    const eff = effective()
    const view: CompanyMasterView = {
      linked: true, isAdmin: st.isAdmin, version: m?.version ?? null,
      default: m ? { name: m.name, phone: m.phone, address: m.address, logoDataUrl: m.logoFile ? app.logoDataUrl(m.logoFile) : '' } : null,
      overrides: st.isAdmin ? { ...NO_OVERRIDES } : flags(), notice
    }
    return { ...base, company: { logo: eff.logo, name: eff.name, phone: eff.phone, address: eff.address, logoDataUrl: eff.logo ? app.logoDataUrl(eff.logo) : '' }, companyMaster: view }
  }

  /** Seat 1: send the company default to the master. A problem becomes a notice (the local save already happened). */
  async function publish(body: { logo?: string | null }): Promise<void> {
    const m = deps.master()
    if (!m) return
    const c = local()
    let logo: string | null | undefined = body.logo
    if (logo === undefined) {
      // Every save also sends the logo this PC has, so the master never keeps an old / empty one (the master ignores it when nothing changed).
      const bytes = localLogoBytes()
      const fit = bytes ? fitLogoForMaster(bytes, deps.encodePng) : null
      if (fit) logo = Buffer.from(fit).toString('base64')
    }
    try {
      await m.profileSet({ name: c.name, phone: c.phone, address: c.address, ...(logo !== undefined ? { logo } : {}) })
      notice = ''
    } catch (e) {
      notice = `Saved on this PC, not shared with the other devices yet: ${e instanceof Error && e.message !== '' ? e.message : 'the master could not be reached.'}`
      deps.log.warn('company profile publish failed')
    }
  }

  function localLogoBytes(): Uint8Array | null {
    const name = local().logo
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return null
    try { return new Uint8Array(readFileSync(join(deps.assetsDir, name))) } catch { return null }
  }

  return {
    get,
    decorate,
    effective,

    async publishLocal() {
      try {
        if (deps.writable === false || mode() !== 'admin') return
        if (local().name.trim() === '') return // nothing to share yet
        await publish({})
      } catch { /* never breaks linking or start-up */ }
    },

    async saveCompany(input) {
      const md = mode()
      if (md === 'plain') return app.saveCompany(input)
      const r = validateCompany(input)
      if (!r.ok) return app.saveCompany(input) // throws the same plain message as before
      if (md === 'admin') {
        const sz = checkProfileSizes(r.value)
        if (!sz.ok) throw new AppError('VALIDATION', sz.message)
        app.saveCompany(input)
        await publish({})
        return get()
      }
      const m = stored()!
      const before = flags()
      app.saveCompany(input)
      const change = overridesAfterEdit(m, r.value, before)
      for (const f of Object.keys(change) as ProfileField[]) setFlag(f, change[f] === true)
      return get()
    },

    async chooseLogo() {
      const md = mode()
      const r = await app.chooseLogo()
      if (r.cancelled || md === 'plain') return { cancelled: r.cancelled, state: get() }
      if (md === 'seat') { setFlag('logo', true); return { cancelled: false, state: get() } }
      const bytes = localLogoBytes()
      const fit = bytes ? fitLogoForMaster(bytes, deps.encodePng) : null
      if (!fit) notice = 'Saved on this PC, not shared with the other devices: the logo could not be made small enough (PNG, 150 KB). Try a simpler picture.'
      else await publish({ logo: Buffer.from(fit).toString('base64') })
      return { cancelled: false, state: get() }
    },

    async removeLogo() {
      const md = mode()
      app.removeLogo()
      if (md === 'seat') setFlag('logo', true)
      else if (md === 'admin') await publish({ logo: null })
      return get()
    },

    useDefault(field) {
      guard()
      if (!PROFILE_FIELDS.includes(field)) throw new AppError('VALIDATION', 'Unknown company field.')
      if (mode() === 'seat') setFlag(field, false)
      return get()
    },

    async applyProfile(p) {
      if (deps.writable === false) return
      const before = stored()
      if (before !== null && p.version < before.version) return // an older answer never replaces a newer default
      const file = join(deps.assetsDir, MASTER_LOGO_FILE)
      let logoOk = false
      if (p.logo !== null && validMasterLogoBase64(p.logo)) {
        mkdirSync(deps.assetsDir, { recursive: true })
        const tmp = `${file}.tmp`
        try {
          writeFileSync(tmp, Buffer.from(p.logo, 'base64'))
          renameSync(tmp, file)
          logoOk = true
        } catch (e) {
          rmSync(tmp, { force: true })
          throw e
        }
      } else if (existsSync(file)) {
        rmSync(file, { force: true })
      }
      const next = storedFromView(p, logoOk ? MASTER_LOGO_FILE : '')
      settings.set(MASTER_PROFILE_KEY, next)
      const changed = before === null ? [] : diffProfile({ ...before, logo: before.logoFile }, { ...next, logo: next.logoFile })
      deps.log.info('company default stored', { version: p.version, changed })
    }
  }
}
