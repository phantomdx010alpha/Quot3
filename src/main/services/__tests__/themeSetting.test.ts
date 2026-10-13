import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createThemeService } from '../themeService'
import { createSettingsService } from '../settingsService'
import { createSettingsRepo } from '../../db/settingsRepo'
import { openTestDb } from '../../db/__tests__/helpers'

const log = { info() {}, warn() {}, error() {}, debug() {} } as never

describe('theme persistence (ui.theme)', () => {
  it('setActive is stored and survives a restart', () => {
    const t = openTestDb()
    const themesDir = mkdtempSync(join(tmpdir(), 'q3-themes-'))
    try {
      const mk = (h = t.handle) => createThemeService({ dir: themesDir, log, settings: createSettingsService(createSettingsRepo(h.sqlite)) })
      const a = mk()
      expect(a.getActive()).toBe('navy-ember')
      a.setActive('paper')
      expect(mk(t.reopen()).getActive()).toBe('paper')
    } finally {
      t.cleanup()
      rmSync(themesDir, { recursive: true, force: true })
    }
  })
})
