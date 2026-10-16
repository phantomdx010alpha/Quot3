import { BackgroundLayer } from './BackgroundLayer'
import { useEffect, useRef, type ReactNode } from 'react'
import { SideRail } from './SideRail'
import { CommandPalette } from './CommandPalette'
import { ShortcutSheet } from './ShortcutSheet'
import { useHotkeys } from '../../hooks/useHotkeys'
import { useAppActions } from '../../hooks/useAppActions'
import { useRouter } from '../../router/routerStore'
import { useUiStore } from '../../stores/uiStore'
import { useDirtyGuard } from '../../hooks/useDirtyGuard'
import { useDrafts } from '../../hooks/useDrafts'
import { UnsavedDialog } from '../create/UnsavedDialog'
import { PrintDialog } from '../create/PrintDialog'
import { HybridSidePickDialog } from '../create/HybridSidePickDialog'
import { RevisionPanel } from '../history/RevisionPanel'
import { BackupRecoveryPrompt } from '../settings/BackupRecoveryPrompt'
import { PartyImportDialog } from '../partyImport/PartyImportDialog'
import { LegacyImportDialog } from '../legacyImport/LegacyImportDialog'
import { startRemoteSync } from '../../stores/remoteChangeStore'
import { startSyncStatus } from '../../stores/syncStatusStore'
import { startUpdates } from '../../stores/updateStore'
import { UpdateBanner } from './UpdateBanner'

/**
 * Permanent chrome: side rail + page region + global overlays + global hotkeys.
 * On every navigation focus moves to the page region, so keyboard users never get stranded
 * on a control that just unmounted (or on the rail they just used with a shortcut).
 */
export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  useDirtyGuard()
  useDrafts()
  useEffect(() => startRemoteSync(), []) // Phase 56: tell main which bill is open; show changes from other branches
  useEffect(() => startSyncStatus(), []) // Phase 59: keep the Sync status page and the Dashboard chip live
  useEffect(() => startUpdates(), []) // Phase 62: follow update state; tell main when a bill is unsaved

  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const sheetOpen = useUiStore((s) => s.sheetOpen)
  const closePalette = useUiStore((s) => s.closePalette)
  const closeSheet = useUiStore((s) => s.closeSheet)

  const mainRef = useRef<HTMLElement>(null)
  const navCount = useRouter((s) => s.navCount)
  useEffect(() => {
    if (navCount === 0) return
    // Do not steal focus from an item the page itself autofocused during this render.
    const m = mainRef.current
    if (m && !m.contains(document.activeElement)) m.focus()
  }, [navCount])

  return (
    <div className="q3-shell">
      <BackgroundLayer />
      <SideRail />
      <UpdateBanner />
      <main ref={mainRef} className="q3-shell__main" tabIndex={-1} aria-label="Page">
        {children}
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} onRun={(id) => actions[id]?.()} />
      <ShortcutSheet open={sheetOpen} onClose={closeSheet} />
      <UnsavedDialog />
      <PrintDialog />
      <HybridSidePickDialog />
      <RevisionPanel />
      <PartyImportDialog />
      <LegacyImportDialog />
      <BackupRecoveryPrompt />
    </div>
  )
}
