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
        expect(g.licence === 'Owner' || (ALLOWED_LICENCES as readonly string[]).includes(g.licence)).toBe(true)
        expect(isSafeGamePath(g.entry)).toBe(true)
        const full = resolve(dir, g.entry)
        expect(full.startsWith(dir + sep)).toBe(true)
        expect(existsSync(full)).toBe(true)
      })
      it('keeps its LICENSE file', () => {
        const lic = readFileSync(join(dir, 'LICENSE'), 'utf8')
        // Phase 277: the owner's own game carries the owner notice (and the OFL texts of its fonts) instead of an open-source grant.
        if (g.licence === 'Owner') { expect(g.own).toBe(true); expect(lic).toMatch(/own work/); expect(lic).toMatch(/SIL Open Font License/) } else expect(lic).toMatch(/Permission is hereby granted/)
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
    expect(parsed.games.filter((g) => g.lang === 'en').map((g) => g.id).sort()).toEqual(['2048', 'blocks', 'bounce-ball', 'chess', 'country-wars', 'snake', 'spider-solitaire', 'tower-defence', ...translated].sort())
  })
})

describe('Country Wars (Phase 277)', () => {
  const dir = join(ROOT, 'country-wars')
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]))
  it('is in the catalogue as the owner\'s own game', () => {
    const g = parsed.games.find((x) => x.id === 'country-wars')
    expect(g).toMatchObject({ title: 'Country Wars', tags: ['arcade'], lang: 'en', players: 1, touch: false, licence: 'Owner', own: true, added: '2026-11-24' })
  })
  it('has no network address in any text file of its folder (no https://, no flagcdn, no Google Fonts)', () => {
    for (const f of files(dir).filter((p) => /\.(html|css|js|json|txt)$/i.test(p) && !/LICENSE/.test(p))) {
      const t = readFileSync(f, 'utf8')
      expect(t, f).not.toMatch(/https:\/\//)
      expect(t, f).not.toMatch(/flagcdn|googleapis|gstatic/i)
    }
  })
  it('carries its four woff2 fonts and every country code of its list has an inline flag', () => {
    expect(readdirSync(join(dir, 'fonts')).sort()).toEqual(['lilita-one-latin-400-normal.woff2', 'nunito-latin-700-normal.woff2', 'nunito-latin-800-normal.woff2', 'nunito-latin-900-normal.woff2'])
    const html = readFileSync(join(dir, 'index.html'), 'utf8')
    const codes = /const CLIST=\"([^\"]*)\"/.exec(html)![1]!.split('|').map((s) => s.slice(0, s.indexOf(':')))
    const flags = JSON.parse(/const FLAGSVG=(\{[\s\S]*?\});\n/.exec(html)![1]!) as Record<string, string>
    expect(codes.length).toBeGreaterThan(150)
    expect(codes.filter((c) => !flags[c])).toEqual([])
  })
  it('its notices are in the licence record and the bundled THIRD_PARTY.txt', () => {
    expect(RECORD).toContain('Lilita One'); expect(RECORD).toContain('Nunito'); expect(RECORD).toContain('SIL Open Font License')
    expect(readFileSync(join(ROOT, 'THIRD_PARTY.txt'), 'utf8')).toContain('SIL Open Font License')
  })
})
