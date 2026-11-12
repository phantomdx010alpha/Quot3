import type { ModelConfig } from '../src/shared/ai/modelConfig'
export function sha256Hex(bytes: Uint8Array): string
export function hfUrl(repo: string, revision: string, path: string): string
export function planProblems(cfg: ModelConfig, opts?: { allowUnpinned?: boolean }): string[]
export interface FetchedFile { path: string; sha256: string; bytes: number; status: 'kept' | 'downloaded' }
export interface FetchResult { revision: string; files: FetchedFile[] }
export interface FetchLike { ok: boolean; status: number; headers?: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }
export function fetchModel(cfg: ModelConfig, opts: { outRoot: string; fetchImpl?: (url: string) => Promise<FetchLike>; allowUnpinned?: boolean; log?: (m: string) => void }): Promise<FetchResult>
export function pinReport(cfg: ModelConfig, result: FetchResult): string
export function shouldSkip(cfg: ModelConfig, opts?: { skipIfUnpinned?: boolean; allowUnpinned?: boolean }): boolean
