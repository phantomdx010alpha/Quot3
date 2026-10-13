import { DEFAULT_GITHUB_FEED, type UpdaterOptions } from '../../shared/updater'
import type { UpdaterPort } from './updateService'

/**
 * Phase 62 - the real `electron-updater` behind `UpdaterPort`. Loaded lazily so tests and `npm run dev` never touch it.
 * Signature / hash checks are electron-updater's own (sha512 from `latest.yml`; Windows code-signing verification is configured
 * in Phase 65). `autoDownload` and `autoInstallOnAppQuit` are OFF: this app downloads only through `download()` and installs only
 * through `quitAndInstall()`, which `updateService.install()` calls after the unsaved-bill gate.
 */
export function createElectronUpdaterPort(): UpdaterPort {
  let updater: import('electron-updater').AppUpdater | null = null
  const get = async (): Promise<import('electron-updater').AppUpdater> => {
    if (updater) return updater
    const mod = await import('electron-updater')
    // electron-updater is CommonJS and exposes `autoUpdater` as a non-enumerable getter, so after bundling the named export can be
    // undefined and only `default.autoUpdater` exists. That made every check fail with "Cannot set properties of undefined".
    const au = mod.autoUpdater ?? (mod as unknown as { default?: { autoUpdater?: import('electron-updater').AppUpdater } }).default?.autoUpdater
    if (!au) throw new Error('electron-updater did not load')
    updater = au
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    return updater
  }
  return {
    async configure(o: UpdaterOptions) {
      const u = await get()
      u.allowPrerelease = o.allowPrerelease
      u.allowDowngrade = false
      u.channel = o.channel
      if (o.feed.kind === 'github') u.setFeedURL({ provider: 'github', owner: o.feed.owner, repo: o.feed.repo })
      else if (o.feed.kind === 'generic') u.setFeedURL({ provider: 'generic', url: o.feed.url })
      else u.setFeedURL({ provider: 'github', owner: DEFAULT_GITHUB_FEED.owner, repo: DEFAULT_GITHUB_FEED.repo }) // built-in = hardcoded
    },
    async check() {
      const u = await get()
      const r = await u.checkForUpdates()
      return { version: r?.isUpdateAvailable === true ? r.updateInfo.version : '' }
    },
    async download(onProgress) {
      const u = await get()
      const on = (p: { percent: number }): void => onProgress(p.percent)
      u.on('download-progress', on)
      try { await u.downloadUpdate() } finally { u.removeListener('download-progress', on) }
    },
    quitAndInstall() {
      void get().then((u) => u.quitAndInstall(false, true))
    }
  }
}
