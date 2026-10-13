import { useEffect, useRef } from 'react'
import { FileXls, FolderOpen } from '@phosphor-icons/react'
import { Button, EmptyState } from '../components/ui'
import { CompanySection } from '../components/settings/CompanySection'
import { BranchSection } from '../components/settings/BranchSection'
import { ImageQualitySection, PrintSection } from '../components/settings/PrintSection'
import { BehaviourSection } from '../components/settings/BehaviourSection'
import { ThemesSection } from '../components/settings/ThemesSection'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { ShortcutsSection } from '../components/settings/ShortcutsSection'
import { DashboardSection } from '../components/settings/DashboardSection'
import { BackupSection } from '../components/settings/BackupSection'
import { AuditSection } from '../components/settings/AuditSection'
import { StartFreshSection } from '../components/settings/StartFreshSection'
import { AboutSection } from '../components/settings/AboutSection'
import { UpdatesSection } from '../components/settings/UpdatesSection'
import { SyncSection } from '../components/settings/SyncSection'
import { SyncStatusPanel } from '../components/sync/SyncStatusPanel'
import { BootstrapPanel } from '../components/settings/BootstrapPanel'
import { usePartyImportStore } from '../stores/partyImportStore'
import { useLegacyImportStore } from '../stores/legacyImportStore'
import { SETTINGS_SECTIONS, useSettingsStore, type SettingsSection } from '../stores/settingsStore'
import { GearSix } from '@phosphor-icons/react'

/**
 * Phase 48 - Settings: a section list (Up/Down move and open, Tab goes into the form) and one form per section. Company, Branch,
 * Print and Behaviour save with Enter or their button; a refused value shows its reason under the form. Esc goes back (app-wide).
 */
export default function Settings(): React.JSX.Element {
  const { section, status, loadError, data, savedAt } = useSettingsStore()
  const navRef = useRef<HTMLDivElement>(null)
  useEffect(() => { void useSettingsStore.getState().load() }, [])

  const onNavKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = SETTINGS_SECTIONS.findIndex((s) => s.id === section)
    const next = SETTINGS_SECTIONS[Math.min(SETTINGS_SECTIONS.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]!
    useSettingsStore.getState().setSection(next.id)
    queueMicrotask(() => navRef.current?.querySelector<HTMLButtonElement>(`[data-section="${next.id}"]`)?.focus())
  }

  const body = (id: SettingsSection): React.JSX.Element => {
    switch (id) {
      case 'company': return <CompanySection />
      case 'branch': return <BranchSection />
      case 'print': return <><PrintSection /><ImageQualitySection /></>
      case 'behaviour': return <BehaviourSection />
      case 'themes': return <ThemesSection />
      case 'appearance': return <AppearanceSection />
      case 'shortcuts': return <ShortcutsSection />
      case 'dashboard': return <DashboardSection />
      case 'sync': return <><SyncStatusPanel /><SyncSection /><BootstrapPanel /></>
      case 'audit': return <AuditSection />
      case 'updates': return <UpdatesSection />
      case 'fresh': return <StartFreshSection />
      case 'about': return <AboutSection />
      default: return <BackupSection />
    }
  }

  return (
    <div className="q3-page q3-set">
      <h1 className="q3-page__title">Settings</h1>
      {status === 'error' && !data ? (
        <div role="alert" className="q3-set__error">{loadError}</div>
      ) : !data ? (
        <EmptyState icon={GearSix} title="Loading settings" description="One moment." />
      ) : (
        <div className="q3-set__layout">
          <div className="q3-set__nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections" ref={navRef} onKeyDown={onNavKey}>
            {SETTINGS_SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" data-section={s.id} aria-selected={s.id === section} tabIndex={s.id === section ? 0 : -1}
                className={`q3-set__tab${s.id === section ? ' q3-set__tab--on' : ''}`} onClick={() => useSettingsStore.getState().setSection(s.id)}>
                {s.label}
              </button>
            ))}
            <Button variant="ghost" icon={FileXls} shortcut="Ctrl+Shift+J" onClick={() => { void usePartyImportStore.getState().start() }}>Import parties</Button>
            <Button variant="ghost" icon={FolderOpen} shortcut="Ctrl+Shift+L" onClick={() => { void useLegacyImportStore.getState().open() }}>Import legacy bills</Button>
          </div>
          <div className="q3-set__body" role="tabpanel" aria-label={SETTINGS_SECTIONS.find((s) => s.id === section)?.label}>
            {body(section)}
            {savedAt > 0 && <p className="q3-set__saved" role="status">Saved.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
