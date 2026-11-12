// Phase 222 (M22) - the owner's model bake-off. Runs on the OWNER'S PC against a text file of his own item names (one per line, NO amounts, no party names).
//   node --experimental-strip-types tools/ai-bakeoff.mjs --names item-names.txt [--models multilingual-e5-small,all-MiniLM-L6-v2] [--samples 20] [--k 5] [--out report.txt]
// For each sample name it prints the nearest other names under each candidate model, so the owner can pick the model and the thresholds
// (src/shared/ai/modelConfig.ts). The model files must already be in resources/ai-models/<id>/ (tools/fetch-ai-model.mjs).
// The real-model part (`makeRealEmbedder`) needs `@huggingface/transformers`, which Phase 223 installs; it is NOT exercised in the sandbox [A].
// Never commits or prints anything but the names the owner supplied; nothing leaves the PC.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findModel, withPrefix, MODEL_CANDIDATES, DEFAULT_MODEL } from '../src/shared/ai/modelConfig.ts'
import { topK } from '../src/shared/ai/vectorMath.ts'

export const MAX_NAMES = 5000
/** A line that looks like money or a bill row (a currency sign, or a trailing 2-decimal number) is skipped: the export must be names only. */
export const looksLikeAmount = (line) => /[\u20b9$]|\brs\.?\s*\d|\binr\b|\d+\.\d{2}\s*$/i.test(line)

/** Parse the exported text: trim, drop empties and amount-looking lines, dedupe case-insensitively, cap. */
export function readNames(text, max = MAX_NAMES) {
  const seen = new Set()
  const names = []
  let skippedAmounts = 0
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line) continue
    if (looksLikeAmount(line)) { skippedAmounts++; continue }
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(line)
    if (names.length >= max) break
  }
  return { names, skippedAmounts }
}

/** Deterministic sample of n names (the same list always gives the same sample): evenly spaced picks. */
export function pickSamples(names, n) {
  if (n <= 0 || names.length === 0) return []
  if (names.length <= n) return [...names]
  const out = []
  for (let i = 0; i < n; i++) out.push(names[Math.floor((i * names.length) / n)])
  return out
}

/**
 * Nearest other names for each sample. `embed(texts) -> Promise<number[][]|Float32Array[]>`.
 * Stored names are embedded as passages, the sample as a query (the model's own prefix policy).
 */
export async function neighbours(cfg, embed, names, samples, k = 5) {
  const passages = await embed(names.map((n) => withPrefix(cfg, n, 'passage')))
  const queries = await embed(samples.map((s) => withPrefix(cfg, s, 'query')))
  return samples.map((sample, qi) => {
    const ranked = topK(queries[qi], names.map((name, i) => ({ name, vec: passages[i] })), (x) => x.vec, k + 1)
      .filter((r) => r.item.name.toLowerCase() !== sample.toLowerCase())
      .slice(0, k)
    return { sample, neighbours: ranked.map((r) => ({ name: r.item.name, score: Math.round(r.score * 1000) / 1000 })) }
  })
}

export function formatReport(results) {
  const lines = []
  for (const { modelId, rows } of results) {
    lines.push(`=== ${modelId} ===`)
    for (const r of rows) {
      lines.push(r.sample)
      for (const n of r.neighbours) lines.push(`    ${n.score.toFixed(3)}  ${n.name}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** The real embedder (owner's PC only, after Phase 223 installs the package) [A: untested in the sandbox]. */
export async function makeRealEmbedder(cfg, modelsRoot) {
  const tf = await import('@huggingface/transformers')
  tf.env.allowRemoteModels = false
  tf.env.localModelPath = modelsRoot
  const extractor = await tf.pipeline('feature-extraction', cfg.id, { dtype: cfg.dtype === 'int8' ? 'q8' : 'fp32' })
  return async (texts) => {
    const out = []
    for (const t of texts) {
      const r = await extractor(t, { pooling: cfg.pooling, normalize: cfg.normalize })
      out.push(Array.from(r.data))
    }
    return out
  }
}

function parseArgs(argv) {
  const a = { names: '', models: DEFAULT_MODEL.id, samples: 20, k: 5, out: '', modelsRoot: 'resources/ai-models' }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--names') a.names = argv[++i]
    else if (f === '--models') a.models = argv[++i]
    else if (f === '--samples') a.samples = Number(argv[++i])
    else if (f === '--k') a.k = Number(argv[++i])
    else if (f === '--out') a.out = argv[++i]
    else if (f === '--models-root') a.modelsRoot = argv[++i]
    else throw new Error(`unknown argument ${f}`)
  }
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.names) throw new Error(`usage: --names <file> [--models ${MODEL_CANDIDATES.map((m) => m.id).join(',')}]`)
  const { names, skippedAmounts } = readNames(readFileSync(args.names, 'utf8'))
  if (skippedAmounts) console.error(`skipped ${skippedAmounts} line(s) that look like amounts`)
  if (names.length < 2) throw new Error('need at least 2 item names')
  const samples = pickSamples(names, args.samples)
  const results = []
  for (const id of args.models.split(',').map((s) => s.trim()).filter(Boolean)) {
    const cfg = findModel(id)
    if (!cfg) throw new Error(`unknown model ${id}`)
    const embed = await makeRealEmbedder(cfg, resolve(args.modelsRoot))
    results.push({ modelId: id, rows: await neighbours(cfg, embed, names, samples, args.k) })
  }
  const report = formatReport(results)
  if (args.out) writeFileSync(args.out, report)
  else console.log(report)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1) })
}
