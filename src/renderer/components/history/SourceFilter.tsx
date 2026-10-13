import { useEffect, useState } from 'react'
import { FolderOpen } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { formatHistoryDate, type HistorySource } from '@shared/history/historyList'
import type { LegacyBatchInfo, Quot3Bridge } from '@shared/ipc'
import { Button } from '../ui'
import { useHistoryStore } from '../../stores/historyStore'
import { useLegacyImportStore } from '../../stores/legacyImportStore'

type Api = Quot3Bridge['legacyImport']
const api = (): Api | undefined => (window as unknown as { quot3?: { legacyImport?: Api } }).quot3?.legacyImport

/** Phase 86 - History source filter: All / Created here / Imported (+ a batch picker inside Imported) and a shortcut to the importer. */
export function SourceFilter(): React.JSX.Element | null {
  const source = useHistoryStore((s) => s.source)
  const batch = useHistoryStore((s) => s.batch)
  const tick = useLegacyImportStore((s) => s.changeTick)
  const [batches, setBatches] = useState<LegacyBatchInfo[]>([])

  useEffect(() => {
    let live = true
    void api()?.list().then((r) => { if (live && r.ok) setBatches(r.data.filter((b) => b.undoneAt === null && b.created > 0)) }).catch(() => undefined)
    return () => { live = false }
  }, [tick])

  const keys = primaryKeys('legacyImport.open')
  return (
    <div className="q3-hist__source" role="group" aria-label="Source filter">
      <label className="q3-hist__branch">
        <span>Source</span>
        <select className="q3-select nm-inset nm-sm" aria-label="Source filter" value={source} onChange={(e) => { void useHistoryStore.getState().setSource(e.target.value as HistorySource, '') }}>
          <option value="all">All bills</option>
          <option value="created">Created here</option>
          <option value="imported">Imported</option>
        </select>
      </label>
      {source === 'imported' && batches.length > 0 && (
        <label className="q3-hist__branch">
          <span>Import</span>
          <select className="q3-select nm-inset nm-sm" aria-label="Import batch" value={batch} onChange={(e) => { void useHistoryStore.getState().setSource('imported', e.target.value) }}>
            <option value="">Every import</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{`${formatHistoryDate(b.at.slice(0, 10))} - ${b.created} bills - ${b.sourceLabel}`}</option>)}
          </select>
        </label>
      )}
      <Button size="sm" variant="ghost" icon={FolderOpen} shortcut={keys ?? ''} title="Import bills from the old app" onClick={() => { void useLegacyImportStore.getState().open() }}>Import old bills</Button>
    </div>
  )
}
