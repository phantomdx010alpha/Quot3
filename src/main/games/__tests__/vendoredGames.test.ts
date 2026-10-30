import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditGameFolder } from '../../../../tools/audit-games.mjs'
import { ALLOWED_LICENCES, isSafeGamePath, validateManifest } from '../../../shared/games/manifest'
import { createGameCatalog } from '../gameCatalog'

/** Permanent guard (Milestone 19, Phase 199): runs the audit and the manifest validator over the REAL resources/games folder. */
const ROOT = resolve(__dirname, '../../../../resources/games')
const RECORD = readFileSync(resolve(ROOT, '../../docs/THIRD_PARTY_GAMES.md'), 'utf8')
const raw = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as unknown
const parsed = validateManifest(raw)

describe('vendored games (real resources/games folder)', () => {
  it('the manifest is valid and nothing was skipped', () => {
    expect(parsed.problems).toEqual([])
    expect(parsed.skipped).toBe(0)
    expect(parsed.games.length).toBeGreaterThanOrEqual(1)
  })

  it('the catalogue reader lists the same games with no problems', () => {
    const r = createGameCatalog({ gamesRoot: ROOT }).list()
    expect(r.problems).toEqual([])
    expect(r.games.map((g) => g.id)).toEqual(parsed.games.map((g) => g.id))
  })

  it('every game folder is in the manifest (only _-prefixed test folders may be absent)', () => {
    const ids = new Set(parsed.games.map((g) => g.id))
    const dirs = readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory() && !n.startsWith('_'))
    expect(dirs.filter((d) => !ids.has(d))).toEqual([])
  })

  for (const g of parsed.games) {
    describe(g.id, () => {
      const dir = join(ROOT, g.id)
      it('licence id is allowed, entry is inside its folder and exists', () => {
        expect((ALLOWED_LICENCES as readonly string[]).includes(g.licence)).toBe(true)
        expect(isSafeGamePath(g.entry)).toBe(true)
        const full = resolve(dir, g.entry)
        expect(full.startsWith(dir + sep)).toBe(true)
        expect(existsSync(full)).toBe(true)
      })
      it('keeps its LICENSE file', () => {
        expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toMatch(/Permission is hereby granted/)
      })
      it('passes the audit with no failures', () => {
        const a = auditGameFolder(dir, { entry: g.entry })
        expect(a.failures).toEqual([])
        expect(a.ok).toBe(true)
      })
      it('is listed in docs/THIRD_PARTY_GAMES.md', () => {
        expect(RECORD).toContain('`' + g.id + '`')
      })
    })
  }

  it('the bundled THIRD_PARTY.txt names every shipped game', () => {
    const txt = readFileSync(join(ROOT, 'THIRD_PARTY.txt'), 'utf8')
    for (const g of parsed.games) expect(txt).toContain('`' + g.id + '`')
  })
})

describe('vendored games language (Phase 205, M20)', () => {
  it('every manifest game has lang en or zh equal to the tool answer; the English ones are the seven original games plus the translated ones', async () => {
    const lang = await import('../../../../tools/games-lang.mjs')
    const found = lang.classifyGamesRoot(ROOT)
    expect(parsed.games.every((g) => g.lang === 'en' || g.lang === 'zh')).toBe(true)
    for (const g of parsed.games) expect({ id: g.id, lang: g.lang }).toEqual({ id: g.id, lang: found[g.id]!.lang })
    // the seven games that were English upstream, plus every game translated since Phase 206 (each has a worksheet in docs/translations)
    const translated = readdirSync(resolve(ROOT, '../../docs/translations')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    expect(parsed.games.filter((g) => g.lang === 'en').map((g) => g.id).sort()).toEqual(['2048', 'blocks', 'bounce-ball', 'chess', 'snake', 'spider-solitaire', 'tower-defence', ...translated].sort())
  })
})
