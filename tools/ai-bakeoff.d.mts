import type { ModelConfig } from '../src/shared/ai/modelConfig'
export const MAX_NAMES: number
export function looksLikeAmount(line: string): boolean
export function readNames(text: string, max?: number): { names: string[]; skippedAmounts: number }
export function pickSamples(names: readonly string[], n: number): string[]
export type EmbedFn = (texts: string[]) => Promise<ArrayLike<number>[]>
export interface NeighbourRow { sample: string; neighbours: { name: string; score: number }[] }
export function neighbours(cfg: ModelConfig, embed: EmbedFn, names: readonly string[], samples: readonly string[], k?: number): Promise<NeighbourRow[]>
export function formatReport(results: { modelId: string; rows: NeighbourRow[] }[]): string
export function makeRealEmbedder(cfg: ModelConfig, modelsRoot: string): Promise<EmbedFn>
