// Phone build only (Phase 174). The desktop build is electron.vite.config.ts and does not know this file exists.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Phase 184: the share image / PDF draws with these bundled fonts (public folder, so they are not in the bundle list). */
const FONT_FILES = ['noto-sans-latin-400-normal.woff2', 'noto-sans-latin-ext-400-normal.woff2', 'noto-sans-latin-700-normal.woff2', 'noto-sans-latin-ext-700-normal.woff2']
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

/** Writes sw.js into the output with the app version (cache name) and the list of built files to precache. */
function quot3ServiceWorker(version: string): Plugin {
  return {
    name: 'quot3-pwa-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).map((f) => '/' + f)
      const precache = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...FONT_FILES.map((f) => '/fonts/' + f), ...files]
      const template = readFileSync(resolve('pwa-static/sw.js'), 'utf8')
      const source = template
        .replace('__QUOT3_VERSION__', version)
        .replace('__QUOT3_PRECACHE__', JSON.stringify([...new Set(precache)]))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    }
  }
}

export default defineConfig({
  root: resolve('src/pwa'),
  publicDir: resolve('pwa-static'),
  base: '/',
  plugins: [react(), quot3ServiceWorker(pkg.version)],
  define: { __QUOT3_APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@shared': resolve('src/shared'), '@pwa': resolve('src/pwa') } },
  build: { outDir: resolve('dist-pwa'), emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { host: true, port: 5174 }
})
