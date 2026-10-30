import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGame, validateWorksheet } from '../../../../tools/games-i18n.mjs'
import type { Worksheet } from '../../../../tools/games-i18n.mjs'
import { validateManifest } from '../../../shared/games/manifest'

/** Permanent guard (Milestone 20, Phase 206; design 4.3): the language of every game is honest, and every translation is finished. */
const ROOT = resolve(__dirname, '../../../../resources/games')
const TRANSLATIONS = resolve(ROOT, '../../docs/translations')
const parsed = validateManifest(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')))
const games = parsed.games
const translations = existsSync(TRANSLATIONS) ? readdirSync(TRANSLATIONS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []

describe('game language guard (Phase 206, M20)', () => {
  it('the manifest is valid and nothing was skipped', () => {
    expect(parsed.skipped).toBe(0)
    expect(games.length).toBeGreaterThan(0)
  })

  describe('every lang "en" game has no Chinese left and passes the audit', () => {
    for (const g of games.filter((x) => x.lang === 'en')) {
      it(g.id, () => {
        const r = checkGame(join(ROOT, g.id))
        expect({ id: g.id, leftovers: r.leftovers, audit: r.audit.failures }).toEqual({ id: g.id, leftovers: [], audit: [] })
        expect(g.description).not.toMatch(/Chinese/i)
      })
    }
  })

  it('every game that has a worksheet in docs/translations is lang "en", and every worksheet names an existing game', () => {
    for (const id of translations) {
      const g = games.find((x) => x.id === id)
      expect({ id, exists: !!g }).toEqual({ id, exists: true })
      expect({ id, lang: g!.lang }).toEqual({ id, lang: 'en' })
    }
  })

  describe('every worksheet is finished: an English text with no CJK for every entry', () => {
    for (const id of translations) {
      it(id, () => {
        const ws = JSON.parse(readFileSync(join(TRANSLATIONS, `${id}.json`), 'utf8')) as Worksheet
        expect(ws.game).toBe(id)
        expect(ws.entries.length).toBeGreaterThan(0)
        // the files may already be patched, so only the English side is validated here (file path, en, placeholders)
        expect(validateWorksheet(ws, id)).toEqual([])
        for (const e of ws.entries) expect(existsSync(join(ROOT, id, e.file))).toBe(true)
      })
    }
  })

  it('every game whose folder carries a patch diff is lang "en" (a translated game is never left hidden)', () => {
    const patches = resolve(ROOT, '../../docs/patches')
    for (const f of readdirSync(patches).filter((x) => x.endsWith('-en.diff'))) {
      const id = f.slice(0, -'-en.diff'.length)
      expect({ id, lang: games.find((x) => x.id === id)?.lang }).toEqual({ id, lang: 'en' })
    }
  })

  it('every lang "zh" game still says so in its description, so the owner knows', () => {
    for (const g of games.filter((x) => x.lang === 'zh')) expect({ id: g.id, says: /Chinese/i.test(g.description) }).toEqual({ id: g.id, says: true })
  })
})
