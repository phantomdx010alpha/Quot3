// Translation tool for vendored games (Milestone 20, Phase 206; rules: docs/MILESTONE20_DESIGN.md 3 and 4.2, contract API_CONTRACTS.md M20-2).
// Plain Node, no dependencies, no network. A translation changes STRINGS ONLY: the tool replaces exact strings inside the right kind of
// context, never anything else, and keeps every change as a unified diff.
//   node tools/games-i18n.mjs extract <gameFolder>...            write / update docs/translations/<gameId>.json (zh filled, en empty)
//   node tools/games-i18n.mjs apply   <gameFolder> [worksheet]   replace every zh by its en; writes docs/patches/<gameId>-en.diff
//   node tools/games-i18n.mjs check   <gameFolder>...            leftovers, duplicate en, audit rules, <html lang>
// Exit codes: 0 ok / nothing to do, 1 a problem was found (leftovers, audit failure, apply refused; nothing was written), 2 usage error.
import { lstatSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs'
import { join, extname, basename, dirname, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { auditGameFolder } from './audit-games.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..')
export const KINDS = ['text', 'attr', 'js', 'css', 'json', 'other']
const SCAN_EXT = new Set(['.html', '.htm', '.svg', '.js', '.mjs', '.css', '.json'])
// Ideographs, kana, hangul (same set as tools/games-lang.mjs). CJK_ANY adds CJK / full-width punctuation: rejected inside an `en` text.
const CJK_ONE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]|[\u{20000}-\u{2fa1f}]/u
const CJK_ANY = /[\u3000-\u303f\uff00-\uffef]|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]|[\u{20000}-\u{2fa1f}]/u
const hasCjk = (s) => CJK_ONE.test(s)
const countCjk = (s) => { let n = 0; for (const ch of s) if (CJK_ONE.test(ch)) n++; return n }
const PLACEHOLDER = /\$\{[^}]*\}|\{[^{}\s]*\}|%[sdif]/g

// ---------------------------------------------------------------- string escapes

function decodeJs(raw) {
  if (!raw.includes('\\')) return raw
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r\n|[\s\S])/g, (_m, g, cp, u4, x2) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16))
    if (u4) return String.fromCharCode(parseInt(u4, 16))
    if (x2) return String.fromCharCode(parseInt(x2, 16))
    if (g === '\r\n' || g === '\n' || g === '\r' || g === '\u2028' || g === '\u2029') return ''
    if (g === 'n') return '\n'
    if (g === 't') return '\t'
    if (g === 'r') return '\r'
    if (g === 'b') return '\b'
    if (g === 'f') return '\f'
    if (g === 'v') return '\v'
    if (g === '0') return '\0'
    return g
  })
}
function encodeJs(text, quote) {
  let s = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  if (quote === '`') s = s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
  else if (quote) s = s.split(quote).join('\\' + quote)
  return s
}
function encodeHtmlText(text) {
  return text.replace(/&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)/g, '&amp;').replace(/</g, '&lt;')
}
function encodeHtmlAttr(text, quote) {
  const s = encodeHtmlText(text)
  if (quote === '"') return s.replace(/"/g, '&quot;')
  if (quote === "'") return s.replace(/'/g, '&#39;')
  return s
}

// ---------------------------------------------------------------- scanners
// Each scanner calls push({ kind, start, end, quote }) for a translatable piece (start/end are offsets of the CONTENT without quotes in the
// file text), onComment(text) for comments, and onScript(start, end) for inline script bodies. Pieces are decoded later by decodeSeg.

function makeLineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (pos) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo + 1
  }
}

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'new', 'throw', 'yield', 'await', 'instanceof'])
const IDENT_CH = /[\p{L}\p{N}_$]/u

