// Types for tools/games-i18n.mjs (Phase 206, M20), so src tests can import it under `strict`.
export type I18nKind = 'text' | 'attr' | 'js' | 'css' | 'json' | 'other'
export const KINDS: I18nKind[]
export interface WorksheetEntry { file: string; kind: I18nKind; line: number; zh: string; en: string; risky?: boolean; note?: string; onlyLine?: boolean }
export interface Worksheet { version: number; game: string; entries: WorksheetEntry[] }
export interface I18nOptions { worksheetPath?: string; patchDir?: string; repoRoot?: string }
export interface ScanSeg { kind: I18nKind; start: number; end: number; quote: string; line: number; raw: string; dec: string }
export const REPO_ROOT: string
export function scanText(ext: string, text: string): { segs: ScanSeg[]; scripts: { start: number; end: number; isModule: boolean }[]; commentCjk: number }
export function worksheetPathFor(dir: string, opts?: I18nOptions): string
export function patchPathFor(dir: string, opts?: I18nOptions): string
export function writeWorksheet(path: string, ws: Worksheet): void
export function validateWorksheet(ws: unknown, id: string, dir?: string): string[]
export function unifiedDiff(rel: string, oldText: string, edits: { start: number; end: number; text: string }[]): string
export function extractGame(dir: string, opts?: I18nOptions): { ok: boolean; errors?: string[]; path?: string; added?: number; total?: number; empty?: number; risky?: number }
export function applyGame(dir: string, opts?: I18nOptions): { ok: boolean; status: 'applied' | 'already applied' | 'refused'; errors?: string[]; replaced?: number; already?: number; langFixed?: number; files?: string[]; patch?: string }
export interface CheckLeftover { file: string; line: number; kind: string; text: string }
export function checkGame(dir: string, opts?: I18nOptions): { ok: boolean; id: string; leftovers: CheckLeftover[]; warnings: string[]; commentCjk: number; audit: { ok: boolean; failures: { rule: string; file: string; line: number; text: string }[]; warnings: unknown[] } }
