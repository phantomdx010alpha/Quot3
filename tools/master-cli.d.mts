export const COMMANDS: string[]
export const SEAT_ALPHABET: string
export const SEATS_MAX: number
export const COMPANY_SQL_FIRST: number
export const COMPANY_SQL_LAST: number
export const FUNCTION_NAMES: string[]
export class CliError extends Error {}
export interface ParsedArgs { command: string; positional: string[]; flags: Record<string, string | true> }
export function parseArgs(argv: string[]): ParsedArgs
export function orderCompanySqlFiles(names: string[]): string[]
export function projectRefFromUrl(url: string): string | null
export function normaliseUrl(u: string): string
export function redactCliOutput(text: string, known?: string[]): string
export function b64urlEncode(bytes: Uint8Array): string
export function b64urlDecode(text: string): Uint8Array
export function keyFromBase64Url(text: string): Uint8Array
export function generateKek(random?: (n: number) => Uint8Array): string
export function sha256Hex(text: string): Promise<string>
export function sealText(key: Uint8Array, plain: string, aad?: string, random?: (n: number) => Uint8Array): Promise<string>
export function looksSealed(t: string): boolean
export function checkChar(payload15: string): string
export function generateSeatCode(bytes: Uint8Array): string
export function seatCodeChars(code: string): string
export function uuidFromBytes(b: Uint8Array): string
export interface CliFetchResponse { ok: boolean; status: number; text(): Promise<string> }
export interface CliIo {
  env?: Record<string, string | undefined>
  cwd: string
  fetchImpl: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<CliFetchResponse>
  now: () => Date
  randomBytes: (n: number) => Uint8Array
  readFile: (path: string) => string
  listDir: (path: string) => string[]
  writeFile: (path: string, text: string) => void
  print: (text: string) => void
  printSecret: (text: string) => void
  bundle?: (outDir?: string | true) => Promise<void>
  log?: (text: string) => void
}
export function mintEnrolToken(a: { io: CliIo; masterUrl: string; masterKey: string; label: string; hours?: number }): Promise<{ token: string; expiresAt: string }>
export function validateOnboard(a: { label?: string; seats?: unknown; url?: string; anon?: string; serviceRole?: string }): { label: string; seats: number; url: string; anon: string; serviceRole: string }
export function exportMaster(a: { io: CliIo; masterUrl: string; masterKey: string; includeSealed?: boolean }): Promise<{ format: string; version: number; exportedAt: string; sealed: boolean; companies: Record<string, unknown>[]; seats: Record<string, unknown>[] }>
export function keepalive(a: { io: CliIo; url: string; key: string }): Promise<{ status: number }>
export function initText(a: { kek: string; pepper: string }): string
export const HELP: string
export function main(argv: string[], io: CliIo): Promise<number>