function scanJs(src, base, ev, kindForStrings = 'js') {
  const n = src.length
  let prevSig = ''
  let prevWord = ''
  let pos = 0
  const out = ev.push

  function scanString(i, q) {
    let j = i + 1
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') j++
      else if (src[j] === '\n') break
      j++
    }
    out({ kind: kindForStrings, start: base + i + 1, end: base + Math.min(j, n), quote: q })
    return Math.min(j, n) + 1
  }
  function scanTemplate(i) {
    let j = i + 1
    let segStart = j
    const flush = (end) => { if (end > segStart) out({ kind: kindForStrings, start: base + segStart, end: base + end, quote: '`' }) }
    while (j < n) {
      const ch = src[j]
      if (ch === '\\') { j += 2; continue }
      if (ch === '`') { flush(j); return j + 1 }
      if (ch === '$' && src[j + 1] === '{') {
        flush(j)
        j = scanCode(j + 2, true)
        segStart = j
        continue
      }
      j++
    }
    flush(n)
    return n
  }
  function scanCode(i, untilBrace) {
    let depth = 0
    if (untilBrace) { prevSig = '('; prevWord = '' }
    let word = ''
    const endWord = () => { if (word) { prevWord = word; word = '' } }
    while (i < n) {
      const c = src[i]
      if (c === '/' && src[i + 1] === '/') {
        let e = i; while (e < n && src[e] !== '\n') e++
        ev.onComment(src.slice(i, e)); i = e; continue
      }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2
        ev.onComment(src.slice(i, end)); i = end; continue
      }
      if (c === '"' || c === "'") { endWord(); i = scanString(i, c); prevSig = 'a'; prevWord = ''; continue }
      if (c === '`') { endWord(); i = scanTemplate(i); prevSig = 'a'; prevWord = ''; continue }
      if (c === '/') {
        endWord()
        const regexOk = prevSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig) || REGEX_KEYWORDS.has(prevWord)
        if (regexOk) {
          let j = i + 1
          let inClass = false
          let ok = false
          while (j < n && src[j] !== '\n') {
            const ch = src[j]
            if (ch === '\\') { j += 2; continue }
            if (ch === '[') inClass = true
            else if (ch === ']') inClass = false
            else if (ch === '/' && !inClass) { ok = true; break }
            j++
          }
          if (ok) {
            const body = src.slice(i + 1, j)
            if (hasCjk(body)) out({ kind: 'other', start: base + i + 1, end: base + j, quote: '' })
            j++
            while (j < n && /[a-z]/i.test(src[j])) j++
            i = j; prevSig = 'a'; prevWord = ''; continue
          }
        }
        prevSig = '/'; prevWord = ''; i++; continue
      }
      if (c === '{') { depth++ } else if (c === '}') { if (untilBrace && depth === 0) return i + 1; depth-- }
      if (/\s/.test(c)) { endWord(); i++; continue }
      if (IDENT_CH.test(c) || (c.charCodeAt(0) > 0xd7ff && c.charCodeAt(0) < 0xe000)) {
        // a run of identifier characters; CJK inside it (identifier, property name, label) is reported as `other`
        let j = i
        while (j < n && (IDENT_CH.test(src[j]) || (src.charCodeAt(j) > 0xd7ff && src.charCodeAt(j) < 0xe000))) j++
        if (j === i) j = i + 1
        const w = src.slice(i, j)
        if (hasCjk(w)) out({ kind: 'other', start: base + i, end: base + j, quote: '' })
        word = w; endWord(); prevSig = 'a'; i = j; continue
      }
      endWord(); prevSig = c; prevWord = ''; i++
    }
    return n
  }
  pos = scanCode(pos, false)
}

function scanCss(src, base, ev) {
  const n = src.length
  let i = 0
  let declStart = 0
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2
      ev.onComment(src.slice(i, end)); i = end; continue
    }
    if (c === ';' || c === '{' || c === '}') { declStart = i + 1; i++; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (src[j] === '\n') break; j++ }
      const isContent = /(^|[\s;{])content\s*:[^;{}]*$/i.test(src.slice(declStart, i))
      ev.push({ kind: isContent ? 'css' : 'other', start: base + i + 1, end: base + Math.min(j, n), quote: c })
      i = Math.min(j, n) + 1; continue
    }
    if (hasCjk(c) || (c.charCodeAt(0) > 0xd7ff && c.charCodeAt(0) < 0xe000)) {
      let j = i
      while (j < n && !/[\s;{}(),:'"]/.test(src[j])) j++
      if (j === i) j = i + 1
      if (hasCjk(src.slice(i, j))) ev.push({ kind: 'other', start: base + i, end: base + j, quote: '' })
      i = j; continue
    }
    i++
  }
}

