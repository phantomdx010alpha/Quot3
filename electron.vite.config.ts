import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { PROD_CSP } from './src/main/security'

// Production-only <meta> CSP fallback (file:// loads); dev uses the relaxed header set by main.
const injectProdCsp = {
  name: 'quot3-inject-prod-csp',
  apply: 'build' as const,
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: PROD_CSP }, injectTo: 'head-prepend' as const }
  ]
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), injectProdCsp],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
