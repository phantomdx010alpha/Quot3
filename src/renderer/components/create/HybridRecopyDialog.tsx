import { ConfirmDialog } from '../ui'
import { confirmRecopy, useHybridUiStore } from '../../stores/hybridActions'
import { useGridUiStore } from '../../stores/gridUiStore'

/** Phase 151 - "Re-copy from the other side" always asks first: it replaces one table's items (its own adjustments are kept). Ctrl+Z undoes it. */
export function HybridRecopyDialog(): React.JSX.Element {
  const target = useHybridUiStore((s) => s.recopyTarget)
  const mine = target === 'gst' ? 'GST' : 'Non-GST'
  const other = target === 'gst' ? 'Non-GST' : 'GST'
  const refocus = (): void => useGridUiStore.getState().refocus?.()
  return (
    <ConfirmDialog
      open={target !== null}
      title={`Re-copy the ${mine} table?`}
      message={`The ${mine} table's items will be replaced with fresh copies of the ${other} table's names, quantities and amounts. Its own adjustments are kept. Ctrl+Z brings the old items back.`}
      confirmLabel="Re-copy"
      danger
      onConfirm={() => { confirmRecopy(); refocus() }}
      onCancel={() => { useHybridUiStore.getState().closeRecopy(); refocus() }}
    />
  )
}
