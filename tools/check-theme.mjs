// Theme checker for Claude / the owner (no app code). Runs the REAL validateTheme from the repo plus the contrast rules of
// src/__tests__/tokensParity.test.ts against a theme JSON file. Needs esbuild only (NOT the repo's node_modules):
//   mkdir /tmp/thm && cd /tmp/thm && npm init -y && npm i esbuild      (once)
//   cd /tmp/thm && node <repo>/tools/check-theme.mjs <repo> <theme.json>
// Exit code 1 = invalid theme or a contrast failure. Never prints anything but the theme's own checks.
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const [repo, file] = process.argv.slice(2)
if (!repo || !file) { console.log('usage: node check-theme.mjs <repo> <theme.json>'); process.exit(2) }
const req = createRequire(join(process.cwd(), 'x.js'))
const { build } = req('esbuild')
const out = join(mkdtempSync(join(tmpdir(), 'thm-')), 'v.mjs')
await build({ stdin: { contents: `export * from '${resolve(repo)}/src/shared/theme/validateTheme'; export * from '${resolve(repo)}/src/shared/theme/contrast'; export * from '${resolve(repo)}/src/shared/theme/schemaV2'`, resolveDir: repo, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' })
const m = await import(out)
const json = JSON.parse(readFileSync(file, 'utf8'))
const v = m.validateTheme(json)
if (!v.ok) { console.log('INVALID', v.errors); process.exit(1) }
console.log('valid; warnings:', v.warnings)
const t = v.theme.tokens
const c = (a, b) => (t[a] && t[b] ? m.contrastRatio(t[a], t[b]) : null)
const rules = [['--text-primary','--surface-grid',7],['--text-primary','--surface-grid-alt',7],['--text-primary','--surface-base',4.5],['--text-primary','--surface-raised',4.5],['--text-primary','--surface-inset',4.5],['--text-secondary','--surface-base',4.5],['--text-secondary','--surface-raised',4.5],['--text-secondary','--surface-inset',4.5],['--text-muted','--surface-base',4.5],['--text-muted','--surface-raised',4.5],['--text-muted','--surface-inset',4.5],['--text-on-accent','--accent',4.5],['--rt-red','--surface-grid',4.5],['--scrollbar-thumb','--scrollbar-track',3],['--titlebar-fg','--titlebar-bg',4.5],['--titlebar-fg','--titlebar-hover',4.5],['--titlebar-symbol','--titlebar-bg',4.5],['--titlebar-symbol','--titlebar-hover',4.5]]
let bad = 0
for (const [a, b, min] of rules) { const r = c(a, b); if (r === null) { console.log('SKIP (token not set, inherits base):', a, b); continue } const ok = r >= min; if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', a, 'on', b, r.toFixed(2), '>=', min) }
// Schema v2 (Phase 165): sections are validated by validateTheme above; here we summarise them and check that the text colour
// stays readable on every gradient stop (shell / panel sit behind chrome text; accent sits behind --text-on-accent).
if (v.theme.v2) {
  const x = v.theme.v2
  const base = t['--text-primary']; const onAccent = t['--text-on-accent']
  for (const [slot, g] of Object.entries(x.gradients)) {
    const fg = slot === 'accent' ? onAccent : base
    for (const st of g.stops) {
      if (!fg || !/^#[0-9a-f]{6}$/i.test(st.color)) { console.log('SKIP (cannot check)', 'gradient', slot, st.color); continue }
      const r = m.contrastRatio(fg, st.color); const ok = r >= 4.5; if (!ok) bad++
      console.log(ok ? 'ok  ' : 'FAIL', slot === 'accent' ? '--text-on-accent' : '--text-primary', 'on gradient', slot, st.color, r.toFixed(2), '>= 4.5')
    }
  }
  console.log('v2 sections:', ['gradients', 'fonts', 'shape', 'effects'].map((k) => `${k}=${Object.keys(x[k]).length}`).join(' '), 'scene=' + (x.background ? x.background.scene : 'none'))
}
console.log('tokens set:', Object.keys(t).length, bad ? `${bad} CONTRAST FAILURES` : 'contrast ok')
if (bad) process.exit(1)