function scanJson(src, base, ev) {
  const n = src.length
  let i = 0
  while (i < n) {
    if (src[i] === '"') {
      let j = i + 1
      while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++ }
      let k = j + 1
      while (k < n && /\s/.test(src[k])) k++
      const isKey = src[k] === ':'
      ev.push({ kind: isKey ? 'other' : 'json', start: base + i + 1, end: base + Math.min(j, n), quote: '"' })
      i = j + 1; continue
    }
    i++
  }
}

function scanHtml(src, base, ev) {
  const n = src.length
  let i = 0
  let textStart = 0
  const flushText = (end) => {
    const t = src.slice(textStart, end)
    const lead = t.length - t.trimStart().length
    const trimmed = t.trim()
    if (trimmed) ev.push({ kind: 'text', start: base + textStart + lead, end: base + textStart + lead + trimmed.length, quote: '' })
  }
  while (i < n) {
    if (src[i] !== '<') { i++; continue }
    if (src.startsWith('<!--', i)) {
      flushText(i)
      const e = src.indexOf('-->', i + 4); const end = e < 0 ? n : e + 3
      ev.onComment(src.slice(i, end)); i = end; textStart = i; continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i); i = e < 0 ? n : e + 3; continue
    }
    if (/[A-Za-z]/.test(src[i + 1] || '')) {
      flushText(i)
      let j = i + 1
      while (j < n && !/[\s/>]/.test(src[j])) j++
      const name = src.slice(i + 1, j).toLowerCase()
      const attrs = {}
      while (j < n && src[j] !== '>') {
        if (/[\s/]/.test(src[j])) { j++; continue }
        let a = j
        while (j < n && !/[\s=>/]/.test(src[j])) j++
        const aname = src.slice(a, j)
        if (hasCjk(aname)) ev.push({ kind: 'other', start: base + a, end: base + j, quote: '' })
        while (j < n && /\s/.test(src[j])) j++
        if (src[j] === '=') {
          j++
          while (j < n && /\s/.test(src[j])) j++
          if (src[j] === '"' || src[j] === "'") {
            const q = src[j]
            const e = src.indexOf(q, j + 1); const end = e < 0 ? n : e
            ev.push({ kind: 'attr', start: base + j + 1, end: base + end, quote: q })
            attrs[aname.toLowerCase()] = src.slice(j + 1, end)
            j = end + 1
          } else {
            let e = j
            while (e < n && !/[\s>]/.test(src[e])) e++
            if (e > j) ev.push({ kind: 'attr', start: base + j, end: base + e, quote: '' })
            attrs[aname.toLowerCase()] = src.slice(j, e)
            j = e
          }
        }
      }
      const tagEnd = Math.min(j + 1, n)
      i = tagEnd; textStart = i
      if ((name === 'script' || name === 'style') && src[j - 1] !== '/') {
        const re = new RegExp('</' + name + '\\b', 'ig')
        re.lastIndex = tagEnd
        const m = re.exec(src)
        const bodyEnd = m ? m.index : n
        const body = src.slice(tagEnd, bodyEnd)
        if (name === 'style') scanCss(body, base + tagEnd, ev)
        else if (/json/i.test(attrs.type || '')) scanJson(body, base + tagEnd, ev)
        else {
          if (!attrs.src && !/^(text\/(template|html|x-)|application\/(x-)?template)/i.test(attrs.type || '')) ev.onScript(base + tagEnd, base + bodyEnd, /module/i.test(attrs.type || ''))
          if (/^(text\/(template|html|x-)|application\/(x-)?template)/i.test(attrs.type || '')) scanHtml(body, base + tagEnd, ev)
          else scanJs(body, base + tagEnd, ev)
        }
        i = bodyEnd; textStart = i
      }
      continue
    }
    // closing tag, doctype, processing instruction
    flushText(i)
    const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; textStart = i
  }
  flushText(n)
}

