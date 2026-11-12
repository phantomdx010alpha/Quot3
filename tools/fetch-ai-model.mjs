// Phase 222 (M22) - downloads the pinned embedding model into resources/ai-models/<modelId>/ and checks every SHA-256.
// Run by the OWNER on Windows and by the GitHub Action before the build. NEVER run in the Claude.ai sandbox (it cannot reach huggingface.co).
//   node --experimental-strip-types tools/fetch-ai-model.mjs [--model <id>] [--out <dir>] [--allow-unpinned] [--skip-if-unpinned]
// --skip-if-unpinned (the release workflow): while the model is not pinned yet, print a notice and exit 0 so a release is never blocked; the installer then ships without the model and the app shows "not installed".
// Pinned run (default): needs a 40-hex revision and a SHA-256 per file in src/shared/ai/modelConfig.ts; a mismatch deletes the file and exits 1.
// --allow-unpinned (the owner's FIRST run only): downloads from `main`, prints the commit and every SHA-256 to paste into modelConfig.ts, still writes the files.
// Nothing here runs at app runtime. Model files are never committed (resources/ai-models/ is in .gitignore).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MODEL, findModel, isFullyPinned, isPermissiveLicence } from '../src/shared/ai/modelConfig.ts'

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The download address of one file at one revision. */
export const hfUrl = (repo, revision, path) => `https://huggingface.co/${repo}/resolve/${revision || 'main'}/${path}`

/** What stops a run before any download: an unpermissive licence, or (without --allow-unpinned) a missing pin. Returns a list of problems. */
export function planProblems(cfg, { allowUnpinned = false } = {}) {
  const problems = []
  if (!isPermissiveLicence(cfg.licence)) problems.push(`licence ${cfg.licence} is not on the permissive list; ask the owner before shipping ${cfg.id}`)
  if (!allowUnpinned && !isFullyPinned(cfg)) problems.push(`${cfg.id} is not fully pinned (revision + a SHA-256 per file); run once with --allow-unpinned and paste the printed values into src/shared/ai/modelConfig.ts`)
  for (const f of cfg.files) if (f.path.startsWith('/') || f.path.includes('..')) problems.push(`unsafe file path: ${f.path}`)
  return problems
}

/**
 * Fetch every file of `cfg` into `<outRoot>/<id>/`. `fetchImpl(url)` must return { ok, status, headers.get(), arrayBuffer() } (the global fetch fits).
 * Existing files whose hash matches are kept. Returns { revision, files: [{ path, sha256, bytes, status }] } or throws on a mismatch (the bad file is removed).
 */
export async function fetchModel(cfg, { outRoot, fetchImpl = fetch, allowUnpinned = false, log = () => {} }) {
  const problems = planProblems(cfg, { allowUnpinned })
  if (problems.length) throw new Error(problems.join('\n'))
  const dir = join(outRoot, cfg.id)
  mkdirSync(dir, { recursive: true })
  const pinned = isFullyPinned(cfg)
  let revision = cfg.revision
  const done = []
  for (const f of cfg.files) {
    const target = join(dir, ...f.path.split('/'))
    if (pinned && existsSync(target) && sha256Hex(readFileSync(target)) === f.sha256) {
      done.push({ path: f.path, sha256: f.sha256, bytes: readFileSync(target).length, status: 'kept' })
      log(`kept ${f.path}`)
      continue
    }
    const res = await fetchImpl(hfUrl(cfg.repo, revision, f.path))
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${f.path}`)
    if (!revision) revision = res.headers?.get?.('x-repo-commit') || ''
    const bytes = Buffer.from(await res.arrayBuffer())
    const actual = sha256Hex(bytes)
    if (pinned && actual !== f.sha256) throw new Error(`SHA-256 mismatch for ${f.path}: expected ${f.sha256}, got ${actual}. File not written.`)
    mkdirSync(dirname(target), { recursive: true })
    const part = `${target}.part`
    writeFileSync(part, bytes)
    renameSync(part, target)
    done.push({ path: f.path, sha256: actual, bytes: bytes.length, status: 'downloaded' })
    log(`${pinned ? 'verified' : 'downloaded'} ${f.path} (${bytes.length} bytes)`)
  }
  const manifest = { id: cfg.id, repo: cfg.repo, revision, files: done.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) }
  writeFileSync(join(dir, 'model-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { revision, files: done }
}

/** The lines the owner pastes into modelConfig.ts after an --allow-unpinned run. */
export function pinReport(cfg, result) {
  const lines = [`// ${cfg.id}`, `revision: '${result.revision || '(unknown: read it on the model page)'}'`]
  for (const f of result.files) lines.push(`{ path: '${f.path}', sha256: '${f.sha256}' }`)
  return lines.join('\n')
}

/** True when the run should be skipped quietly: unpinned model AND --skip-if-unpinned (never together with --allow-unpinned). */
export const shouldSkip = (cfg, { skipIfUnpinned = false, allowUnpinned = false } = {}) => skipIfUnpinned && !allowUnpinned && !isFullyPinned(cfg)

function parseArgs(argv) {
  const a = { model: DEFAULT_MODEL.id, out: 'resources/ai-models', allowUnpinned: false, skipIfUnpinned: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') a.model = argv[++i]
    else if (argv[i] === '--out') a.out = argv[++i]
    else if (argv[i] === '--allow-unpinned') a.allowUnpinned = true
    else if (argv[i] === '--skip-if-unpinned') a.skipIfUnpinned = true
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cfg = findModel(args.model)
  if (!cfg) throw new Error(`unknown model ${args.model}`)
  if (shouldSkip(cfg, args)) { console.log(`NOTICE: ${cfg.id} is not pinned yet (revision + SHA-256s); skipping the model download. The installer will not contain the AI model.`); return }
  const result = await fetchModel(cfg, { outRoot: resolve(args.out), allowUnpinned: args.allowUnpinned, log: (m) => console.log(m) })
  if (args.allowUnpinned && !isFullyPinned(cfg)) console.log('\nPaste into src/shared/ai/modelConfig.ts:\n' + pinReport(cfg, result))
  console.log(`\nDone: ${result.files.length} files in ${join(args.out, cfg.id)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1) })
}
