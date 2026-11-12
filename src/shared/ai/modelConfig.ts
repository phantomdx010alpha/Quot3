/**
 * Phase 222 (M22) - the ONE place that says which embedding model Quot3 uses and how (pure data + tiny helpers).
 * MILESTONE22_DESIGN 4. Everything here marked [A] is unconfirmed: the default model, the file list, the revision and
 * the thresholds are set from the owner's bake-off (`tools/ai-bakeoff.mjs`) and filled in by `tools/fetch-ai-model.mjs`.
 * The model files are NEVER in the repo or the zip and are never downloaded at runtime.
 */
export type EmbedKind = 'query' | 'passage'

export interface ModelFile {
  /** Path inside the model folder, forward slashes. */
  path: string
  /** Lower-case hex SHA-256. '' = not pinned yet: `tools/fetch-ai-model.mjs` prints the real value for the owner to paste here. */
  sha256: string
}

export interface ModelThresholds {
  /** Cosine at or above which a party-history line may be shown (tier 3). */
  history: number
  /** Cosine at or above which two item groups may be proposed as a merge on the Items page. */
  group: number
  /** Cosine at or above which a bill is re-ranked up in plain-sentence search. */
  sentence: number
}

export interface ModelConfig {
  /** Folder name under `resources/ai-models/` and the vector-cache key. */
  id: string
  /** Hugging Face repo the files come from. */
  repo: string
  /** Pinned commit of that repo ('' = not pinned yet [A]; the fetch tool then refuses unless told to resolve it). */
  revision: string
  dim: number
  dtype: 'int8' | 'fp32'
  /** Prefix put in front of text before embedding. e5 REQUIRES these; MiniLM uses none. */
  prefix: Readonly<Record<EmbedKind, string>>
  pooling: 'mean' | 'cls'
  normalize: boolean
  /** Longest text sent to the model, in tokens (item names are short; this only caps abuse). */
  maxTokens: number
  /** SPDX id of the upstream licence; must be permissive before the model ships. */
  licence: string
  /** True once a person has read the model card and confirmed the licence text. */
  licenceConfirmed: boolean
  thresholds: ModelThresholds
  files: readonly ModelFile[]
}

const TOKENIZER_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']

/** Default model [A1]: multilingual-e5-small, int8, 384 dims. Thresholds are conservative until the bake-off [A4]. */
export const E5_SMALL: ModelConfig = {
  id: 'multilingual-e5-small',
  repo: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dim: 384,
  dtype: 'int8',
  prefix: { query: 'query: ', passage: 'passage: ' },
  pooling: 'mean',
  normalize: true,
  maxTokens: 64,
  licence: 'MIT',
  // Confirmed by the owner on 2026-11-12 from the MIT licence text on Hugging Face (see docs/THIRD_PARTY_AI.md).
  licenceConfirmed: true,
  thresholds: { history: 0.9, group: 0.92, sentence: 0.88 },
  // Pinned in Phase 231 follow-up from the owner's own `--allow-unpinned` run (model-manifest.json, 2026-11-12).
  files: [
    { path: 'config.json', sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' },
    { path: 'tokenizer.json', sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
    { path: 'tokenizer_config.json', sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' },
    { path: 'special_tokens_map.json', sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7' },
    { path: 'onnx/model_quantized.onnx', sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' }
  ]
}

/** Bake-off candidates [A]. Not shipped; `tools/ai-bakeoff.mjs` compares them on the owner's own item names. */
export const MINILM_L6: ModelConfig = {
  id: 'all-MiniLM-L6-v2',
  repo: 'Xenova/all-MiniLM-L6-v2',
  revision: '',
  dim: 384,
  dtype: 'int8',
  prefix: { query: '', passage: '' },
  pooling: 'mean',
  normalize: true,
  maxTokens: 64,
  licence: 'Apache-2.0',
  licenceConfirmed: false,
  thresholds: { history: 0.75, group: 0.8, sentence: 0.7 },
  files: [...TOKENIZER_FILES, 'onnx/model_quantized.onnx'].map((path) => ({ path, sha256: '' }))
}

/** Granite multilingual: licence and dimension both unconfirmed [A]; must be checked before it could ever ship. */
export const GRANITE_97M: ModelConfig = {
  id: 'granite-embedding-97m-multilingual-r2',
  repo: 'ibm-granite/granite-embedding-97m-multilingual-r2',
  revision: '',
  dim: 384,
  dtype: 'fp32',
  prefix: { query: '', passage: '' },
  pooling: 'cls',
  normalize: true,
  maxTokens: 64,
  licence: 'Apache-2.0',
  licenceConfirmed: false,
  thresholds: { history: 0.75, group: 0.8, sentence: 0.7 },
  files: [...TOKENIZER_FILES, 'onnx/model.onnx'].map((path) => ({ path, sha256: '' }))
}

export const MODEL_CANDIDATES: readonly ModelConfig[] = [E5_SMALL, MINILM_L6, GRANITE_97M]
export const DEFAULT_MODEL: ModelConfig = E5_SMALL

/** Licences the project accepts for a shipped model; anything else stops the phase and asks the owner. */
export const PERMISSIVE_LICENCES: readonly string[] = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause']
export const isPermissiveLicence = (spdx: string): boolean => PERMISSIVE_LICENCES.includes(spdx)

/** The text actually fed to the model: the prefix policy lives here, not scattered in callers. */
export const withPrefix = (cfg: ModelConfig, text: string, kind: EmbedKind): string => cfg.prefix[kind] + text

export const findModel = (id: string): ModelConfig | undefined => MODEL_CANDIDATES.find((m) => m.id === id)

/** Folder (relative to the app's resources) that holds a model's files. */
export const modelDir = (cfg: ModelConfig): string => `ai-models/${cfg.id}`

/** True when every file has a pinned SHA-256 and the revision is a full 40-hex commit (the fetch tool needs both to run unattended). */
export function isFullyPinned(cfg: ModelConfig): boolean {
  return /^[0-9a-f]{40}$/.test(cfg.revision) && cfg.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))
}