/** Scans one file's text. Returns { segs, scripts, commentCjk }; each seg has { kind, start, end, quote, line, raw, dec }. */
export function scanText(ext, text) {
  const e = ext.toLowerCase()
  const lineOf = makeLineIndex(text)
  const segs = []
  const scripts = []
  let commentCjk = 0
  const ev = {
    push: (s) => segs.push(s),
    onComment: (t) => { commentCjk += countCjk(t) },
    onScript: (start, end, isModule) => scripts.push({ start, end, isModule })
  }
  if (e === '.html' || e === '.htm' || e === '.svg') scanHtml(text, 0, ev)
  else if (e === '.js' || e === '.mjs') scanJs(text, 0, ev)
  else if (e === '.css') scanCss(text, 0, ev)
  else if (e === '.json') scanJson(text, 0, ev)
  for (const s of segs) {
    s.raw = text.slice(s.start, s.end)
    s.line = lineOf(s.start)
    s.dec = s.kind === 'js' || s.kind === 'css' ? decodeJs(s.raw) : s.kind === 'json' ? safeJsonDecode(s.raw) : s.raw
  }
  return { segs, scripts, commentCjk }
}
function safeJsonDecode(raw) { try { return JSON.parse('"' + raw + '"') } catch { return decodeJs(raw) } }

function encodeFor(seg, en) {
  switch (seg.kind) {
    case 'js': case 'css': return encodeJs(en, seg.quote)
    case 'json': return JSON.stringify(en).slice(1, -1)
    case 'text': return encodeHtmlText(en)
    case 'attr':
      if (!seg.quote && /[\s"'=<>`]/.test(en)) throw new Error(`an unquoted attribute value cannot hold "${en}"`)
      return encodeHtmlAttr(en, seg.quote)
    default: return en
  }
}

// ---------------------------------------------------------------- files

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
function scanGame(dir) {
  const files = []
  for (const p of walk(dir)) {
    const ext = extname(p).toLowerCase()
    if (!SCAN_EXT.has(ext)) continue
    const rel = relative(dir, p).split(sep).join('/')
    const text = readFileSync(p, 'utf8')
    files.push({ rel, abs: p, ext, text, ...scanText(ext, text) })
  }
  return files
}

export function worksheetPathFor(dir, opts = {}) { return opts.worksheetPath ?? join(opts.repoRoot ?? REPO_ROOT, 'docs', 'translations', basename(resolve(dir)) + '.json') }
export function patchPathFor(dir, opts = {}) { return join(opts.patchDir ?? join(opts.repoRoot ?? REPO_ROOT, 'docs', 'patches'), basename(resolve(dir)) + '-en.diff') }

function serializeWorksheet(ws) {
  const head = `{ "version": ${ws.version}, "game": ${JSON.stringify(ws.game)},\n"entries": [\n`
  return head + ws.entries.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n] }\n'
}
export function writeWorksheet(path, ws) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, serializeWorksheet(ws)) }

// ---------------------------------------------------------------- extract

