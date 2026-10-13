// Phase 1 — native module guard.
// better-sqlite3 13.x ships N-API prebuilt binaries (prebuilds/<platform>-<arch>.node), which are
// ABI-stable and load in Electron without recompiling. We only fall back to a source rebuild
// against Electron's headers (@electron/rebuild) if the prebuilt binary cannot be loaded.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)

function loads() {
  try {
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    return true
  } catch (err) {
    console.warn('[postinstall] better-sqlite3 prebuilt did not load:', err.message)
    return false
  }
}

if (loads()) {
  console.log('[postinstall] better-sqlite3 prebuilt binary OK — no rebuild needed.')
} else {
  console.log('[postinstall] Falling back to electron-rebuild …')
  const r = spawnSync('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3'], {
    stdio: 'inherit',
    shell: true
  })
  if (r.status !== 0) {
    console.error('[postinstall] electron-rebuild FAILED. This is a Phase-1 blocker — see DEPENDENCY_VERSIONS.md.')
    process.exit(r.status ?? 1)
  }
}
