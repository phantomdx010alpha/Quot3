import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { activeTab, canGoBack, createRouter, currentRoute, goBack, navigate, navigateTab, type RouteName, type RouterState, type TabRoute } from './router'
import { detectCapabilities, readBrowserEnv, type Capabilities } from './platform/flags'
import { browserBackEnv, installBackGuard, type BackEnv } from './platform/backButton'
import { registerServiceWorker, shouldCheckForUpdate, updateBannerModel, type UpdateHandle } from './platform/swUpdate'
import { isOnline, OFFLINE_NOTE, watchOnline } from './platform/online'
import { browserInstallEnv, createInstallController, type InstallController } from './platform/installPrompt'
import { browserMarkerStore, checkDataCleared, CLEARED_NOTE } from './platform/clearedData'
import { getMeta } from './data/metaRepo'
import { countRecords } from './data/db'
import { loadVersionGate } from './ui/versionGate'
import { setSetting } from './data/settingsRepo'
import { LAYOUTS, planLayoutChange, resolveLayout, type LayoutId } from './ui/layouts/layoutRegistry'
import type { ScreenProps } from './ui/layouts/types'
import type { StatusActionId, StatusFlags } from './ui/kit/statusModel'
import { BottomNav } from './ui/BottomNav'
import { BillView } from './ui/BillView'
import { Dashboard } from './ui/Dashboard'
import { History } from './ui/History'
import { Customers, CustomerPage } from './ui/Customers'
import { LockScreen } from './ui/LockScreen'
import { Settings } from './ui/Settings'
import { createAppLock, type AppLock } from './sync/appLock'
import { Trash } from './ui/Trash'
import { BillEditor, type EditorApi } from './ui/editor/BillEditor'
import type { DashboardView } from './ui/dashboardModel'
import { loadDashboard } from './ui/loadDashboard'
import { AboutPage } from './ui/AboutPage'
import type { AppServices } from './ui/services'
import { DEFAULT_THEME, type ThemeName } from './ui/themes'
import { settingsPageLabel } from './ui/settingsPages'
import { plainText } from './ui/kit/plainWords'

const VERSION = typeof __QUOT3_APP_VERSION__ === 'string' ? __QUOT3_APP_VERSION__ : 'unknown'

function yesNo(v: boolean): string {
  return v ? 'yes' : 'no'
}

const TITLES: Record<RouteName, string> = {
  home: 'Quot3',
  history: 'History',
  create: 'New bill',
  customers: 'Customers',
  settings: 'Settings',
  about: 'About',
  billview: 'Bill',
  trash: 'Recently deleted',
  customer: 'Customer'
}

export interface AppProps {
  services?: AppServices
  /** Tests pass a fake; the app uses the browser's history. */
  backEnv?: BackEnv | null
}

/** Phone shell (Phase 180): top bar, Dashboard as the root page, bottom navigation, Back rule. History, editor, Customers and the real
 *  Settings are placeholders until their phases. */
