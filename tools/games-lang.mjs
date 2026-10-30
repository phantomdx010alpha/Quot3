// Language classifier for vendored games (Milestone 20, Phase 205; REBUILT in Phase 206 because the file was missing from the
// uploaded 0.1.47 zip while its test, its .d.mts and the Phase 205 log all described it; rules: docs/MILESTONE20_DESIGN.md 4.1, A5).
// Counts CJK characters (ideographs, kana, hangul; NOT full-width punctuation) per game in .html .htm .js .mjs .css .json files.
// Comments and LICENSE files are ignored. "visible" = HTML text and attributes and CSS `content:` strings; "code" = everything else
// (script strings, data files, other CSS). A game is `en` when total <= EN_MAX_TOTAL and visible === 0, otherwise `zh` (A5 [A]).
// Plain Node, no dependencies, no network.
//   node tools/games-lang.mjs [<gamesRoot>] [--json]     prints a table (default root: resources/games next to this tool)
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EN_MAX_TOTAL = 10
const CJK_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]|[\u{20000}-\u{2fa1f}]/gu
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json'])

export function countCjk(s) {
  const m = String(s).match(CJK_G)
  return m ? m.length : 0
}

/** Removes comments outside strings. `//` comments only when opts.slashSlash !== false (CSS passes false). Naive about regex literals. */
export function stripCodeComments(src, opts = {}) {
  const slashSlash = opts.slashSlash !== false
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
      continue
    }
    if (slashSlash && c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++
        else if (src[j] === '\n' && c !== '`') break
        j++
      }
      out += src.slice(i, Math.min(j + 1, n))
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return out
}

/** Splits an HTML document into its visible part (comments, script and style bodies removed) and the script / style bodies. */
export function splitHtml(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '')
  const scripts = []
  const styles = []
  const visible = noComments
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (_m, body) => { scripts.push(body); return '<script></script>' })
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, body) => { styles.push(body); return '<style></style>' })
  return { visible, scripts, styles }
}

function classifyCss(css) {
  const stripped = stripCodeComments(css, { slashSlash: false })
  let visible = 0
  const rest = stripped.replace(/\bcontent\s*:\s*([^;}]*)/gi, (_m, value) => { visible += countCjk(value); return '' })
  return { visible, code: countCjk(rest) }
}

/** Classifies one file's text. `ext` includes the dot. */
export function classifyText(ext, text) {
  const e = ext.toLowerCase()
  if (e === '.html' || e === '.htm') {
    const { visible, scripts, styles } = splitHtml(text)
    let code = 0
    let vis = countCjk(visible)
    for (const s of scripts) code += countCjk(stripCodeComments(s))
    for (const s of styles) { const r = classifyCss(s); vis += r.visible; code += r.code }
    return { visible: vis, code }
  }
  if (e === '.css') return classifyCss(text)
  if (e === '.js' || e === '.mjs') return { visible: 0, code: countCjk(stripCodeComments(text)) }
  if (e === '.json') return { visible: 0, code: countCjk(text) }
  return { visible: 0, code: 0 }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = lstatSync(p)
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) walk(p, out)
    else if (st.isFile()) out.push(p)
  }
  return out
}

/** Classifies one game folder. */
export function classifyGameFolder(dir) {
  let visible = 0
  let code = 0
  for (const f of walk(dir)) {
    const ext = extname(f).toLowerCase()
    if (!TEXT_EXT.has(ext)) continue
    const r = classifyText(ext, readFileSync(f, 'utf8'))
    visible += r.visible
    code += r.code
  }
  const total = visible + code
  return { visible, code, total, lang: visible === 0 && total <= EN_MAX_TOTAL ? 'en' : 'zh' }
}

/** Classifies every sub folder of a games root (folders starting with `_` and plain files such as manifest.json are skipped). */
export function classifyGamesRoot(root) {
  const out = {}
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('_')) continue
    const p = join(root, name)
    if (!lstatSync(p).isDirectory()) continue
    out[name] = classifyGameFolder(p)
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2).filter((a) => a !== '--json')
  const root = args[0] ? resolve(args[0]) : resolve(dirname(fileURLToPath(import.meta.url)), '../resources/games')
  const all = classifyGamesRoot(root)
  if (process.argv.includes('--json')) { console.log(JSON.stringify(all, null, 1)); process.exit(0) }
  let en = 0
  for (const [id, r] of Object.entries(all)) {
    if (r.lang === 'en') en++
    console.log(`${id.padEnd(22)} ${r.lang}  visible ${String(r.visible).padStart(5)}  code ${String(r.code).padStart(5)}  total ${String(r.total).padStart(5)}`)
  }
  console.log(`${Object.keys(all).length} games, ${en} en, ${Object.keys(all).length - en} zh`)
}
