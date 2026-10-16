import { contextBridge, ipcRenderer } from 'electron'
import { isEventChannel, type Quot3Bridge, type Result } from '../shared/ipc'

/** `syncShared:*` failures carry the transport kind in `details.kind`; the screen routes a refusal to its field by `error.kind`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withKind(call: Promise<unknown>): Promise<any> {
  const r = (await call) as Result<unknown>
  if (r.ok) return r
  const kind = (r.error.details as { kind?: unknown } | undefined)?.kind
  return typeof kind === 'string' ? { ok: false, error: { code: r.error.code, message: r.error.message, kind } } : r
}

// The ONLY door from the renderer to the world: a small, named, typed API.
// Never expose ipcRenderer itself or a generic "invoke any channel".
const bridge: Quot3Bridge = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo', {}),
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder', {}),
    getDbInfo: () => ipcRenderer.invoke('app:getDbInfo', {}),
    confirmQuit: () => ipcRenderer.invoke('app:confirmQuit', {})
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', { key }),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
    getAll: () => ipcRenderer.invoke('settings:getAll', {})
  },
  appSettings: {
    get: () => ipcRenderer.invoke('appSettings:get', {}),
    saveCompany: (input) => ipcRenderer.invoke('appSettings:saveCompany', input),
    chooseLogo: () => ipcRenderer.invoke('appSettings:chooseLogo', {}),
    removeLogo: () => ipcRenderer.invoke('appSettings:removeLogo', {}),
    savePrefix: (prefix) => ipcRenderer.invoke('appSettings:savePrefix', { prefix }),
    savePrint: (input) => ipcRenderer.invoke('appSettings:savePrint', input),
    saveBehaviour: (input) => ipcRenderer.invoke('appSettings:saveBehaviour', input),
    saveImage: (input) => ipcRenderer.invoke('appSettings:saveImage', input),
    saveNav: (input) => ipcRenderer.invoke('appSettings:saveNav', input),
    saveCalc: (input) => ipcRenderer.invoke('appSettings:saveCalc', input),
    printers: () => ipcRenderer.invoke('appSettings:printers', {})
  },
  themes: {
    list: () => ipcRenderer.invoke('themes:list', {}),
    reload: () => ipcRenderer.invoke('themes:reload', {}),
    load: (id) => ipcRenderer.invoke('themes:load', { id }),
    getActive: () => ipcRenderer.invoke('themes:getActive', {}),
    setActive: (id) => ipcRenderer.invoke('themes:setActive', { id }),
    openFolder: () => ipcRenderer.invoke('themes:openFolder', {}),
    exportStarter: (id, computed) => ipcRenderer.invoke('themes:exportStarter', { id, computed }),
    setTitleBar: (input) => ipcRenderer.invoke('themes:setTitleBar', input),
    shareStatus: () => ipcRenderer.invoke('themes:shareStatus', {}),
    shareSetEnabled: (enabled) => ipcRenderer.invoke('themes:shareSetEnabled', { enabled }),
    shareSyncNow: () => ipcRenderer.invoke('themes:shareSyncNow', {}),
    removeShared: (id) => ipcRenderer.invoke('themes:removeShared', { id })
  },
  parties: {
    list: () => ipcRenderer.invoke('parties:list', {}),
    upsert: (party) => ipcRenderer.invoke('parties:upsert', { party })
  },
  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats', {}),
    weather: (opts) => ipcRenderer.invoke('dashboard:weather', opts ?? {}),
    rates: (opts) => ipcRenderer.invoke('dashboard:rates', opts ?? {}),
    metals: (opts) => ipcRenderer.invoke('dashboard:metals', opts ?? {}),
    holidays: (count) => ipcRenderer.invoke('dashboard:holidays', count === undefined ? {} : { count }),
    searchCities: (query) => ipcRenderer.invoke('dashboard:searchCities', { query }),
    getCity: () => ipcRenderer.invoke('dashboard:getCity', {}),
    setCity: (city) => ipcRenderer.invoke('dashboard:setCity', { city }),
    getTiles: () => ipcRenderer.invoke('dashboard:getTiles', {}),
    setTiles: (tiles) => ipcRenderer.invoke('dashboard:setTiles', { tiles })
  },
  customers: {
    list: () => ipcRenderer.invoke('customers:list', {}),
    create: (customer) => ipcRenderer.invoke('customers:create', { customer }),
    update: (id, customer) => ipcRenderer.invoke('customers:update', { id, customer }),
    delete: (id) => ipcRenderer.invoke('customers:delete', { id }),
    bills: (input) => ipcRenderer.invoke('customers:bills', input),
    duplicates: () => ipcRenderer.invoke('customers:duplicates', {}),
    merge: (input) => ipcRenderer.invoke('customers:merge', input),
    notSame: (input) => ipcRenderer.invoke('customers:notSame', input),
    undoLastMerge: () => ipcRenderer.invoke('customers:undoLastMerge', {}),
    unify: () => ipcRenderer.invoke('customers:unify', {})
  },
  license: {
    status: (check) => ipcRenderer.invoke('license:status', check === undefined ? {} : { check }),
    activate: (input) => ipcRenderer.invoke('license:activate', input),
    deactivate: (confirm) => ipcRenderer.invoke('license:deactivate', { confirm })
  },
  syncShared: {
    status: (opts) => withKind(ipcRenderer.invoke('syncShared:status', opts ?? {})),
    activate: (input) => withKind(ipcRenderer.invoke('syncShared:activate', input)),
    deactivate: (input) => withKind(ipcRenderer.invoke('syncShared:deactivate', input)),
    branchNameFree: (input) => withKind(ipcRenderer.invoke('syncShared:branchNameFree', input)),
    renameBranch: (input) => withKind(ipcRenderer.invoke('syncShared:renameBranch', input)),
    listBranches: () => withKind(ipcRenderer.invoke('syncShared:listBranches', {})),
    compare: () => withKind(ipcRenderer.invoke('syncShared:compare', {}))
  },
  cutover: {
    status: () => ipcRenderer.invoke('cutover:status', {}),
    begin: () => ipcRenderer.invoke('cutover:begin', {}),
    compare: () => ipcRenderer.invoke('cutover:compare', {}),
    unify: (input) => ipcRenderer.invoke('cutover:unify', input)
  },
  audit: {
    list: (query) => ipcRenderer.invoke('audit:list', query),
    facets: () => ipcRenderer.invoke('audit:facets', {})
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state', {}),
    check: () => ipcRenderer.invoke('updates:check', {}),
    install: () => ipcRenderer.invoke('updates:install', {}),
    setBusy: (busy) => ipcRenderer.invoke('updates:setBusy', { busy }),
    setConfig: (input) => ipcRenderer.invoke('updates:setConfig', input),
    listVersions: (refresh) => ipcRenderer.invoke('updates:listVersions', refresh ? { refresh: true } : {}),
    chooseVersion: (version) => ipcRenderer.invoke('updates:chooseVersion', { version }),
    installRollback: () => ipcRenderer.invoke('updates:installRollback', {}),
    backToLatest: () => ipcRenderer.invoke('updates:backToLatest', {})
  },
  diagnostics: {
    report: (input) => ipcRenderer.invoke('diagnostics:report', input),
    copy: () => ipcRenderer.invoke('diagnostics:copy', {}),
    crashNotice: () => ipcRenderer.invoke('diagnostics:crashNotice', {}),
    dismissCrash: () => ipcRenderer.invoke('diagnostics:dismissCrash', {})
  },
  bootstrap: {
    preview: (file) => ipcRenderer.invoke('bootstrap:preview', { file }),
    apply: (file, prefix) => ipcRenderer.invoke('bootstrap:apply', { file, ...(prefix === undefined ? {} : { prefix }) })
  },
  sync: {
    outbox: () => ipcRenderer.invoke('sync:outbox', {}),
    setEditor: (billId) => ipcRenderer.invoke('sync:editor', { billId }),
    held: () => ipcRenderer.invoke('sync:held', {}),
    resolveHeld: (input) => ipcRenderer.invoke('sync:resolveHeld', input),
    conflicts: () => ipcRenderer.invoke('sync:conflicts', {}),
    dismissConflict: (billId) => ipcRenderer.invoke('sync:dismissConflict', { billId }),
    status: () => ipcRenderer.invoke('sync:status', {}),
    setEnabled: (enabled) => ipcRenderer.invoke('sync:setEnabled', { enabled }),
    retry: (ids) => ipcRenderer.invoke('sync:retry', ids === undefined ? {} : { ids }),
    now: () => ipcRenderer.invoke('sync:now', {})
  },
  wipe: {
    start: (options, confirm) => ipcRenderer.invoke('wipe:start', { options, confirm })
  },
  publisher: {
    copyEmail: () => ipcRenderer.invoke('publisher:copyEmail', {}),
    openMail: () => ipcRenderer.invoke('publisher:openMail', {})
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create', {}),
    list: () => ipcRenderer.invoke('backup:list', {}),
    status: () => ipcRenderer.invoke('backup:status', {}),
    restore: (file, confirm) => ipcRenderer.invoke('backup:restore', { file, confirm }),
    delete: (file) => ipcRenderer.invoke('backup:delete', { file }),
    importFile: () => ipcRenderer.invoke('backup:importFile', {}),
    resetLocalData: (confirm) => ipcRenderer.invoke('backup:resetLocalData', { confirm })
  },
  legacyImport: {
    pick: (kind) => ipcRenderer.invoke('legacyImport:pick', { kind }),
    preview: (input) => ipcRenderer.invoke('legacyImport:preview', input),
    commit: (input) => ipcRenderer.invoke('legacyImport:commit', input),
    cancel: () => ipcRenderer.invoke('legacyImport:cancel', {}),
    release: (sourceId) => ipcRenderer.invoke('legacyImport:release', { sourceId }),
    saveReport: (input) => ipcRenderer.invoke('legacyImport:saveReport', input),
    undo: (batchId) => ipcRenderer.invoke('legacyImport:undo', { batchId }),
    list: () => ipcRenderer.invoke('legacyImport:list', {}),
    billTag: (billId) => ipcRenderer.invoke('legacyImport:billTag', { billId })
  },
  legacyWatch: {
    status: () => ipcRenderer.invoke('legacyWatch:status', {}),
    scanNow: () => ipcRenderer.invoke('legacyWatch:scanNow', {}),
    pause: (paused) => ipcRenderer.invoke('legacyWatch:pause', { paused }),
    pickFolder: () => ipcRenderer.invoke('legacyWatch:pickFolder', {}),
    reviewList: () => ipcRenderer.invoke('legacyWatch:reviewList', {}),
    reviewCount: () => ipcRenderer.invoke('legacyWatch:reviewCount', {}),
    reviewResolve: (input) => ipcRenderer.invoke('legacyWatch:reviewResolve', input),
    activityList: () => ipcRenderer.invoke('legacyWatch:activityList', {}),
    activityUndo: (id) => ipcRenderer.invoke('legacyWatch:activityUndo', { id })
  },
  partyImport: {
    pickFile: () => ipcRenderer.invoke('partyImport:pickFile', {}),
    preview: (input) => ipcRenderer.invoke('partyImport:preview', input),
    commit: (input) => ipcRenderer.invoke('partyImport:commit', input),
    undo: (importId) => ipcRenderer.invoke('partyImport:undo', { importId }),
    list: () => ipcRenderer.invoke('partyImport:list', {})
  },
  items: {
    overview: () => ipcRenderer.invoke('items:overview', {}),
    group: (input) => ipcRenderer.invoke('items:group', input),
    sales: (input) => ipcRenderer.invoke('items:sales', input),
    rebuild: () => ipcRenderer.invoke('items:rebuild', {}),
    openTarget: (input) => ipcRenderer.invoke('items:openTarget', input),
    decide: (input) => ipcRenderer.invoke('items:decide', input),
    undo: () => ipcRenderer.invoke('items:undo', {}),
    lastDecision: () => ipcRenderer.invoke('items:lastDecision', {})
  },
  history: {
    listDates: (input) => ipcRenderer.invoke('history:listDates', input ?? {}),
    listBills: (input) => ipcRenderer.invoke('history:listBills', input ?? {}),
    search: (input) => ipcRenderer.invoke('history:search', input),
    branches: () => ipcRenderer.invoke('history:branches', {})
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list', {}),
    restore: (input) => ipcRenderer.invoke('trash:restore', input),
    purge: (input) => ipcRenderer.invoke('trash:purge', input),
    emptyTrash: (input) => ipcRenderer.invoke('trash:emptyTrash', input)
  },
  revisions: {
    list: (input) => ipcRenderer.invoke('revisions:list', input),
    get: (input) => ipcRenderer.invoke('revisions:get', input),
    restoreToDraft: (input) => ipcRenderer.invoke('revisions:restoreToDraft', input)
  },
  bills: {
    getForEdit: (id) => ipcRenderer.invoke('bills:getForEdit', { id }),
    delete: (input) => ipcRenderer.invoke('bills:delete', input),
    newDefaults: () => ipcRenderer.invoke('bills:newDefaults', {}),
    save: (input) => ipcRenderer.invoke('bills:save', input)
  },
  drafts: {
    save: (input) => ipcRenderer.invoke('drafts:save', input),
    list: () => ipcRenderer.invoke('drafts:list', {}),
    get: (id) => ipcRenderer.invoke('drafts:get', { id }),
    delete: (id) => ipcRenderer.invoke('drafts:delete', { id })
  },
  clipboard: {
    readGrid: () => ipcRenderer.invoke('clipboard:readGrid', {}),
    writeTsv: (input) => ipcRenderer.invoke('clipboard:writeTsv', input)
  },
  print: {
    decide: (input) => ipcRenderer.invoke('print:decide', input),
    decideQuick: (input) => ipcRenderer.invoke('print:decideQuick', input),
    print: (input) => ipcRenderer.invoke('print:print', input),
    pdf: (input) => ipcRenderer.invoke('print:pdf', input),
    openPdf: (input) => ipcRenderer.invoke('print:openPdf', input)
  },
  image: {
    copy: (input) => ipcRenderer.invoke('image:copy', input),
    prerender: (input) => ipcRenderer.invoke('image:prerender', input)
  },
  on(channel, callback) {
    if (!isEventChannel(channel)) return () => undefined
    const listener = (_event: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('quot3', bridge)
