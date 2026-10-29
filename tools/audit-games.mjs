// Audit tool for vendored games (Milestone 19, Phase 197; rules: docs/MILESTONE19_DESIGN.md section 3.4).
// Plain Node, no dependencies, no network. Used by the owner / Claude before a game is added, and by the permanent
// guard test over the real resources/games folder (Phase 199+).
//   node tools/audit-games.mjs <gameFolder>            audit one game folder
//   node tools/audit-games.mjs --root <gamesRoot>      audit every sub folder of resources/games (manifest.json is skipped)
// Exit code 1 = at least one FAIL. Warnings (plain links in text) are listed for review and never fail by themselves.
import { lstatSync, readdirSync, readFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { join, extname, basename, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md', '.xml', '.map', '.webmanifest'])
const CODE_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.svg'])
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif', '.mp3', '.ogg', '.wav', '.m4a', '.webm', '.mp4', '.woff', '.woff2', '.ttf', '.otf', '.wasm', '.cur'])
const NO_EXT_OK = new Set(['license', 'licence', 'copying', 'notice', 'authors', 'readme'])

// Strings that mark a tracker, an ad network or an analytics snippet.
const TRACKERS = /(googletagmanager|google-analytics|gtag\s*\(|adsbygoogle|doubleclick|mixpanel|sentry\.io|Sentry\.init|segment\.com|hotjar|clarity\.ms|facebook\.net|fbq\s*\(|plausible\.io|matomo|umami)/i
// Namespace / doctype URLs are identifiers, not network requests.
const IGNORABLE_URL = /https?:\/\/(www\.)?w3\.org\//i

const FAIL_RULES = [
  { id: 'remote-src', re: /\b(src|srcset|poster|data|action|formaction|manifest)\s*=\s*["']?\s*(https?:)?\/\/(?!(www\.)?w3\.org)/i, text: 'remote script / image / media / frame reference' },
  { id: 'remote-link-tag', re: /<link\b[^>]*\bhref\s*=\s*["']?\s*(https?:)?\/\//i, text: 'remote stylesheet / font / icon <link>' },
  { id: 'remote-css-url', re: /\burl\(\s*["']?\s*(https?:)?\/\/(?!(www\.)?w3\.org)/i, text: 'remote url() in CSS or inline style' },
  { id: 'remote-css-import', re: /@import\s+(url\(\s*)?["']?\s*(https?:)?\/\//i, text: 'remote @import' },
  { id: 'remote-js-import', re: /\bimport\b[^;\n]*["'](https?:)?\/\/|\bimport\s*\(\s*["'](https?:)?\/\//i, text: 'remote ES module import' },
  { id: 'importScripts', re: /\bimportScripts\s*\(/, text: 'importScripts (workers may only load local files: patch to a local path and re-audit)' },
  { id: 'fetch', re: /(^|[^\w$.])fetch\s*\(/, text: 'fetch(' },
  { id: 'xhr', re: /\bXMLHttpRequest\b/, text: 'XMLHttpRequest' },
  { id: 'websocket', re: /\b(Web)?Socket\s*\(\s*["'`]|\bnew\s+WebSocket\b|\bEventSource\s*\(/, text: 'WebSocket / EventSource' },
  { id: 'sendBeacon', re: /\bsendBeacon\b/, text: 'navigator.sendBeacon' },
  { id: 'eval', re: /(^|[^\w$.])eval\s*\(/, text: 'eval(' },
  { id: 'new-function', re: /\bnew\s+Function\s*\(/, text: 'new Function(' },
  { id: 'cookie-write', re: /\bdocument\.cookie\s*=(?!=)/, text: 'document.cookie write' },
  { id: 'window-open', re: /\bwindow\.open\s*\(|(^|[^\w$.])open\s*\(\s*["'](https?:)?\/\//, text: 'window.open' },
  { id: 'navigate-away', re: /\b(location|document\.location|window\.location|top\.location|parent\.location)(\.href)?\s*=\s*["'`](https?:)?\/\/|\blocation\.(assign|replace)\s*\(\s*["'`](https?:)?\/\//, text: 'navigates to another origin' },
  { id: 'tracker', re: TRACKERS, text: 'analytics / ad / tracking snippet' }
]
const WARN_URL = /(https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"'<>)]*/i

function isBinaryExecutable(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const b = Buffer.alloc(4)
    const n = readSync(fd, b, 0, 4, 0)
    if (n < 4) return false
    if (b[0] === 0x4d && b[1] === 0x5a) return true // MZ (Windows PE)
    if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return true // ELF
    const m = b.readUInt32BE(0)
    if (m === 0xcafebabe || m === 0xfeedface || m === 0xfeedfacf || m === 0xcffaedfe || m === 0xcefaedfe) return true // Mach-O / Java class
    return false
  } catch { return false } finally { if (fd !== undefined) closeSync(fd) }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = lstatSync(p)
    if (st.isSymbolicLink()) { out.push({ path: p, symlink: true, size: 0 }); continue }
    if (st.isDirectory()) walk(p, out)
    else out.push({ path: p, size: st.size })
  }
  return out
}

function looksMinified(text, size) {
  if (size < 5000) return false
  const lines = text.split('\n')
  const avg = size / Math.max(1, lines.length)
  return avg > 400 || lines.some((l) => l.length > 5000)
}

/**
 * Audits one game folder. Returns { ok, failures[], warnings[], files }.
 * A finding is { rule, file (relative, forward slashes), line (1-based or 0), text }.
 * opts.entry: relative path of the game's entry html, which must exist.
 */
export function auditGameFolder(dir, opts = {}) {
  const failures = []
  const warnings = []
  const add = (list, rule, file, line, text) => list.push({ rule, file: file.split(sep).join('/'), line, text })
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    add(failures, 'folder', basename(dir), 0, 'game folder does not exist')
    return { ok: false, failures, warnings, files: 0 }
  }
  const files = walk(dir)
  const rel = (p) => relative(dir, p)
  const hasLicense = files.some((f) => !f.symlink && dirname0(rel(f.path)) && /^(license|licence|copying)(\.(txt|md))?$/i.test(basename(f.path)))
  if (!hasLicense) add(failures, 'no-license', '.', 0, 'the game folder has no LICENSE file at its top level')
  if (opts.entry && !files.some((f) => !f.symlink && rel(f.path).split(sep).join('/') === opts.entry)) add(failures, 'entry-missing', opts.entry, 0, 'entry file does not exist')

  for (const f of files) {
    const r = rel(f.path)
    const ext = extname(f.path).toLowerCase()
    const base = basename(f.path).toLowerCase()
    if (f.symlink) { add(failures, 'symlink', r, 0, 'symbolic links are not allowed'); continue }
    if (f.size > MAX_FILE_BYTES) add(failures, 'too-large', r, 0, `file is ${(f.size / 1048576).toFixed(1)} MB (limit 25 MB)`)
    if (ext === '') { if (!NO_EXT_OK.has(base)) add(failures, 'file-type', r, 0, 'file without an extension that is not a licence / readme') }
    else if (!TEXT_EXT.has(ext) && !ASSET_EXT.has(ext)) add(failures, 'file-type', r, 0, `file type ${ext} is not allowed (only html, css, js, json, text, images, audio, fonts, wasm)`)
    if (ext !== '.wasm' && isBinaryExecutable(f.path)) add(failures, 'executable', r, 0, 'looks like an executable binary')
    if (!TEXT_EXT.has(ext) && !(ext === '' && NO_EXT_OK.has(base))) continue
    let text
    try { text = readFileSync(f.path, 'utf8') } catch { continue }
    if ((ext === '.js' || ext === '.mjs') && looksMinified(text, f.size)) {
      const sib = f.path.replace(/\.min\.(m?js)$/i, '.$1')
      if (sib === f.path || !existsSync(sib)) add(failures, 'minified-only', r, 0, 'minified code with no readable source file next to it')
    }
    if (!CODE_EXT.has(ext)) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Namespace attributes (xmlns, xmlns:xlink) are identifiers, not requests.
      const line = lines[i].replace(/\bxmlns(:\w+)?\s*=\s*["'][^"']*["']/gi, '')
      if (line.length > 20000) { add(warnings, 'long-line', r, i + 1, 'line longer than 20000 characters was not scanned in full'); }
      const scan = line.length > 20000 ? line.slice(0, 20000) : line
      let failed = false
      for (const rule of FAIL_RULES) {
        if (rule.re.test(scan)) { add(failures, rule.id, r, i + 1, `${rule.text}: ${scan.trim().slice(0, 140)}`); failed = true }
      }
      if (!failed) {
        const m = scan.match(WARN_URL)
        if (m && !IGNORABLE_URL.test(m[0])) add(warnings, 'plain-link', r, i + 1, `link in text or comment (review): ${m[0].slice(0, 100)}`)
      }
    }
  }
  return { ok: failures.length === 0, failures, warnings, files: files.length }
}

// helper kept separate so the LICENSE check only counts a top-level file
function dirname0(r) { return !r.includes(sep) }

/** Audits every sub folder of a games root (resources/games). Folders starting with "_" (self-test) are audited too. */
export function auditGamesRoot(root) {
  const results = {}
  for (const name of readdirSync(root).sort()) {
    const p = join(root, name)
    if (!lstatSync(p).isDirectory()) continue
    results[name] = auditGameFolder(p)
  }
  return results
}

function print(name, r) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name}  (${r.files} files, ${r.failures.length} failures, ${r.warnings.length} warnings)`)
  for (const f of r.failures) console.log(`   FAIL [${f.rule}] ${f.file}${f.line ? ':' + f.line : ''}  ${f.text}`)
  for (const w of r.warnings) console.log(`   warn [${w.rule}] ${w.file}${w.line ? ':' + w.line : ''}  ${w.text}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.length === 0) { console.log('usage: node tools/audit-games.mjs <gameFolder> | --root <gamesRoot>'); process.exit(2) }
  let bad = 0
  if (args[0] === '--root') {
    const res = auditGamesRoot(args[1])
    for (const [n, r] of Object.entries(res)) { print(n, r); if (!r.ok) bad++ }
  } else {
    const r = auditGameFolder(args[0]); print(args[0], r); if (!r.ok) bad++
  }
  process.exit(bad ? 1 : 0)
}
