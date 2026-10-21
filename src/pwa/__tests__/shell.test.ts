import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canGoBack, createRouter, currentRoute, goBack, navigate } from '../router'
import { detectCapabilities, isPhone } from '../platform/flags'
import { canApplyUpdate } from '../platform/swUpdate'

const root = resolve(__dirname, '..', '..', '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('desktop build is untouched by the phone', () => {
  it('no desktop source imports src/pwa', () => {
    for (const dir of ['src/main', 'src/preload', 'src/renderer']) {
      for (const f of walk(join(root, dir))) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(/from\s+['"][^'"]*\/pwa(\/|['"])|@pwa\//)
      }
    }
  })
  it('desktop config and release files do not mention the phone build', () => {
    expect(read('electron.vite.config.ts')).not.toMatch(/pwa/i)
    expect(read('electron-builder.yml')).not.toMatch(/pwa/i)
    expect(read('.github/workflows/release.yml')).not.toMatch(/pwa/i)
  })
  it('desktop scripts are unchanged and the phone scripts exist', () => {
    const s = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
    expect(s.dev).toBe('electron-vite dev')
    expect(s.build).toBe('electron-vite build')
    expect(s['dev:pwa']).toBe('vite --config vite.pwa.config.ts')
    expect(s['build:pwa']).toBe('vite build --config vite.pwa.config.ts')
    expect(s.typecheck).toContain('tsconfig.pwa.json')
  })
})

describe('phone code stays phone-safe', () => {
  it('imports no electron, node:*, sqlite, src/main or renderer code', () => {
    for (const f of walk(join(root, 'src/pwa'))) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/from\s+['"](electron|better-sqlite3|node:[^'"]*|fs|path)['"]/)
      expect(src, f).not.toMatch(/from\s+['"][^'"]*\/(main|renderer|preload)\//)
      expect(src, f).not.toMatch(/window\.quot3/)
    }
  })
})

describe('manifest, icons, service worker', () => {
  const manifest = JSON.parse(read('pwa-static/manifest.webmanifest')) as {
    display: string; start_url: string; icons: { src: string; sizes: string; purpose: string }[]
  }
  it('is installable standalone with 192, 512 and maskable icons that exist', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    for (const i of manifest.icons) expect(existsSync(join(root, 'pwa-static', i.src)), i.src).toBe(true)
  })
  it('service worker template has both build placeholders, cleans old caches, no unsolicited skipWaiting', () => {
    const sw = read('pwa-static/sw.js')
    expect(sw).toContain('__QUOT3_VERSION__')
    expect(sw).toContain('__QUOT3_PRECACHE__')
    expect(sw).toContain("startsWith('quot3-phone-')")
    expect(sw).toContain("type === 'SKIP_WAITING'")
    expect(sw.match(/skipWaiting\(\)/g)?.length).toBe(1)
    expect(sw).toContain('url.origin !== self.location.origin')
  })
  it('phone index links the manifest and has a viewport', () => {
    const html = read('src/pwa/index.html')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('viewport-fit=cover')
  })
})

describe('vercel.json', () => {
  const cfg = JSON.parse(read('vercel.json')) as {
    buildCommand: string; outputDirectory: string; rewrites: { source: string; destination: string }[]
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const header = (source: string, key: string): string | undefined =>
    cfg.headers.find((h) => h.source === source)?.headers.find((h) => h.key === key)?.value
  it('builds the phone app into dist-pwa with an SPA fallback that spares real files', () => {
    expect(cfg.buildCommand).toBe('npm run build:pwa')
    expect(cfg.outputDirectory).toBe('dist-pwa')
    const rw = cfg.rewrites[0]!
    expect(rw.destination).toBe('/index.html')
    const re = new RegExp('^' + rw.source.replace(/^\//, '/'))
    expect(re.test('/history')).toBe(true)
    expect(re.test('/sw.js')).toBe(false)
    expect(re.test('/assets/index-abc.js')).toBe(false)
    expect(re.test('/manifest.webmanifest')).toBe(false)
  })
  it('never long-caches the service worker or manifest; hashed assets are immutable', () => {
    expect(header('/sw.js', 'Cache-Control')).toContain('no-cache')
    expect(header('/manifest.webmanifest', 'Cache-Control')).toBe('no-cache')
    expect(header('/assets/(.*)', 'Cache-Control')).toContain('immutable')
  })
  it('CSP is the Phase 173 proposal: self only plus https/wss supabase', () => {
    const csp = header('/(.*)', 'Content-Security-Policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("script-src 'self' 'unsafe")
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co")
    expect(csp).toContain("worker-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(header('/(.*)', 'X-Content-Type-Options')).toBe('nosniff')
    expect(header('/(.*)', 'Referrer-Policy')).toBe('no-referrer')
  })
})

describe('router', () => {
  it('pushes, dedupes the same route, goes back, never behind the first entry', () => {
    let r = createRouter()
    expect(currentRoute(r).name).toBe('home')
    expect(canGoBack(r)).toBe(false)
    r = navigate(r, 'about')
    expect(navigate(r, 'about')).toBe(r)
    expect(currentRoute(r).name).toBe('about')
    r = goBack(r)
    expect(currentRoute(r).name).toBe('home')
    expect(goBack(r)).toBe(r)
  })
})

describe('platform flags and update gate', () => {
  it('isPhone is true and every flag is false on an empty browser', () => {
    expect(isPhone).toBe(true)
    expect(detectCapabilities({})).toEqual({ persistentStorage: false, webShareFiles: false, webLocks: false, serviceWorker: false, installable: false })
  })
  it('detects features from the browser object', () => {
    const c = detectCapabilities({
      navigator: { storage: { persist: () => {} }, canShare: () => true, share: () => {}, locks: {}, serviceWorker: {} },
      standalone: true
    })
    expect(c).toEqual({ persistentStorage: true, webShareFiles: true, webLocks: true, serviceWorker: true, installable: true })
    expect(detectCapabilities({ navigator: { share: () => {} } }).webShareFiles).toBe(false)
  })
  it('an update is never applied while a bill is unsaved', () => {
    expect(canApplyUpdate({ hasUnsavedWork: true })).toBe(false)
    expect(canApplyUpdate({ hasUnsavedWork: false })).toBe(true)
  })
})