function riskHint(kind, text, seg) {
  if (kind !== 'js' && kind !== 'other') return ''
  const after = text.slice(seg.end + (seg.quote ? 1 : 0), seg.end + 40)
  const before = text.slice(Math.max(0, seg.start - 40), Math.max(0, seg.start - (seg.quote ? 1 : 0)))
  if (kind === 'other') return 'auto: Chinese in code outside a string (identifier, label or regex): do not change code; decide by reading'
  if (/^\s*\.(length|split|indexOf|lastIndexOf|includes|charAt|charCodeAt|slice|substr|substring|replace|startsWith|endsWith|match|search)\b|^\s*\[/.test(after)) return 'auto: the string is measured, split or indexed'
  if (/(===?|!==?|\bcase|\bin)\s*$/.test(before) || /^\s*(===?|!==?)/.test(after)) return 'auto: the string is compared'
  if (/(localStorage|sessionStorage)[^;]{0,30}$/.test(before)) return 'auto: the string is stored'
  return ''
}

/** extract: scans a game folder and writes / merges the worksheet. Never loses an existing entry. */
export function extractGame(dir, opts = {}) {
  const id = basename(resolve(dir))
  const path = worksheetPathFor(dir, opts)
  let ws = { version: 1, game: id, entries: [] }
  if (existsSync(path)) {
    try { ws = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { ok: false, errors: [`${path}: not valid JSON (${e.message})`] } }
    if (!ws || ws.game !== id || !Array.isArray(ws.entries)) return { ok: false, errors: [`${path}: not a worksheet of game ${id}`] }
  }
  const keyOf = (e) => `${e.file}\u0000${e.kind}\u0000${e.zh}\u0000${e.onlyLine ? e.line : ''}`
  const have = new Map(ws.entries.map((e) => [keyOf(e), e]))
  const added = []
  const seen = new Set()
  for (const f of scanGame(dir)) {
    for (const s of f.segs) {
      if (!CJK_ANY.test(s.dec)) continue
      const k = `${f.rel}\u0000${s.kind}\u0000${s.dec}\u0000`
      if (seen.has(k)) continue
      seen.add(k)
      const existing = have.get(k)
      if (existing) { existing.line = s.line; continue }
      const entry = { file: f.rel, kind: s.kind, line: s.line, zh: s.dec, en: '' }
      const hint = riskHint(s.kind, f.text, s)
      if (hint) { entry.risky = true; entry.note = hint }
      added.push(entry)
    }
  }
  ws.entries = [...ws.entries, ...added]
  if (added.length || !existsSync(path)) writeWorksheet(path, ws)
  return { ok: true, path, added: added.length, total: ws.entries.length, empty: ws.entries.filter((e) => !e.en).length, risky: ws.entries.filter((e) => e.risky).length }
}

// ---------------------------------------------------------------- apply

function placeholders(s) { return (s.match(PLACEHOLDER) ?? []).slice().sort().join('\u0001') }

export function validateWorksheet(ws, id, dir) {
  const errors = []
  if (!ws || typeof ws !== 'object' || !Array.isArray(ws.entries)) return ['the worksheet has no entries array']
  if (ws.game !== id) errors.push(`the worksheet is for game "${ws.game}", not "${id}"`)
  ws.entries.forEach((e, i) => {
    const at = `entry ${i + 1} (${e && e.file}:${e && e.line})`
    if (!e || typeof e.file !== 'string' || !KINDS.includes(e.kind) || typeof e.zh !== 'string' || !e.zh) { errors.push(`${at}: needs file, kind (${KINDS.join('/')}) and zh`); return }
    if (e.file.includes('..') || e.file.startsWith('/') || e.file.includes('\\')) errors.push(`${at}: the file path must stay inside the game folder`)
    else if (dir && !existsSync(join(dir, e.file))) errors.push(`${at}: file ${e.file} does not exist`)
    if (typeof e.en !== 'string' || !e.en.trim()) { errors.push(`${at}: en is empty`); return }
    if (CJK_ANY.test(e.en)) errors.push(`${at}: en still contains Chinese / CJK or full-width characters: ${e.en}`)
    if (/[\r\n]/.test(e.en)) errors.push(`${at}: en must be one line (use the code's own line breaks)`)
    if (placeholders(e.zh) !== placeholders(e.en)) errors.push(`${at}: placeholders differ between zh and en ({}, %s, \${...} must be kept exactly)`)
  })
  return errors
}

function applyEdits(text, edits) {
  const sorted = edits.slice().sort((a, b) => b.start - a.start)
  let out = text
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

function compileProblems(f, text) {
  const problems = []
  const compile = (code, label) => { try { new vm.Script(code, { filename: label }) } catch (e) { problems.push(`${label}: ${e.message}`) } }
  if (f.ext === '.js') compile(text, f.rel)
  else if (f.ext === '.html' || f.ext === '.htm') {
    const sc = scanText(f.ext, text)
    sc.scripts.forEach((s, i) => { if (!s.isModule) compile(text.slice(s.start, s.end), `${f.rel} <script #${i + 1}>`) })
  } else if (f.ext === '.json') { try { JSON.parse(text) } catch (e) { problems.push(`${f.rel}: ${e.message}`) } }
  return problems
}

function splitLines(text) {
  const noEol = !text.endsWith('\n')
  const lines = text.split('\n')
  if (!noEol) lines.pop()
  return { lines, noEol }
}

/** Unified diff of one file from its (sorted, non-overlapping) edits. */
export function unifiedDiff(rel, oldText, edits) {
  if (!edits.length) return ''
  const sorted = edits.slice().sort((a, b) => a.start - b.start)
  const { lines, noEol } = splitLines(oldText)
  const lineStart = [0]
  for (let i = 0; i < oldText.length; i++) if (oldText.charCodeAt(i) === 10) lineStart.push(i + 1)
  const lineAt = (pos) => { let lo = 0; let hi = lineStart.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStart[m] <= pos) lo = m; else hi = m - 1 } return lo }
  const lineEnd = (idx) => (idx + 1 < lineStart.length ? lineStart[idx + 1] - 1 : oldText.length)
  // groups of edits that touch the same lines
  const groups = []
  for (const e of sorted) {
    const a = lineAt(e.start)
    const b = lineAt(Math.max(e.start, e.end - 1))
    const g = groups[groups.length - 1]
    if (g && a <= g.b) { g.b = Math.max(g.b, b); g.edits.push(e) } else groups.push({ a, b, edits: [e] })
  }
  for (const g of groups) {
    const from = lineStart[g.a]
    const to = lineEnd(g.b)
    const local = g.edits.map((e) => ({ start: e.start - from, end: e.end - from, text: e.text }))
    g.newLines = applyEdits(oldText.slice(from, to), local).split('\n')
  }
  const CTX = 3
  const last = lines.length - 1
  const hunks = []
  for (const g of groups) {
    const h = hunks[hunks.length - 1]
    if (h && g.a - CTX <= h.end + CTX + 1) { h.groups.push(g); h.end = g.b } else hunks.push({ start: g.a, end: g.b, groups: [g] })
  }
  const marker = '\\ No newline at end of file'
  const out = [`--- a/${rel}`, `+++ b/${rel}`]
  let delta = 0
  for (const h of hunks) {
    const hs = Math.max(0, h.start - CTX)
    const he = Math.min(last, h.end + CTX)
    const body = []
    let oldCount = 0
    let newCount = 0
    let idx = hs
    const ctx = (to) => { for (; idx <= to; idx++) { body.push(' ' + lines[idx]); oldCount++; newCount++; if (idx === last && noEol) body.push(marker) } }
    for (const g of h.groups) {
      ctx(g.a - 1)
      for (let k = g.a; k <= g.b; k++) { body.push('-' + lines[k]); oldCount++; if (k === last && noEol) body.push(marker) }
      g.newLines.forEach((l, k) => { body.push('+' + l); newCount++; if (g.b === last && noEol && k === g.newLines.length - 1) body.push(marker) })
      idx = g.b + 1
      delta += g.newLines.length - (g.b - g.a + 1)
    }
    ctx(he)
    const newStart = hs + 1 + (delta - (newCount - oldCount))
    out.push(`@@ -${hs + 1},${oldCount} +${newStart},${newCount} @@`, ...body)
  }
  return out.join('\n') + '\n'
}

