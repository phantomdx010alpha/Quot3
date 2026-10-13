import { useEffect, useState } from 'react'
import { bigGridBill, legacyGridBill } from '@shared/__fixtures__/gridBills'
import { BillGrid, GridStatus } from '../../components/grid'
import { FormatToolbar } from '../../components/create/FormatToolbar'
import { FormatSwitcher } from '../../components/create/FormatSwitcher'
import { ExtraColsToolbar } from '../../components/create/ExtraColsToolbar'
import { BottomBar } from '../../components/create/BottomBar'
import { useBillStore } from '../../stores/billStore'

type Fixture = 'legacy' | 'big'

/** /dev/grid — grid on the legacy fixture or an 80-row fixture. Dev route (Phase 9); the real format switcher arrived in Phase 20. */
export default function GridDev(): React.JSX.Element {
  const [fixture, setFixture] = useState<Fixture>('legacy')
  const loadBill = useBillStore((s) => s.loadBill)

  useEffect(() => {
    loadBill(fixture === 'legacy' ? legacyGridBill() : bigGridBill(80))
  }, [fixture, loadBill])

  return (
    <div className="q3-gdev">
      <div className="q3-gdev__bar">
        <h1>Grid (dev)</h1>
        <label>
          Fixture{' '}
          <select value={fixture} onChange={(e) => setFixture(e.target.value as Fixture)}>
            <option value="legacy">Legacy screenshot bill</option>
            <option value="big">80 rows</option>
          </select>
        </label>
        <FormatSwitcher />
        <FormatToolbar />
        <ExtraColsToolbar />
        <span>Click the grid or Tab into it. Arrows/Tab/Enter move; Left twice or F2 = edit in place; Esc = back to append.</span>
      </div>
      <div className="q3-gdev__grid">
        <BillGrid />
      </div>
      <BottomBar>
        <GridStatus />
      </BottomBar>
    </div>
  )
}
