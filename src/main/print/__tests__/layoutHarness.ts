/**
 * Phase 35 - layout measurement in real Chromium (no Electron needed): loads print HTML in headless Chromium, runs a
 * measuring script and reads the result back. Test-only; the layout test skips itself when no Chromium is found.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentWidthPx, MEASURE_SCRIPT as BOTTOM_SCRIPT } from '../../../shared/print/printFlow'

const MEASURE_SCRIPT = `<script>
window.addEventListener('load',()=>{document.fonts.ready.then(()=>{
 const sheet=document.querySelector('.q3p-sheet').getBoundingClientRect();
 const over=[];
 for(const el of document.querySelectorAll('.q3p-table th,.q3p-table td,.q3p-head *')){
  const r=el.getBoundingClientRect(); if(r.width===0)continue;
  if(r.right>sheet.right+0.5||r.left<sheet.left-0.5)over.push(el.tagName+':'+(el.textContent||'').slice(0,30));
  if(el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).display.startsWith('table'))over.push('scroll:'+(el.textContent||'').slice(0,30));
 }
 const brokenNumbers=[...document.querySelectorAll('.q3p-table td.q3p-n,.q3p-table th')].filter(el=>{const r=document.createRange();r.selectNodeContents(el);const rects=[...r.getClientRects()];if(!rects.length)return false;const w=el.textContent||'';const lines=new Set(rects.map(x=>Math.round(x.top)));const word=w.trim().split(/\\s+/);return el.tagName==='TD'?lines.size>1:word.some(x=>x.length>0)&&lines.size>word.length}).map(el=>(el.textContent||'').slice(0,20));
 const rows=[...document.querySelectorAll('.q3p-table tr')].map(r=>r.getBoundingClientRect().height);
 const out={brokenNumbers,sheetW:sheet.width,docW:document.documentElement.scrollWidth,clientW:document.documentElement.clientWidth,over,rowCount:rows.length,minRowH:Math.min(...rows),maxRowH:Math.max(...rows),
  cols:[...document.querySelectorAll('.q3p-table thead th')].map(t=>t.getBoundingClientRect().width)};
 const pre=document.createElement('pre');pre.id='q3m';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
})});
</script>`

export const CHROME = process.env.QUOT3_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
export const chromeAvailable = (): boolean => existsSync(CHROME)
const base = ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']

export interface Measure { sheetW: number; docW: number; clientW: number; over: string[]; brokenNumbers: string[]; rowCount: number; minRowH: number; maxRowH: number; cols: number[] }

export function measure(html: string, widthMm: number): Measure {
  const dir = mkdtempSync(join(tmpdir(), 'q3m-'))
  const f = join(dir, 'p.html')
  writeFileSync(f, html.replace('</body>', MEASURE_SCRIPT + '</body>'))
  const px = Math.round((widthMm / 25.4) * 96)
  const r = spawnSync(CHROME, [...base, `--window-size=${px},1200`, '--virtual-time-budget=5000', '--dump-dom', 'file://' + f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const m = /<pre id="q3m">([^<]*)<\/pre>/.exec(r.stdout ?? '')
  if (!m) throw new Error('no measurement: ' + (r.stderr ?? '').slice(0, 300))
  return JSON.parse((m[1] as string).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) as Measure
}

export function pdfPages(html: string): { pages: number; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'q3p-'))
  const f = join(dir, 'p.html'), out = join(dir, 'p.pdf')
  writeFileSync(f, html)
  spawnSync(CHROME, [...base, '--no-pdf-header-footer', `--print-to-pdf=${out}`, 'file://' + f], { encoding: 'utf8' })
  const pdf = readFileSync(out, 'latin1')
  return { pages: (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, file: out }
}

/** Phase 37 - run the print service's own `MEASURE_SCRIPT` in headless Chromium at the printable width and return the sheet's bottom edge (CSS px). */
export function measureBottom(html: string, paper: 'A5' | 'A4'): number {
  const dir = mkdtempSync(join(tmpdir(), 'q3b-'))
  const f = join(dir, 'p.html')
  const inject = `<script>window.addEventListener('load',()=>{${BOTTOM_SCRIPT}.then(v=>{const p=document.createElement('pre');p.id='q3b';p.textContent=String(v);document.body.appendChild(p)})})</script>`
  writeFileSync(f, html.replace('</body>', inject + '</body>'))
  const r = spawnSync(CHROME, [...base, `--window-size=${contentWidthPx(paper)},1200`, '--virtual-time-budget=5000', '--dump-dom', 'file://' + f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const m = /<pre id="q3b">(-?\d+)<\/pre>/.exec(r.stdout ?? '')
  if (!m) throw new Error('no bottom measurement: ' + (r.stderr ?? '').slice(0, 300))
  return Number(m[1])
}
