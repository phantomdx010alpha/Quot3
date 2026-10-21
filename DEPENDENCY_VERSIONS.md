# DEPENDENCY_VERSIONS — Quot3

**This is the locked version manifest. Every session must install exactly these versions.**
**Do not upgrade any package without updating this file and recording the reason in `PHASE_STATUS.md`.**

**Provenance — read this honestly:** every version below was looked up on the npm registry on **2026-10-07**, and the peer-dependency constraints that decided the "do NOT use" notes were read from the registry metadata. The set was **NOT install-tested together** (no Windows machine, no Electron rebuild in the planning session). **Phase 1's first job is to run the real `npm install`, rebuild native modules, and record in this file's "Install-test log" (bottom) what actually happened, adjusting pins if needed.**

---

## Runtime environment

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | `>=22.12.0 <23` for tooling | `.nvmrc` = `22`. Vitest 5 and electron-builder 26 both require ≥ 22.12. Note: Electron 44 **bundles its own newer Node** (its `@types/node` is `^24`) for the main process — tooling/tests run on Node 22, the app runs on Electron's Node. Don't use Node APIs that exist only in Node 24 in code shared with Vitest. |
| **npm** | `>=10` | npm 10.9 ships with Node 22. No yarn/pnpm. |
| **OS (target)** | Windows 10/11 x64 | Dev can happen anywhere; releases are built on Windows (or CI `windows-latest`). |

---

## Exact package versions — install these, no others

### Shell & build