export function App(props: AppProps = {}): ReactElement {
  const services = props.services
  const [router, setRouter] = useState<RouterState>(() => createRouter('home'))
  const [installSeen, setInstallSeen] = useState(false)
  const [online, setOnline] = useState(() => (typeof window === 'undefined' ? true : isOnline(window)))
  const [installReady, setInstallReady] = useState(false)
  const [installHidden, setInstallHidden] = useState(false)
  const [gateNote, setGateNote] = useState<string | null>(null)
  const [clearedNote, setClearedNote] = useState<string | null>(null)
  const installRef = useRef<InstallController | null>(null)
  const [update, setUpdate] = useState<UpdateHandle | null>(null)
  const [caps, setCaps] = useState<Capabilities>(() => detectCapabilities(readBrowserEnv(false)))
  const [theme, setTheme] = useState<ThemeName>(services?.theme ?? DEFAULT_THEME)
  // Phase 189: the chosen phone layout. Only `classic` is built so far; `LAYOUTS` is the registry (a new layout's phase adds its screens).
  const [layout, setLayout] = useState<LayoutId>(() => resolveLayout(services?.layout))
  const [view, setView] = useState<DashboardView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(services?.error ?? null)
  // Phase 182: the open bill's dirty flag (reported by the editor). While it is set, every way out asks Save / Discard first.
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  // Phase 185: the PIN screen shows first when the app lock was on at start.
  const [locked, setLocked] = useState(services?.startLocked === true)
  const appLock = useMemo<AppLock | null>(() => (services?.db ? createAppLock(services.db) : null), [services?.db])
  // Phase 192: the bill that was just saved from a NEW layout's editor, so its bill view shows the "Saved" sheet (classic never sets it).
  const [savedId, setSavedId] = useState<string | null>(null)
  const editorApi = useRef<EditorApi | null>(null)
  const silentSaved = useRef(false)

  const routerRef = useRef(router)
  routerRef.current = router
  const unsavedRef = useRef(hasUnsavedWork)
  unsavedRef.current = hasUnsavedWork
  // Phase 193: the guided layout steps back inside its editor before the unsaved guard runs (`interceptBack`).
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const stepBackInEditor = (): boolean => {
    const def = LAYOUTS[layoutRef.current]
    return currentRoute(routerRef.current).name === 'create' && def !== undefined && def.id !== 'classic' && def.interceptBack?.() === true
  }

  useEffect(() => {
    const instEnv = browserInstallEnv()
    const inst = instEnv ? createInstallController(instEnv) : null
    installRef.current = inst
    const offInst = inst?.subscribe(() => { setInstallSeen(inst.canInstall() || inst.installed()); setInstallReady(inst.canInstall()) })
    const offOnline = watchOnline(window, setOnline)
    // Phase 186: look for a newer version at start, when the app comes back to the front, and hourly while open.
    let checkNow: (() => Promise<void>) | null = null
    let last: number | null = null
    const maybeCheck = (): void => {
      const t = Date.now()
      if (!checkNow || !shouldCheckForUpdate(last, t)) return
      last = t
      void checkNow()
    }
    const onVisible = (): void => { if (document.visibilityState === 'visible') maybeCheck() }
    document.addEventListener('visibilitychange', onVisible)
    void registerServiceWorker(setUpdate).then((fn) => { checkNow = fn; maybeCheck() })
    const timer = window.setInterval(maybeCheck, 10 * 60 * 1000)
    return () => {
      offInst?.(); inst?.stop(); offOnline()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setCaps(detectCapabilities(readBrowserEnv(installSeen)))
  }, [installSeen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // The CSS scope for the new layouts' larger tokens (`:root[data-layout=...]`). Classic has no rules under it.
  useEffect(() => {
    document.documentElement.dataset.layout = (LAYOUTS[layout] ?? LAYOUTS.classic)!.id
  }, [layout])

  // System Back: step back inside the app; at the Dashboard let it leave. An unsaved bill blocks it (Phase 182 shows the Save / Discard prompt).
  useEffect(() => {
    const env = props.backEnv === undefined ? browserBackEnv() : props.backEnv
    if (!env) return undefined
    return installBackGuard(env, {
      handleBack: () => {
        if (stepBackInEditor()) return true
        if (unsavedRef.current) { setPendingLeave(() => () => setRouter((r) => goBack(r))); return true }
        if (!canGoBack(routerRef.current)) return false
        setRouter((r) => goBack(r))
        return true
      }
    })
  }, [props.backEnv])

  const cur = currentRoute(router)
  const route = cur.name
  const db = services?.db ?? null
  const now = services?.now

  useEffect(() => { if (route !== 'billview') setSavedId(null) }, [route])

  // Phase 192: the flags the status pill of a new layout draws (the SAME values the classic banners above use).
  const readOnly = db ? !db.canWrite() : false
  const statusFlags = useMemo<StatusFlags>(() => ({
    readOnly, offline: !online, gateNote, clearedNote,
    update: update ? { text: updateBannerModel({ hasUnsavedWork }).text, canReload: updateBannerModel({ hasUnsavedWork }).canReload } : null,
    installOffer: installReady && !installHidden && !update, sync: null
  }), [readOnly, online, gateNote, clearedNote, update, hasUnsavedWork, installReady, installHidden])

  // Phase 186: version gate (records from a newer app are kept aside) and the "storage cleared" check, at start and when Home / Settings opens.
  useEffect(() => {
    if (!db || (route !== 'home' && route !== 'settings')) return undefined
    let cancelled = false
    void (async () => {
      const note = await loadVersionGate(db)
      let cleared: string | null = null
      try {
        const [meta, bills, customers] = await Promise.all([getMeta(db), countRecords(db, 'bills'), countRecords(db, 'parties')])
        const verdict = checkDataCleared({ bills, customers, linked: meta.branch_id !== null }, browserMarkerStore())
        cleared = verdict === 'cleared' ? CLEARED_NOTE : null
      } catch { /* a read problem is shown by the screens themselves */ }
      if (!cancelled) { setGateNote(note); setClearedNote(cleared) }
    })()
    return () => { cancelled = true }
  }, [db, route])

  useEffect(() => {
    if (route !== 'home' || !db) return undefined
    let cancelled = false
    loadDashboard(db, now ? now() : new Date(), services?.engine ?? null).then(
      (v) => { if (!cancelled) { setView(v); setLoadError(null) } },
      (e: unknown) => { if (!cancelled) setLoadError(`Could not read your bills: ${e instanceof Error ? e.message : String(e)}`) }
    )
    return () => { cancelled = true }
  }, [route, db, now, services?.engine])

  /** Runs a way out of the page; with an unsaved bill it asks first (Save / Discard / Keep editing). */
  const leave = useCallback((action: () => void) => { if (unsavedRef.current) setPendingLeave(() => action); else action() }, [])
  const selectTab = useCallback((tab: TabRoute) => leave(() => setRouter((r) => navigateTab(r, tab))), [leave])
  const clearDirty = (): void => { unsavedRef.current = false; setHasUnsavedWork(false) }
  const promptSave = async (): Promise<void> => {
    const act = pendingLeave
    silentSaved.current = true
    const ok = (await editorApi.current?.save()) ?? true
    silentSaved.current = false
    if (!ok) return
    clearDirty(); setPendingLeave(null); act?.()
  }
  const promptDiscard = async (): Promise<void> => {
    const act = pendingLeave
    await editorApi.current?.discard()
    clearDirty(); setPendingLeave(null); act?.()
  }

  const aboutRows = [
    { label: 'Persistent storage API', value: yesNo(caps.persistentStorage) },
    { label: 'Share files', value: yesNo(caps.webShareFiles) },
    { label: 'Single-writer lock', value: yesNo(caps.webLocks) },
    { label: 'Offline shell', value: yesNo(caps.serviceWorker) },
    { label: 'Installed or installable', value: yesNo(caps.installable) }
  ]

  /** Phase 189: a layout change applies at once and is saved (settings store only: no bill, party, draft or outbox write). With an unsaved bill it is
   *  held behind the same Save / Discard / Keep editing prompt as every other way out. The page stays when the new layout has it, otherwise Home. */
  const chooseLayout = (next: LayoutId): void => {
    const plan = planLayoutChange({ current: layout, next, hasUnsaved: unsavedRef.current, route })
    if (plan.action === 'none') return
    const apply = (): void => {
      setLayout(plan.layout)
      if (!plan.keepRoute) setRouter(createRouter('home'))
      if (db && db.canWrite()) void setSetting(db, 'ui.layout', plan.layout).catch(() => undefined)
    }
    if (plan.action === 'hold') setPendingLeave(() => apply)
    else apply()
  }

  const chooseTheme = (next: ThemeName): void => {
    setTheme(next)
    if (db && db.canWrite()) void setSetting(db, 'theme.name', next).catch(() => undefined)
  }

  if (locked && appLock) return <LockScreen lock={appLock} onUnlocked={() => setLocked(false)} />

  /** Phase 192: a NEW layout draws the same state with its own Shell and screens. App keeps every guard (this prompt included). */
  const built = LAYOUTS[layout]
  if (built && built.id !== 'classic') {
    const Shell = built.Shell
    const Screen = built.screens[route]
    const title = route === 'settings' && cur.param ? plainText(settingsPageLabel(cur.param)) : TITLES[route]
    const screenProps: ScreenProps = {
      db, now, param: cur.param, onNavigate: (r, p) => setRouter((x) => navigate(x, r, p)), onChanged: services?.onDataChanged,
      onBack: () => setRouter((r) => goBack(r)), dashboard: { view, error: loadError },
      justSaved: route === 'billview' && savedId !== null && savedId === cur.param, onSavedDone: () => setSavedId(null)
    }
    const onStatusAction = (a: StatusActionId): void => {
      if (a === 'tryAgain') { try { window.location.reload() } catch { /* nothing else to do */ } }
      else if (a === 'reload') update?.apply(() => !unsavedRef.current)
      else if (a === 'install') void installRef.current?.prompt()
      else if (a === 'hideInstall') setInstallHidden(true)
    }
    return (
      <>
        <Shell route={route} param={cur.param} canGoBack={canGoBack(router)} onBack={() => { if (!stepBackInEditor()) leave(() => setRouter((r) => goBack(r))) }} onSelectTab={selectTab} activeTab={activeTab(router)} title={title} status={statusFlags} onStatusAction={onStatusAction}>
          {route === 'create' ? (
            <built.Editor
              key={cur.param ?? 'new'} db={db} id={cur.param} now={now} apiRef={editorApi} onDirtyChange={setHasUnsavedWork} onChanged={services?.onDataChanged}
              onSaved={(id) => { if (!silentSaved.current) { setSavedId(id); setRouter((r) => navigate(goBack(r), 'billview', id)) } }}
            />
          ) : Screen ? (
            <Screen {...screenProps} />
          ) : route === 'trash' ? (
            <Trash db={db} onChanged={services?.onDataChanged} />
          ) : route === 'about' ? (
            <AboutPage version={VERSION} rows={aboutRows} now={now} />
          ) : route === 'settings' ? (
            <Settings
              db={db} version={VERSION} theme={theme} onTheme={chooseTheme} layout={layout} onLayout={chooseLayout} plain page={cur.param} onOpenPage={(id) => setRouter((r) => navigate(r, 'settings', id))} aboutRows={aboutRows}
              sync={services?.sync} engine={services?.syncEngine} now={now} appLock={appLock ?? undefined} onChanged={services?.onDataChanged}
            />
          ) : route === 'customers' ? (
            <Customers db={db} onOpen={(id) => setRouter((r) => navigate(r, 'customer', id))} onAdd={() => setRouter((r) => navigate(r, 'customer', 'new'))} />
          ) : route === 'customer' && cur.param ? (
            <CustomerPage
              key={cur.param} db={db} id={cur.param} now={now} onChanged={services?.onDataChanged} onOpenBill={(id) => setRouter((r) => navigate(r, 'billview', id))}
              onAdded={(id) => setRouter((r) => navigate(goBack(r), 'customer', id))}
            />
          ) : null}
        </Shell>
        {pendingLeave ? (
          <div className="q3-modal" role="dialog" aria-modal="true" aria-label="Unsaved bill">
            <div className="q3-modal-card">
              <p>This bill has changes that are not saved.</p>
              <button type="button" className="q3-btn q3-btn-primary" onClick={() => { void promptSave() }}>Save</button>
              <button type="button" className="q3-btn" onClick={() => { void promptDiscard() }}>Discard</button>
              <button type="button" className="q3-btn" onClick={() => setPendingLeave(null)}>Keep editing</button>
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div className="q3-shell">
      {db && !db.canWrite() ? (
        <div className="q3-banner" role="alert">
          <span>Quot3 is open in another window or tab, so this one is read-only (nothing can be saved). Close the other one, then tap Try again.</span>
          <button className="q3-btn q3-btn-primary" onClick={() => { try { window.location.reload() } catch { /* nothing else to do */ } }}>Try again</button>
        </div>
      ) : null}
      {!online ? <div className="q3-banner" role="status"><span>{OFFLINE_NOTE}</span></div> : null}
      {gateNote ? <div className="q3-banner" role="status"><span>{gateNote}</span></div> : null}
      {clearedNote ? <div className="q3-banner" role="alert"><span>{clearedNote}</span></div> : null}
      {update ? (
        <div className="q3-banner" role="status">
          <span>{updateBannerModel({ hasUnsavedWork }).text}</span>
          <button className="q3-btn q3-btn-primary" disabled={!updateBannerModel({ hasUnsavedWork }).canReload} onClick={() => update.apply(() => !unsavedRef.current)}>
            Reload
          </button>
        </div>
      ) : null}
      {installReady && !installHidden && !update ? (
        <div className="q3-banner" role="status">
          <span>Install Quot3 on this phone to open it like an app, even offline.</span>
          <button className="q3-btn q3-btn-primary" onClick={() => { void installRef.current?.prompt() }}>Install</button>
          <button className="q3-btn" onClick={() => setInstallHidden(true)} aria-label="Hide install offer">Not now</button>
        </div>
      ) : null}
      <header className="q3-bar">
        {canGoBack(router) ? (
          <button className="q3-btn" onClick={() => leave(() => setRouter((r) => goBack(r)))} aria-label="Back">
            Back
          </button>
        ) : null}
        <h1>{route === 'settings' && cur.param ? settingsPageLabel(cur.param) : TITLES[route]}</h1>
      </header>
      <main className="q3-main">
        {route === 'home' ? (
          <Dashboard view={view} error={loadError} onOpenBill={(id) => setRouter((r) => navigate(r, 'billview', id))} />
        ) : route === 'history' ? (
          <History db={db} now={now} onOpenBill={(id) => setRouter((r) => navigate(r, 'billview', id))} onOpenTrash={() => setRouter((r) => navigate(r, 'trash'))} />
        ) : route === 'trash' ? (
          <Trash db={db} onChanged={services?.onDataChanged} />
        ) : route === 'billview' && cur.param ? (
          <BillView db={db} id={cur.param} onEdit={(id) => setRouter((r) => navigate(r, 'create', id))} onDeleted={() => setRouter((r) => goBack(r))} onChanged={services?.onDataChanged} />
        ) : route === 'create' ? (
          <BillEditor
            key={cur.param ?? 'new'} db={db} id={cur.param} now={now} apiRef={editorApi} onDirtyChange={setHasUnsavedWork} onChanged={services?.onDataChanged}
            onSaved={(id) => { if (!silentSaved.current) setRouter((r) => navigate(goBack(r), 'billview', id)) }}
          />
        ) : route === 'about' ? (
          <AboutPage version={VERSION} rows={aboutRows} now={now} />
        ) : route === 'settings' ? (
          <Settings
            db={db} version={VERSION} theme={theme} onTheme={chooseTheme} layout={layout} onLayout={chooseLayout} page={cur.param} onOpenPage={(id) => setRouter((r) => navigate(r, 'settings', id))} aboutRows={aboutRows}
            sync={services?.sync} engine={services?.syncEngine} now={now} appLock={appLock ?? undefined} onChanged={services?.onDataChanged}
          />
        ) : route === 'customers' ? (
          <Customers db={db} onOpen={(id) => setRouter((r) => navigate(r, 'customer', id))} onAdd={() => setRouter((r) => navigate(r, 'customer', 'new'))} />
        ) : route === 'customer' && cur.param ? (
          <CustomerPage
            key={cur.param} db={db} id={cur.param} now={now} onChanged={services?.onDataChanged} onOpenBill={(id) => setRouter((r) => navigate(r, 'billview', id))}
            onAdded={(id) => setRouter((r) => navigate(goBack(r), 'customer', id))}
          />
        ) : null}
      </main>
      <BottomNav active={activeTab(router)} onSelect={selectTab} />
      {pendingLeave ? (
        <div className="q3-modal" role="dialog" aria-modal="true" aria-label="Unsaved bill">
          <div className="q3-modal-card">
            <p>This bill has changes that are not saved.</p>
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => { void promptSave() }}>Save</button>
            <button type="button" className="q3-btn" onClick={() => { void promptDiscard() }}>Discard</button>
            <button type="button" className="q3-btn" onClick={() => setPendingLeave(null)}>Keep editing</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
