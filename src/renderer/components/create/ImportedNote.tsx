import { useEffect, useState } from 'react'
import { importedNote, type LegacyBillTag } from '@shared/legacyImport/uiModel'
import type { Quot3Bridge } from '@shared/ipc'
import { Badge } from '../ui'
import { useBillStore } from '../../stores/billStore'

type Api = Quot3Bridge['legacyImport']
const api = (): Api | undefined => (window as unknown as { quot3?: { legacyImport?: Api } }).quot3?.legacyImport

/**
 * Phase 86 - the small "Imported" mark in the bill header of a bill that came from the old app (LEGACY_IMPORT_SPEC section 8):
 * `Imported from the old app - old number BR1_106 - 08-10-26` is the tooltip / screen-reader text. Renders nothing for a bill made here
 * or an unsaved bill; the tag survives edits (it is stored on the bill row, not in the bill document).
 */
export function ImportedNote(): React.JSX.Element | null {
  const billId = useBillStore((s) => s.billId)
  const billDate = useBillStore((s) => s.billDate)
  const [tag, setTag] = useState<LegacyBillTag | null>(null)

  useEffect(() => {
    let live = true
    setTag(null)
    if (!billId) return
    void api()?.billTag(billId).then((r) => { if (live && r.ok) setTag(r.data) }).catch(() => undefined)
    return () => { live = false }
  }, [billId])

  if (!tag) return null
  const text = importedNote(tag, billDate)
  return (
    <div className="q3-pbar__f q3-pbar__f--imp" title={text} data-testid="imported-note">
      <span className="q3-pbar__l">Source</span>
      <Badge tone="info" aria-label={text}>{`Imported \u00b7 ${tag.legacyRef}`}</Badge>
    </div>
  )
}