| Package | Exact version | Install | Notes |
|---|---|---|---|
| `electron` | `44.6.0` | `npm i -D electron@44.6.0` | |
| `electron-vite` | `5.0.0` | `npm i -D electron-vite@5.0.0` | **Its peer range is `vite ^5 \|\| ^6 \|\| ^7` — so Vite 8 is NOT allowed.** Also peers `@swc/core ^1` only if the SWC option is used (we don't). |
| `vite` | `7.3.7` | `npm i -D vite@7.3.7` | **Do NOT use Vite 8** (electron-vite 5 does not accept it). |
| `@vitejs/plugin-react` | `5.2.0` | `npm i -D @vitejs/plugin-react@5.2.0` | **Use 5.x, not 6.x** — 6.x requires Vite 8. 5.2.0 accepts Vite 7. |
| `typescript` | `5.9.3` | `npm i -D typescript@5.9.3` | **Do NOT use TypeScript 7** (native-port major; untested with this toolchain). |
| `@types/node` | `22.20.5` | `npm i -D @types/node@22.20.5` | |
| `@electron/rebuild` | `4.2.1` | `npm i -D @electron/rebuild@4.2.1` | Rebuilds `better-sqlite3` against Electron's ABI (`postinstall`). |
| `pdf-to-printer` | `5.8.1` | `npm i pdf-to-printer@5.8.1 --save-exact --ignore-scripts` | Phase 144 follow-up: sends the Save-PDF bytes to the printer (bundles SumatraPDF 3.4.6, MIT wrapper). Runtime dependency; the exe is in `asarUnpack` (`electron-builder.yml`). Windows only (elsewhere it rejects and Print falls back to the HTML path). Installed with `--ignore-scripts`; lockfile gained 1 package. |
| `electron-builder` | `26.15.3` | `npm i -D electron-builder@26.15.3` | NSIS per-user installer. | **Installed in Phase 64** (devDependency, exact pin; lockfile only gained packages). Config `npmRebuild: false` because better-sqlite3 uses its shipped prebuilds (no Visual Studio Build Tools needed).
| `electron-updater` | `6.8.9` | `npm i electron-updater@6.8.9` | Phase 62. | **Installed in Phase 62** (dependency, exact pin; `package-lock.json` updated; type-checks and bundles through a lazy `import('electron-updater')` in `updaterPort.ts`).

### UI

| Package | Exact version | Install | Notes |
|---|---|---|---|
| `react` | `19.3.0` | `npm i react@19.3.0` | |
| `three` | `0.186.1` | `npm i three@0.186.1 --save-exact --ignore-scripts` | Phase 169: 3D / shader theme backgrounds. Runtime dependency, lazy-loaded (`import('three')` in `renderer/theme/scenes/sceneHost.ts` only; its own chunk), no network / remote assets / eval. Published 2026-09-24 (22 days before install; the two-week rule). |
| `@types/three` | `0.186.0` | `npm i -D @types/three@0.186.0 --save-exact --ignore-scripts` | Phase 169: types for `three` (three ships none). Dev only. Published 2026-09-11. |
| `react-dom` | `19.3.0` | `npm i react-dom@19.3.0` | Must equal `react`. |
| `@types/react` | `19.3.0` | `npm i -D @types/react@19.3.0` | |
| `@types/react-dom` | `19.3.0` | `npm i -D @types/react-dom@19.3.0` | |
| `tailwindcss` | `3.4.19` | `npm i -D tailwindcss@3.4.19` | **Use v3, not v4** — v4 drops `tailwind.config` conventions this project uses. |
| `postcss` | `8.5.29` | `npm i -D postcss@8.5.29` | |
| `autoprefixer` | `10.6.1` | `npm i -D autoprefixer@10.6.1` | |
| `@phosphor-icons/react` | `2.1.10` | `npm i @phosphor-icons/react@2.1.10` | Only icon library. Peers `react >= 16.8`. |
| `@tanstack/react-virtual` | `3.14.13` | `npm i @tanstack/react-virtual@3.14.13` | **History and Customers lists only.** The bill grid has ≤ ~80 rows and uses its own lean renderer. |
| `zustand` | `5.0.15` | `npm i zustand@5.0.15` | Peers `immer >= 9.0.6` (optional). |
| `immer` | `11.1.21` | `npm i immer@11.1.21` | `produceWithPatches` for undo/redo. |

### Data, logic, import/export

| Package | Exact version | Install | Notes |
|---|---|---|---|
| `better-sqlite3` | `13.0.3` | `npm i better-sqlite3@13.0.3` | **Native module.** Requires Node ≥ 22 to build. Must be rebuilt for Electron (`@electron/rebuild`). Main process only. |
| `@types/better-sqlite3` | `9.6.0` | `npm i -D @types/better-sqlite3@9.6.0` | |
| `drizzle-orm` | `0.45.3` | `npm i drizzle-orm@0.45.3` | `better-sqlite3 >= 7` peer satisfied. |
| `drizzle-kit` | `0.31.11` | `npm i -D drizzle-kit@0.31.11` | Migration generation. |
| `zod` | `4.6.5` | `npm i zod@4.6.5` | IPC boundary validation. Zod 4 API (not 3). |
| `decimal.js` | `10.6.0` | `npm i decimal.js@10.6.0` | All money math. |
| `fuse.js` | `7.5.0` | `npm i fuse.js@7.5.0` | Fuzzy party search. |
| `exceljs` | `4.4.0` | `npm i exceljs@4.4.0` | Party import (Phase 47), optional Excel export. Main process only. |
| `@supabase/supabase-js` | `2.117.2` | `npm i @supabase/supabase-js@2.117.2` | Sync only, main process only (Phase 51+). Anon key only. |

### Testing

| Package | Exact version | Install | Notes |
|---|---|---|---|
| `vitest` | `5.0.3` | `npm i -D vitest@5.0.3` | Peers `vite ^6.4 \|\| ^7 \|\| ^8` — fine with Vite 7. |
| `jsdom` | `30.1.2` | `npm i -D jsdom@30.1.2` | Phase 9: DOM for renderer render-count tests (`// @vitest-environment jsdom` docblock; no React Testing Library — `react-dom/client` + `act` are enough). Dev-only. |
| `@playwright/test` | `1.63.0` | `npm i -D @playwright/test@1.63.0` | Electron e2e via `_electron`. **Installed in Phase 66** (devDependency, exact pin; lockfile only gained packages). Browser binaries are NOT needed: the suite drives Electron itself (`_electron`), so no `playwright install` step. (Earlier phases' Chromium print / image tests use the sandbox's own Chromium by path.) |

| `fake-indexeddb` | `6.2.5` | `npm i -D fake-indexeddb@6.2.5 --save-exact --ignore-scripts` | Phase 175: in-memory IndexedDB for the phone data-layer tests (`new IDBFactory()` per test, no globals). Dev only, tests only. Latest on the registry was 6.2.6 (published 2026-10-16, 5 days before install), so 6.2.5 (published 2025-11-07) is pinned to respect the two-week rule. |

**Not installed on purpose:** `glide-data-grid` / `ag-grid` / any grid library (custom grid — see MASTERPLAN §9), `moment`/`dayjs` (use `Intl` + small helpers), `lodash`, Redux, any CSS-in-JS, any second icon library, Python anything.

---

## Rules
1. Use exact versions (`npm i pkg@x.y.z`, `--save-exact`); `.npmrc` sets `save-exact=true`.
2. Commit `package-lock.json`. Never delete it to fix an install.
3. `better-sqlite3` rebuild: `package.json` `postinstall` runs `electron-builder install-app-deps` (or `@electron/rebuild -f -w better-sqlite3`). If the rebuild fails, that is a **blocker** for every later phase — record it and stop; do not substitute another database without owner approval.
4. If a pinned package cannot be installed, pick the nearest working version, update this table in place (`str_replace`), and log the reason in `PHASE_STATUS.md`.

## Milestone 17 candidates (names only; NOTHING installed or pinned yet)

Docs-only list written 2026-10-21. The phase that installs a package looks the exact version up on the registry, pins it (exact, no caret), records it in the Install-test log and respects the Rules above. None is mandatory; the phase may choose differently.
- An IndexedDB helper (candidate `idb`): **DECIDED in Phase 175: none**; `src/pwa/data/db.ts` has its own small promise wrapper.
- An in-memory IndexedDB fake for tests: **`fake-indexeddb` 6.2.5 installed in Phase 175** (see the Testing table).
- A service-worker / PWA build helper (candidates `vite-plugin-pwa`, `workbox-*`): **DECIDED in Phase 174: none; a hand-written `pwa-static/sw.js` plus a small plugin in `vite.pwa.config.ts` is used.**
- A PDF builder (candidates `pdf-lib`, `jspdf`): only if Phase 173 picks a real text PDF; a PDF made from the page image may need none. Phase 184.
- A font file with the rupee sign bundled as a static asset (not an npm package unless a font package is chosen). Phase 184.
- Already in the project and reused: `@supabase/supabase-js`, `fuse.js`, `decimal.js`, `zod`, `zustand`, `react`.
- Phone e2e (Playwright mobile emulation): `@playwright/test` is already present for desktop e2e; Phase 187 decides.

## Install-test log (append rows; first row is Phase 1's job)
| Date | Phase | Result | Adjustments |
|---|---|---|---|
| 2026-10-07 | 0 (planning) | Versions looked up on registry; peer constraints read; **not installed** | none yet |
| 2026-10-08 | 1 | All Phase 1–5 pins installed together on Node 22.22.2 / npm 10.9.7 with **no version changes**. `npm run typecheck` + `npm test` pass. `better-sqlite3@13.0.3` ships **N-API prebuilt binaries** (`prebuilds/win32-x64.node` etc.) — it loaded under Node (sqlite 3.53.4) and under **Electron 44.6.0 (ABI 149)** headless via xvfb (sqlite 3.53.4) with **no recompile**. `electron-rebuild -f -w better-sqlite3` itself FAILED in the sandbox: 403 downloading `https://www.electronjs.org/headers/v44.6.0/...` (sandbox network allow-list, not a package fault); `prebuild-install` found no electron prebuild (not needed). | `postinstall` changed from a blanket `electron-rebuild` to `scripts/postinstall.mjs`: loads the prebuilt binding and only falls back to `electron-rebuild` if it fails to load. Avoids requiring Visual Studio Build Tools on the owner's Windows PC. |
| 2026-10-08 | 5 | `drizzle-orm@0.45.3` and `drizzle-kit@0.31.11` installed at the pinned versions (`--ignore-scripts`), no changes. `npx drizzle-kit generate` ran offline in the sandbox and produced `0000_init`. | none |
| 2026-10-08 | 26 | `fuse.js@7.5.0` installed at the pinned version (`--ignore-scripts`); used in `shared/party/fuzzy.ts` only; no other changes. | none |
| 2026-10-08 | 9 | `jsdom@30.1.2` installed (`--ignore-scripts`, dev-only) for renderer render-count tests; works on Node 22; no other changes. | none |
| 2026-10-09 | 41 | `@tanstack/react-virtual@3.14.13` installed at the pinned version (`--ignore-scripts`); used only by `renderer/components/history/BillList.tsx`; lockfile gained 2 packages (react-virtual + virtual-core). | none |
| 2026-10-09 | 42 | No new packages. `npm install --ignore-scripts` once to get a tree (node_modules was not in the zip); lockfile unchanged. `fuse.js` (already pinned) now also ranks History search. | none |
| 2026-10-09 | 43 | No new packages. `npm install --ignore-scripts` once to get a tree (node_modules was not in the zip); lockfile byte-identical. | none |
| 2026-10-09 | 44 | No new packages. `npm install --ignore-scripts` once to get a tree (node_modules was not in the zip); lockfile byte-identical (cmp against the zip's). | none |
| 2026-10-09 | 45 | No new packages. `npm install --ignore-scripts` once to get a tree (node_modules was not in the zip; a plain `npm install` fails in the sandbox because the postinstall falls back to node-gyp, which needs network for headers); lockfile byte-identical to the zip's. | none |
| 2026-10-09 | 46 | No new packages; no install needed (the Phase 45 tree was reused); lockfile untouched. | none |
| 2026-10-09 | 47 | `exceljs@4.4.0` added (exact pin, as planned in the table above) with `npm install exceljs@4.4.0 --ignore-scripts`; `package.json` + `package-lock.json` changed ONLY by that (+ its transitive deps). `npm install --ignore-scripts` once first to get a tree. | none |
| 2026-10-09 | 48 | No new packages. `npm install --ignore-scripts` once to get a tree (node_modules was not in the zip); lockfile untouched. | none |
| 2026-10-09 | 49 | No new packages. `npm install --ignore-scripts` was ATTEMPTED and failed (403 from the registry, no network in this sandbox), so there was no `node_modules`; lockfile untouched (byte-identical). | none |
| 2026-10-09 | 50 | No new packages. No install possible (registry 403, no network); lockfile untouched. | none |
| 2026-10-09 | 52 | No new packages and `package.json` / `package-lock.json` untouched. The registry WAS reachable this time: `npm ci --ignore-scripts` on a scratch copy installed the whole tree from the existing lockfile (450 packages, no changes), `better-sqlite3` was compiled with `node-gyp rebuild --nodedir=/opt/node22` (no prebuild for linux / Node 22.22 was downloadable) and the full `npx vitest run` + all three `tsc` projects were run there. `@supabase/supabase-js` is still NOT installed: `SupabaseTransport` uses `fetch` (see API_CONTRACTS, Phase 52). | none |
| 2026-10-10 | 53 | No new packages, `package.json` / lockfile untouched (Node built-ins `crypto` + `zlib` only). | none |
| 2026-10-10 | 54 | No new packages, `package.json` / lockfile untouched. | none |
| 2026-10-10 | 55 | No new packages, `package.json` / lockfile untouched. | none |
| 2026-10-10 | 56 | No new packages, `package.json` / lockfile untouched. | none |
| 2026-10-10 | 57 | No new packages, `package.json` / lockfile untouched. | none |
| 2026-10-10 | 58 | No new packages, `package.json` / lockfile untouched. | none |
| 2026-10-09 | 51 | No new packages (the generator uses only `node:crypto`; no `pg` / `pg-mem` added). No install possible (registry 403); lockfile untouched. | none |
| 2026-10-10 | 59 | No package added or changed. |
| 2026-10-12 | Milestone 12 planning | Docs only. No package change planned: Supabase Auth and Realtime ship inside `@supabase/supabase-js@2.117.2` (main process only). Phases 132 and 138 must confirm that against the installed tree and record any change here. | none |
| 2026-10-12 | 132 | `@supabase/supabase-js` `2.117.2` added to `dependencies` in `package.json` and `package-lock.json` (`npm install --package-lock-only --ignore-scripts`; the lockfile gained the package and its transitive entries only). Imported only by `src/main/sync/sharedTransport.ts` (checked by a test). Auth and Realtime are inside the package; no other package added. In the sandbox the package was installed in a scratch folder (with `--legacy-peer-deps` there) to run the new tests; a plain `npm install` in the repo was not run. | `@supabase/supabase-js` 2.117.2 |
| 2026-10-16 | 169 | `three@0.186.1` and `@types/three@0.186.0` added (exact pins, `--ignore-scripts`, one install each); `package.json` + `package-lock.json` changed ONLY by that (lockfile +65 lines: three, @types/three and the type package's own small dependencies). Version NOT bumped (0.1.13). Bundle-resolve check with esbuild: `three` lands in its own lazy chunk, no `eval` / `new Function`. A real `electron-vite build` was not run. | none |
| 2026-10-21 | 174 | No new packages. Registry was reachable: `npm ci --ignore-scripts` on the zip's lockfile installed the tree; `package-lock.json` changed ONLY in its two top-of-file version spots (0.1.14 -> 0.1.15). `vite build --config vite.pwa.config.ts` (Vite 7.3.7, `@vitejs/plugin-react` 5.2.0) built the phone shell. Vercel installs with `npm ci --ignore-scripts` (set in `vercel.json`) so the desktop `postinstall` does not run there. | none |
| 2026-10-21 | 175 | `fake-indexeddb@6.2.5` added (exact pin, dev, `--ignore-scripts`, one install); `package.json` + `package-lock.json` changed ONLY by that (+1 package entry) and the version bump 0.1.15 -> 0.1.16. No `idb`. Tests ran on Node 22 in the sandbox. | `fake-indexeddb` 6.2.5 (not the newest 6.2.6, age rule) |
| 2026-10-21 | 176 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.16 -> 0.1.17 (three spots). Tests ran on Node 22 against `fake-indexeddb` 6.2.5. | none |
| 2026-10-21 | 177 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.17 -> 0.1.18 (three spots). `fuse.js` (already pinned) is reused through `shared/party/fuzzy.ts`; `decimal.js` not involved. Tests ran on Node 22 against `fake-indexeddb` 6.2.5. | none |
| 2026-10-21 | 178 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.18 -> 0.1.19 (three spots). Browser Web Crypto (`crypto.subtle`) is used for the login vault and PIN hash: no crypto package. Tests ran on Node 22 against `fake-indexeddb` 6.2.5 and the desktop `InMemorySharedTransport` (tests only). | none |
| 2026-10-21 | 179 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.19 -> 0.1.20 (three spots). Tests ran on Node 22 against `fake-indexeddb` 6.2.5 and the desktop `InMemorySharedServer` / `InMemorySharedTransport` (tests only). `@supabase/supabase-js` is NOT in the phone bundle yet (real browser transport still to build). | none |
| 2026-10-21 | 180 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.20 -> 0.1.21 (three spots). `@phosphor-icons/react` (already pinned) is now also used by the phone bottom navigation. Tests ran on Node 22 with `jsdom` 30.1.2 and `fake-indexeddb` 6.2.5. | none |
| 2026-10-21 | 181 | No new packages. Tree from the Phase 180 session reused; `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.21 -> 0.1.22 (three spots). `fuse.js` (already pinned) is reused through the shared History search. | none |
| 2026-10-21 | 182 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.22 -> 0.1.23 (three spots). `@phosphor-icons/react` (already pinned) is also used by the editor. Tests ran on Node 22 with `jsdom` 30.1.2 and `fake-indexeddb` 6.2.5. | none |
| 2026-10-21 | 183 | No new packages. Tree from the Phase 182 session reused; `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.23 -> 0.1.24 (three spots). Shared `decimal.js` units / rich-text code reused unchanged. | none |
| 2026-10-21 | 184 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.24 -> 0.1.25 (three spots). No PDF library: the PDF is written by a built-in writer (`src/pwa/share/pdf.ts`). The bundled Noto Sans files (already in `resources/fonts`) were copied to `pwa-static/fonts/` for the phone. Shared `decimal.js` / print model reused unchanged. | none |
| 2026-10-21 | 185 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.25 -> 0.1.26 (three spots). Browser Web Crypto (PBKDF2, already used by the app lock) and `FileReader` are used by the new screens: no package. `@phosphor-icons/react` (already pinned) reused. Tests ran on Node 22 with `jsdom` 30.1.2 and `fake-indexeddb` 6.2.5. | none |
| 2026-10-21 | 186 | No new packages. `npm ci --ignore-scripts` on the zip's lockfile (registry reachable); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.26 -> 0.1.27 (three spots). Browser APIs only (service worker, `beforeinstallprompt`, `online` / `offline`, StorageManager). | none |
| 2026-10-21 | 187 | No new packages. Tree from the Phase 186 session reused; `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.27 -> 0.1.28 (three spots). No Playwright browser installed (mobile e2e deferred). | none |
| 2026-10-21 | 188 | No new packages. Tree from the Phase 186 / 187 sessions reused (`npm ci --ignore-scripts`); `package.json` + `package-lock.json` changed ONLY by the version bump 0.1.28 -> 0.2.0 (the first two spots; a third `0.2.0` in the lockfile belongs to another package). `vite build --config vite.pwa.config.ts` built (Vite 7.3.7): index JS 563.93 kB (178.94 kB gzip), CSS 10.65 kB, `sw.js` carries 0.2.0; Rollup warns the chunk is over 500 kB (no code splitting yet). `supabase-js` is still NOT in the phone bundle. | none |