/** apply: replaces every zh by its en. Writes nothing unless everything passes. */
export function applyGame(dir, opts = {}) {
  const id = basename(resolve(dir))
  const path = worksheetPathFor(dir, opts)
  if (!existsSync(path)) return { ok: false, status: 'refused', errors: [`no worksheet at ${path} (run extract first)`] }
  let ws
  try { ws = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { ok: false, status: 'refused', errors: [`${path}: not valid JSON (${e.message})`] } }
  const errors = validateWorksheet(ws, id, dir)
  if (errors.length) return { ok: false, status: 'refused', errors }

  const files = scanGame(dir)
  const byRel = new Map(files.map((f) => [f.rel, f]))
  const editsByFile = new Map()
  let already = 0
  let replaced = 0
  const claimed = new Set()
  const order = ws.entries.map((e, i) => ({ e, i })).sort((a, b) => (b.e.onlyLine ? 1 : 0) - (a.e.onlyLine ? 1 : 0) || a.i - b.i)
  for (const { e } of order) {
    const f = byRel.get(e.file)
    if (!f) { errors.push(`${e.file}: not a scanned file of this game`); continue }
    const matches = f.segs.filter((s) => s.kind === e.kind && s.dec === e.zh && (!e.onlyLine || s.line === e.line) && !claimed.has(`${e.file}:${s.start}`))
    if (!matches.length) {
      if (f.segs.some((s) => s.kind === e.kind && s.dec === e.en)) { already++; continue }
      errors.push(`${e.file}:${e.line}: "${e.zh}" not found as ${e.kind}`)
      continue
    }
    for (const s of matches) {
      claimed.add(`${e.file}:${s.start}`)
      let text
      try { text = encodeFor(s, e.en) } catch (err) { errors.push(`${e.file}:${s.line}: ${err.message}`); continue }
      if (!editsByFile.has(e.file)) editsByFile.set(e.file, [])
      editsByFile.get(e.file).push({ start: s.start, end: s.end, text })
      replaced++
    }
  }
  // <html lang="zh..."> -> lang="en"
  let langFixed = 0
  for (const f of files) {
    if (f.ext !== '.html' && f.ext !== '.htm') continue
    const m = /<html\b[^>]*?\blang\s*=\s*(["']?)(zh[\w-]*)\1/i.exec(f.text)
    if (!m) continue
    const start = m.index + m[0].lastIndexOf(m[2])
    if (!editsByFile.has(f.rel)) editsByFile.set(f.rel, [])
    editsByFile.get(f.rel).push({ start, end: start + m[2].length, text: 'en' })
    langFixed++
  }
  if (errors.length) return { ok: false, status: 'refused', errors }
  if (!editsByFile.size) return { ok: true, status: 'already applied', replaced: 0, already, files: [] }

  // build the new texts, syntax-check them, audit a temp copy, then write
  const newTexts = new Map()
  const diffs = []
  for (const rel of [...editsByFile.keys()].sort()) {
    const f = byRel.get(rel)
    const edits = editsByFile.get(rel).sort((a, b) => a.start - b.start)
    for (let k = 1; k < edits.length; k++) if (edits[k].start < edits[k - 1].end) errors.push(`${rel}: two replacements overlap`)
    const next = applyEdits(f.text, edits)
    newTexts.set(rel, next)
    if (compileProblems(f, f.text).length === 0) for (const p of compileProblems(f, next)) errors.push(`syntax after the change: ${p}`)
    diffs.push(unifiedDiff(`resources/games/${id}/${rel}`, f.text, edits))
  }
  if (errors.length) return { ok: false, status: 'refused', errors }
  const tmp = mkdtempSync(join(tmpdir(), 'q3-i18n-'))
  try {
    const copy = join(tmp, id)
    cpSync(dir, copy, { recursive: true })
    for (const [rel, text] of newTexts) writeFileSync(join(copy, rel), text)
    const audit = auditGameFolder(copy)
    if (!audit.ok) return { ok: false, status: 'refused', errors: audit.failures.map((x) => `audit ${x.rule} ${x.file}:${x.line}`) }
  } finally { rmSync(tmp, { recursive: true, force: true }) }

  for (const [rel, text] of newTexts) writeFileSync(join(dir, rel), text)
  const patch = patchPathFor(dir, opts)
  mkdirSync(dirname(patch), { recursive: true })
  writeFileSync(patch, diffs.join(''))
  return { ok: true, status: 'applied', replaced, already, langFixed, files: [...newTexts.keys()], patch }
}

// ---------------------------------------------------------------- check

/** check: leftovers, duplicate en, <html lang>, audit rules. */
export function checkGame(dir, opts = {}) {
  const id = basename(resolve(dir))
  const leftovers = []
  const warnings = []
  let commentCjk = 0
  for (const f of scanGame(dir)) {
    commentCjk += f.commentCjk
    for (const s of f.segs) {
      const text = s.dec.length > 80 ? s.dec.slice(0, 80) + '...' : s.dec
      if (hasCjk(s.dec)) leftovers.push({ file: f.rel, line: s.line, kind: s.kind, text })
      else if (CJK_ANY.test(s.dec)) warnings.push(`${f.rel}:${s.line} [${s.kind}] full-width punctuation left in "${text}" (review)`)
    }
    if (f.ext === '.html' || f.ext === '.htm') {
      const m = /<html\b[^>]*?\blang\s*=\s*(["']?)(zh[\w-]*)\1/i.exec(f.text)
      if (m) leftovers.push({ file: f.rel, line: 1, kind: 'lang', text: `<html lang="${m[2]}">` })
    }
  }
  const path = worksheetPathFor(dir, opts)
  if (existsSync(path)) {
    try {
      const ws = JSON.parse(readFileSync(path, 'utf8'))
      const seen = new Map()
      for (const e of ws.entries ?? []) {
        if (typeof e.en !== 'string' || !e.en.trim()) continue
        const k = `${e.file}\u0000${e.en.trim()}`
        const first = seen.get(k)
        if (first !== undefined && first !== e.zh) warnings.push(`${e.file}: "${e.en}" is the English of two different Chinese strings (review: a lookup could merge)`)
        else seen.set(k, e.zh)
      }
    } catch (err) { warnings.push(`${path}: not valid JSON (${err.message})`) }
  }
  const audit = auditGameFolder(dir)
  const ok = leftovers.length === 0 && audit.ok
  return { ok, id, leftovers, warnings, commentCjk, audit: { ok: audit.ok, failures: audit.failures, warnings: audit.warnings } }
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const [cmd, ...rest] = argv
  if (!['extract', 'apply', 'check'].includes(cmd) || rest.length === 0) {
    console.log('usage: node tools/games-i18n.mjs extract <gameFolder>... | apply <gameFolder> [worksheet] | check <gameFolder>...')
    return 2
  }
  let bad = false
  if (cmd === 'apply') {
    const dir = resolve(rest[0])
    if (!existsSync(dir)) { console.log(`no such folder: ${dir}`); return 2 }
    const r = applyGame(dir, { worksheetPath: rest[1] ? resolve(rest[1]) : undefined })
    if (!r.ok) { console.log(`REFUSED ${basename(dir)} (nothing written):`); for (const e of r.errors) console.log('  ' + e); return 1 }
    console.log(`${basename(dir)}: ${r.status}${r.status === 'applied' ? ` (${r.replaced} replaced, ${r.already} already, ${r.langFixed} lang; ${r.files.join(', ')}; ${relative(REPO_ROOT, r.patch)})` : ''}`)
    return 0
  }
  for (const d of rest) {
    const dir = resolve(d)
    if (!existsSync(dir)) { console.log(`no such folder: ${dir}`); return 2 }
    if (cmd === 'extract') {
      const r = extractGame(dir)
      if (!r.ok) { bad = true; for (const e of r.errors) console.log(e); continue }
      console.log(`${basename(dir)}: ${r.total} entries (${r.added} new, ${r.empty} without English, ${r.risky} risky) -> ${relative(REPO_ROOT, r.path)}`)
    } else {
      const r = checkGame(dir)
      console.log(`${r.id}: ${r.ok ? 'OK' : 'PROBLEMS'} (leftovers ${r.leftovers.length}, audit failures ${r.audit.failures.length}, warnings ${r.warnings.length}, Chinese left in comments ${r.commentCjk})`)
      for (const l of r.leftovers) console.log(`  leftover ${l.file}:${l.line} [${l.kind}] ${l.text}`)
      for (const f of r.audit.failures) console.log(`  audit ${f.rule} ${f.file}:${f.line}`)
      for (const w of r.warnings) console.log(`  warning ${w}`)
      if (!r.ok) bad = true
    }
  }
  return bad ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)))
