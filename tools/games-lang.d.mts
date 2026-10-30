// Types for tools/games-lang.mjs (Phase 205, M20), so src tests can import it under `strict`.
export const EN_MAX_TOTAL: number
export interface GameLangResult { visible: number; code: number; total: number; lang: 'en' | 'zh' }
export function countCjk(s: string): number
export function stripCodeComments(src: string, opts?: { slashSlash?: boolean }): string
export function splitHtml(html: string): { visible: string; scripts: string[]; styles: string[] }
export function classifyText(ext: string, text: string): { visible: number; code: number }
export function classifyGameFolder(dir: string): GameLangResult
export function classifyGamesRoot(root: string): Record<string, GameLangResult>
