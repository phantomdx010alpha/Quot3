import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { auditGameFolder } from '../../../../tools/audit-games.mjs'
import { validateManifest } from '../../../shared/games/manifest'

/** Phase 201 guard for the bundled Chess game: files present, local assets only, rules library loads and plays, audit clean. */
const ROOT = resolve(__dirname, '../../../../resources/games')
const DIR = join(ROOT, 'chess')
const read = (p: string): string => readFileSync(join(DIR, p), 'utf8')

type Move = { from: string; to: string; san: string; promotion?: string }
type ChessGame = {
  move: (m: string | { from: string; to: string; promotion?: string }) => Move | null
  moves: () => string[]
  turn: () => string
  in_checkmate: () => boolean
  in_stalemate: () => boolean
  game_over: () => boolean
  insufficient_material: () => boolean
  undo: () => Move | null
  fen: () => string
  history: () => string[]
}
type ChessCtor = new (fen?: string) => ChessGame

/** Loads chess.js and engine.js exactly as the page does (plain scripts), in an isolated context. */
function loadLibs(): { Chess: ChessCtor; chooseMove: (g: ChessGame, color: string, depth: number) => Move | null } {
  const ctx: Record<string, unknown> = {}
  runInNewContext(read('js/chess.js') + '\nthis.Chess = Chess;', ctx)
  runInNewContext(read('js/engine.js') + '\nthis.chooseMove = chooseMove;', ctx)
  return ctx as never
}

describe('Chess bundle (resources/games/chess)', () => {
  it('has every file the page needs, and the page references only local files', () => {
    const html = read('index.html')
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '')
    expect(refs.length).toBeGreaterThanOrEqual(6)
    for (const r of refs) {
      expect(r).not.toMatch(/^(https?:)?\/\//)
      expect(existsSync(join(DIR, r))).toBe(true)
    }
    for (const f of ['js/app.js', 'js/engine.js', 'js/chess.js', 'js/chessboard.js', 'js/jquery-3.5.1.js', 'css/app.css', 'css/chessboard.css']) expect(existsSync(join(DIR, f))).toBe(true)
    for (const c of ['w', 'b']) for (const k of ['K', 'Q', 'R', 'B', 'N', 'P']) expect(existsSync(join(DIR, `img/pieces/${c}${k}.svg`))).toBe(true)
  })

  it('app.js points the board at the local piece SVGs (no upstream piece images, no network)', () => {
    const app = read('js/app.js')
    expect(app).toContain("pieceTheme: 'img/pieces/{piece}.svg'")
    expect(existsSync(join(DIR, 'img/chesspieces'))).toBe(false)
    expect(read('js/jquery-3.5.1.js')).not.toMatch(/XMLHttpRequest/)
  })

  it('keeps the licence notices (chess-ai MIT, chessboard.js MIT, chess.js BSD-2-Clause, jQuery MIT)', () => {
    expect(read('LICENSE')).toMatch(/Permission is hereby granted/)
    expect(read('LICENSES/chessboardjs-MIT.txt')).toMatch(/Permission is hereby granted/)
    expect(read('LICENSES/jquery-MIT.txt')).toMatch(/Permission is hereby granted/)
    expect(read('LICENSES/chessjs-BSD-2-Clause.txt')).toMatch(/Redistributions of source code must retain/)
    expect(read('js/chess.js')).toMatch(/Redistributions of source code must retain/)
  })

  it('the rules library loads and plays scholar\'s mate', () => {
    const { Chess } = loadLibs()
    const g = new Chess()
    for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) expect(g.move(m)).not.toBeNull()
    expect(g.in_checkmate()).toBe(true)
    expect(g.game_over()).toBe(true)
    expect(g.turn()).toBe('b')
    expect(g.undo()).not.toBeNull()
    expect(g.game_over()).toBe(false)
  })

  it('recognises a stalemate, an insufficient-material draw, and refuses an illegal move', () => {
    const { Chess } = loadLibs()
    const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
    expect(stale.in_stalemate()).toBe(true)
    expect(stale.in_checkmate()).toBe(false)
    expect(new Chess('8/8/4k3/8/8/3K4/8/8 w - - 0 1').insufficient_material()).toBe(true)
    expect(new Chess().move({ from: 'e2', to: 'e5', promotion: 'q' })).toBeNull()
  })

  it('the bundled engine returns a legal move at every level and takes a free queen', () => {
    const { Chess, chooseMove } = loadLibs()
    for (const depth of [1, 2]) {
      const g = new Chess()
      const m = chooseMove(g, 'w', depth)
      expect(m).not.toBeNull()
      expect(g.moves()).toContain(g.move(m as Move)?.san)
    }
    // White rook on a1 can capture an undefended black queen on a8; depth 1 must see it.
    const g = new Chess('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1')
    const m = chooseMove(g, 'w', 1) as Move
    expect(`${m.from}${m.to}`).toBe('a1a8')
    // no legal move (stalemate) -> null, never a crash
    expect(chooseMove(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'b', 1)).toBeNull()
  })

  it('passes the audit and is listed in the manifest and the licence record', () => {
    const a = auditGameFolder(DIR, { entry: 'index.html' })
    expect(a.failures).toEqual([])
    const parsed = validateManifest(JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as unknown)
    const g = parsed.games.find((x) => x.id === 'chess')
    expect(g).toBeDefined()
    expect(g?.licence).toBe('MIT')
    expect(g?.tags).toContain('chess')
    expect(readFileSync(resolve(ROOT, '../../docs/THIRD_PARTY_GAMES.md'), 'utf8')).toContain('`chess`')
    expect(readFileSync(join(ROOT, 'THIRD_PARTY.txt'), 'utf8')).toContain('`chess`')
  })
})
