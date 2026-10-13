import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BranchRepo } from '../db/branchRepo'
import {
  BEHAVIOUR_KEYS, COMPANY_PROFILE_KEY, NAV_SMOOTH_ARROWS_KEY, readSmoothArrows, logoFileName, previewPo, readBehaviour, readCompany, validateBehaviour, validateCompany,
  validateLogoBytes, validatePoPrefix, validatePrintDefaults, type AppSettingsState, type BehaviourSettings, type PrintDefaults
} from '../../shared/settings/appSettings'
import { ROUND_OFF_SETTING_KEY, readRoundOffSetting } from '../../shared/calc/billOptions'
import { PERCENT_PRESETS_KEY, readPercentPresets, validatePercentPresets } from '../../shared/calc/percentPresets'
import { PRINT_SETTING_KEYS } from '../../shared/print/printFlow'
import { IMAGE_SCALE_KEY, readImageScale, validateImageScale } from '../../shared/print/imageFlow'
import { AppError } from '../ipc/envelope'
import type { SettingsService } from './settingsService'

/** The native "choose a logo" dialog and printer list (Electron in the app, stubs in tests). */
export interface SettingsPorts {
  pickLogo(): Promise<string | null>
  listPrinters(): Promise<string[]>
}

export interface AppSettingsService {
  get(): AppSettingsState
  saveCompany(input: { name: string; phone: string; address: string }): AppSettingsState
  /** Opens the dialog, validates the file's real type / size / pixels, copies it into assets/. `cancelled` = dialog closed. */
  chooseLogo(): Promise<{ cancelled: boolean; state: AppSettingsState }>
  removeLogo(): AppSettingsState
  savePrefix(prefix: string): AppSettingsState
  savePrint(input: { rupeeOnTotal: boolean; silent: boolean; printer: string }): AppSettingsState
  saveBehaviour(input: BehaviourSettings): AppSettingsState
  /** Phase 72: Image quality, a whole scale 2 to 5; anything else is refused with the message. */
  saveImage(input: { scale: number }): AppSettingsState
  /** Phase 75: smooth arrow keys on / off (a real boolean; anything else is refused). */
  saveNav(input: { smoothArrows: boolean }): AppSettingsState
  /** Phase 77: round off on / off (a real boolean). Affects bills saved AFTER the change; saved bills keep their own flag. */
  saveCalc(input: { roundOff?: boolean; percentPresets?: string }): AppSettingsState
  printers(): Promise<string[]>
  /** For the print template: the saved logo as a data URL ('' when none / unreadable). */
  logoDataUrl(fileName: string): string
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg' }

export function createAppSettingsService(deps: { settings: SettingsService; branches: BranchRepo; assetsDir: string; ports: SettingsPorts }, opts: { writable?: boolean; now?: () => Date } = {}): AppSettingsService {
  const now = opts.now ?? (() => new Date())
  const guard = (): void => { if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }
  const company = () => readCompany(deps.settings.get(COMPANY_PROFILE_KEY))
  const bad = (message: string): never => { throw new AppError('VALIDATION', message) }

  function logoDataUrl(name: string): string {
    const m = /^[A-Za-z0-9._-]{1,80}\.(png|jpg)$/.exec(name)
    if (!m) return ''
    try {
      const file = join(deps.assetsDir, name)
      if (!existsSync(file)) return ''
      return `data:${MIME[m[1]!]};base64,${readFileSync(file).toString('base64')}`
    } catch {
      return ''
    }
  }

  function removeLogoFiles(except?: string): void {
    for (const ext of ['png', 'jpg'] as const) {
      const n = logoFileName(ext)
      if (n !== except) rmSync(join(deps.assetsDir, n), { force: true })
    }
  }

  function get(): AppSettingsState {
    const all = deps.settings.getAll()
    const c = company()
    const b = deps.branches.local()
    const resolved = validatePrintDefaults({ rupeeOnTotal: all[PRINT_SETTING_KEYS.rupeeOnTotal], silent: all[PRINT_SETTING_KEYS.silent], printer: all[PRINT_SETTING_KEYS.printer] })
    const print: PrintDefaults = resolved.ok ? resolved.value : { rupeeOnTotal: all[PRINT_SETTING_KEYS.rupeeOnTotal] !== false, silent: false, printer: typeof all[PRINT_SETTING_KEYS.printer] === 'string' ? (all[PRINT_SETTING_KEYS.printer] as string).trim() : '' }
    return {
      company: { ...c, logoDataUrl: c.logo ? logoDataUrl(c.logo) : '' },
      branch: b ? { name: b.name, prefix: b.poPrefix, nextSeq: b.nextSeq, nextPo: previewPo(b.poPrefix, b.nextSeq), otherPrefixes: deps.branches.otherPrefixes(b.id) } : null,
      print,
      behaviour: readBehaviour(all),
      image: { scale: readImageScale(all) },
      nav: { smoothArrows: readSmoothArrows(all) },
      calc: { roundOff: readRoundOffSetting(all), percentPresets: readPercentPresets(all).join(', ') },
      readOnly: opts.writable === false
    }
  }

  const putCompany = (c: ReturnType<typeof company>): void => deps.settings.set(COMPANY_PROFILE_KEY, c)

  return {
    get,
    saveCompany(input) {
      guard()
      const r = validateCompany(input)
      if (!r.ok) return bad(r.message)
      putCompany({ ...company(), ...r.value })
      return get()
    },
    async chooseLogo() {
      guard()
      const file = await deps.ports.pickLogo()
      if (!file) return { cancelled: true, state: get() }
      let bytes: Uint8Array
      try {
        bytes = readFileSync(file)
      } catch {
        throw new AppError('IO_ERROR', 'Could not read that file.')
      }
      const check = validateLogoBytes(bytes)
      if (!check.ok) return bad(check.message)
      const name = logoFileName(check.image.ext)
      mkdirSync(deps.assetsDir, { recursive: true })
      const tmp = join(deps.assetsDir, `${name}.tmp`)
      try {
        writeFileSync(tmp, bytes)
        renameSync(tmp, join(deps.assetsDir, name))
      } catch {
        rmSync(tmp, { force: true })
        throw new AppError('IO_ERROR', 'Could not save the logo.')
      }
      removeLogoFiles(name)
      putCompany({ ...company(), logo: name })
      return { cancelled: false, state: get() }
    },
    removeLogo() {
      guard()
      removeLogoFiles()
      putCompany({ ...company(), logo: '' })
      return get()
    },
    savePrefix(prefix) {
      guard()
      const b = deps.branches.local()
      if (!b) throw new AppError('NOT_FOUND', 'No local branch.')
      const r = validatePrefixFor(prefix, deps.branches.otherPrefixes(b.id))
      if (r !== b.poPrefix) {
        deps.branches.setPrefix(b.id, r)
        deps.branches.audit({ at: now().toISOString(), branchId: b.id, entity: 'branch', entityId: b.id, action: 'po_prefix', detailJson: JSON.stringify({ from: b.poPrefix, to: r }) })
      }
      return get()
    },
    savePrint(input) {
      guard()
      const r = validatePrintDefaults(input)
      if (!r.ok) return bad(r.message)
      deps.settings.set(PRINT_SETTING_KEYS.rupeeOnTotal, r.value.rupeeOnTotal)
      deps.settings.set(PRINT_SETTING_KEYS.silent, r.value.silent)
      deps.settings.set(PRINT_SETTING_KEYS.printer, r.value.printer)
      return get()
    },
    saveBehaviour(input) {
      guard()
      const r = validateBehaviour(input)
      if (!r.ok) return bad(r.message)
      for (const k of Object.keys(BEHAVIOUR_KEYS) as (keyof BehaviourSettings)[]) deps.settings.set(BEHAVIOUR_KEYS[k], r.value[k])
      return get()
    },
    saveImage(input) {
      guard()
      const r = validateImageScale(input.scale)
      if (!r.ok) return bad(r.message)
      deps.settings.set(IMAGE_SCALE_KEY, r.value)
      return get()
    },
    saveNav(input) {
      guard()
      if (typeof input.smoothArrows !== 'boolean') return bad('Smooth arrow keys: choose on or off.')
      deps.settings.set(NAV_SMOOTH_ARROWS_KEY, input.smoothArrows)
      return get()
    },
    saveCalc(input) {
      guard()
      if (input.roundOff === undefined && input.percentPresets === undefined) return bad('Nothing to save.')
      if (input.roundOff !== undefined && typeof input.roundOff !== 'boolean') return bad('Round off: choose on or off.')
      let presets: string | undefined
      if (input.percentPresets !== undefined) {
        const c = validatePercentPresets(input.percentPresets)
        if (!c.ok) return bad(c.message)
        presets = c.text
      }
      if (input.roundOff !== undefined) deps.settings.set(ROUND_OFF_SETTING_KEY, input.roundOff)
      if (presets !== undefined) deps.settings.set(PERCENT_PRESETS_KEY, presets)
      return get()
    },
    printers: () => deps.ports.listPrinters().catch(() => []),
    logoDataUrl
  }

  function validatePrefixFor(prefix: string, others: string[]): string {
    const r = validatePoPrefix(prefix, others)
    if (!r.ok) return bad(r.message)
    return r.prefix
  }
}
