import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  THEME_FILE_MAX_BYTES,
  THEME_MAX_FILES
} from '../../shared/theme/tokens'
import { validateTheme, type ThemeFile } from '../../shared/theme/validateTheme'
import { titleBarOverlayFrom, type TitleBarOverlay } from '../../shared/theme/titleBar'
import { buildStarterTheme, starterIsValid, starterToJson } from '../../shared/theme/starter'
import type { ThemeListing, ThemeLoadError } from '../../shared/ipc'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'

export interface ThemeService {
  list(): ThemeListing
  reload(): ThemeListing
  load(id: string): ThemeFile
  getActive(): string
  setActive(id: string): string
  /** Phase 49: opens the themes folder in Explorer (created first when missing). */
  openFolder(): Promise<void>
  /** Phase 49: writes a starter theme file made from the live token values of `id`; returns the file name and path. */
  /** Phase 98: validates the title bar colours / height read from the live theme and hands them to the window port. Unusable colours are ignored (VALIDATION). */
  setTitleBar(input: { bg: string; symbol: string; height: string }): void
  exportStarter(input: { id: string; computed: Record<string, string> }): { file: string; path: string; id: string }
}

const builtinThemes = (): ThemeFile[] =>
  BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name, tokens: {}, builtin: true }))

/**
 * Reads drop-in theme JSON files from the themes folder. Files are untrusted: size-capped,
 * regular files only, validated/sanitised by validateTheme. Invalid files are skipped and reported.
 * The active theme is persisted as setting `ui.theme` when a settings store is supplied (Phase 5).
 */
export interface ThemeSettingsStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export function createThemeService(opts: {
  dir: string
  log: Logger
  settings?: ThemeSettingsStore
  /** Phase 49: Electron `shell.openPath` (returns '' on success, else the error text). Injected so tests need no Electron. */
  openPath?: (dir: string) => Promise<string>
  /** Phase 98: applies the overlay to the main window (Electron `setTitleBarOverlay`); absent in tests / off Windows. */
  applyTitleBar?: (o: TitleBarOverlay) => void
}): ThemeService {
  let cache: ThemeListing | null = null
  // Phase 5: the active theme id is persisted as setting `ui.theme` (falls back to the default if unset/invalid).
  const stored = opts.settings?.get('ui.theme')
  let activeId = typeof stored === 'string' && stored ? stored : DEFAULT_THEME_ID

  function scan(): ThemeListing {
    const themes = builtinThemes()
    const errors: ThemeLoadError[] = []
    const seen = new Set(themes.map((t) => t.id))

    let files: string[] = []
    if (existsSync(opts.dir)) {
      try {
        files = readdirSync(opts.dir).filter((f) => f.toLowerCase().endsWith('.json')).sort()
      } catch (err) {
        opts.log.warn('themes: cannot read folder', err)
      }
    }
    if (files.length > THEME_MAX_FILES) {
      errors.push({ file: '(folder)', message: `more than ${THEME_MAX_FILES} theme files; extras ignored` })
      files = files.slice(0, THEME_MAX_FILES)
    }

    for (const file of files) {
      const path = join(opts.dir, file)
      try {
        const st = lstatSync(path)
        if (!st.isFile()) {
          errors.push({ file, message: 'not a regular file' })
          continue
        }
        if (st.size > THEME_FILE_MAX_BYTES) {
          errors.push({ file, message: `larger than ${THEME_FILE_MAX_BYTES / 1024} KB` })
          continue
        }
        let raw: unknown
        try {
          raw = JSON.parse(readFileSync(path, 'utf8'))
        } catch {
          errors.push({ file, message: 'not valid JSON' })
          continue
        }
        const v = validateTheme(raw)
        if (!v.ok) {
          errors.push({ file, message: v.errors.join('; ') })
          continue
        }
        if (seen.has(v.theme.id)) {
          errors.push({ file, message: `duplicate theme id "${v.theme.id}"` })
          continue
        }
        seen.add(v.theme.id)
        themes.push(v.theme)
        for (const w of v.warnings) opts.log.info(`themes: ${file}: ${w}`)
      } catch (err) {
        opts.log.warn(`themes: failed reading ${file}`, err)
        errors.push({ file, message: 'could not be read' })
      }
    }
    if (errors.length) opts.log.warn('themes: some files were skipped', { count: errors.length })
    // If the active custom theme vanished, fall back to the default.
    if (!themes.some((t) => t.id === activeId)) activeId = DEFAULT_THEME_ID
    return { themes, errors }
  }

  const list = (): ThemeListing => (cache ??= scan())

  return {
    list,
    reload: () => (cache = scan()),
    load(id) {
      const t = list().themes.find((x) => x.id === id)
      if (!t) throw new AppError('NOT_FOUND', 'Theme not found')
      return t
    },
    getActive: () => activeId,
    setActive(id) {
      if (!list().themes.some((x) => x.id === id)) throw new AppError('NOT_FOUND', 'Theme not found')
      activeId = id
      try {
        opts.settings?.set('ui.theme', id)
      } catch (err) {
        opts.log.warn('themes: could not persist active theme', err) // e.g. read-only DB; stays in memory
      }
      return id
    },
    setTitleBar(input) {
      const o = titleBarOverlayFrom(input)
      if (!o) throw new AppError('VALIDATION', 'Title bar colours must be #rrggbb or rgb() values')
      try { opts.applyTitleBar?.(o) } catch (err) { opts.log.warn('themes: could not update the title bar overlay', err) }
    },
    async openFolder() {
      try {
        mkdirSync(opts.dir, { recursive: true })
      } catch (err) {
        opts.log.warn('themes: cannot create folder', err)
        throw new AppError('IO_ERROR', 'Could not create the themes folder')
      }
      const err = opts.openPath ? await opts.openPath(opts.dir) : ''
      if (err) {
        opts.log.warn('themes: openPath failed', { err })
        throw new AppError('IO_ERROR', 'Could not open the themes folder')
      }
    },
    exportStarter({ id, computed }) {
      const listing = list()
      const from = listing.themes.find((x) => x.id === id)
      if (!from) throw new AppError('NOT_FOUND', 'Theme not found')
      const starter = buildStarterTheme({
        fromId: from.id, fromName: from.name, fromBase: from.base, builtin: from.builtin, computed,
        takenIds: listing.themes.map((x) => x.id)
      })
      if (!starterIsValid(starter) || Object.keys(starter.tokens).length === 0) {
        throw new AppError('VALIDATION', 'Could not read the theme values to export.')
      }
      try {
        mkdirSync(opts.dir, { recursive: true })
        const file = `${starter.id}.json`
        const path = join(opts.dir, file)
        writeFileSync(path, starterToJson(starter), { encoding: 'utf8', flag: 'wx' }) // never overwrites
        cache = null // the next list() sees the new file
        return { file, path, id: starter.id }
      } catch (err) {
        opts.log.warn('themes: could not write starter file', err)
        throw new AppError('IO_ERROR', 'Could not write the starter theme file')
      }
    }
  }
}
