import { useState } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import { WIPE_WORDS, defaultWipeOptions, isWipeConfirm, parsePoStart, type WipeLevel, type WipeOptions } from '@shared/wipe/wipeRules'
import { Button, Dialog, Input } from '../ui'

type Api = Quot3Bridge['wipe']
const api = (): Api | undefined => (window as unknown as { quot3?: { wipe?: Api } }).quot3?.wipe

/** Phase 90 - Settings > Start fresh: Level 1 (bills and customers) and Level 2 (factory reset), typed confirmation, PO restart number. */
export function StartFreshSection(): React.JSX.Element {
  const [level, setLevel] = useState<WipeLevel | null>(null)
  const [word, setWord] = useState('')
  const [po, setPo] = useState('1')
  const [opt, setOpt] = useState<WipeOptions>(defaultWipeOptions(1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const poStart = parsePoStart(po)
  const ready = level !== null && poStart !== null && isWipeConfirm(level, word) && !busy
  const open = (l: WipeLevel): void => { setLevel(l); setWord(''); setPo('1'); setError(''); setOpt(defaultWipeOptions(l)) }
  const close = (): void => { if (!busy) { setLevel(null); setWord(''); setError('') } }
  const flip = (k: 'removeBackups' | 'removeThemes' | 'removeLogs' | 'removeAssets'): void => setOpt((o) => ({ ...o, [k]: !o[k] }))

  const go = async (): Promise<void> => {
    if (!ready || level === null || poStart === null) return
    const a = api()
    if (!a) { setError('Start fresh is not available (no connection to the app).'); return }
    setBusy(true); setError('')
    try {
      const r = await a.start({ ...opt, level, poStart }, word)
      if (!r.ok) { setError(r.error.message); setBusy(false); return }
      setDone(`Your data was saved first as ${r.data.backup}. The app is restarting and will open fresh.`)
      setLevel(null)
    } catch { setError('Something went wrong. Nothing was changed.'); setBusy(false) }
  }

  const check = (k: 'removeBackups' | 'removeThemes' | 'removeLogs' | 'removeAssets', label: string): React.JSX.Element => (
    <label className="q3-set__check"><input type="checkbox" checked={opt[k]} onChange={() => flip(k)} /> {label}</label>
  )

  return (
    <div className="q3-fresh" aria-label="Start fresh">
      <p className="q3-set__muted">A safety backup of everything is made first, so either choice can be undone by restoring it from Backup and restore. The app then restarts.</p>
      <p role="note" className="q3-set__muted">Other branches are not told. They keep their own bills and customers, and may send theirs to this computer again if sync is on.</p>
      {done && <p role="status" className="q3-set__notice">{done}</p>}
      <h3 className="q3-set__h">Clear bills and customers</h3>
      <p className="q3-set__muted">Removes every bill (including Recently deleted), customer, draft and import history. Keeps your company details, settings, license, branches and backups.</p>
      <div className="q3-set__row"><Button variant="danger" disabled={busy || done !== ''} onClick={() => open(1)}>Clear bills and customers...</Button></div>
      <h3 className="q3-set__h">Factory reset</h3>
      <p className="q3-set__muted">Starts this computer as if just installed: bills, customers, company details, settings and branch are removed, and the license is deactivated here (activate it again to use sync).</p>
      <div className="q3-set__row"><Button variant="danger" disabled={busy || done !== ''} onClick={() => open(2)}>Factory reset...</Button></div>
      <Dialog open={level !== null} title={level === 2 ? 'Factory reset' : 'Clear bills and customers'} onClose={close}
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="danger" disabled={!ready} onClick={() => { void go() }}>{level === 2 ? 'Reset and restart' : 'Clear and restart'}</Button></>}>
        <Input label="Next bill number starts at" value={po} inputMode="numeric" autoComplete="off" onChange={(e) => setPo(e.target.value)} />
        {poStart === null && <p role="alert" className="q3-set__error">Enter a whole number from 1 (or leave it blank for 1).</p>}
        {level === 2 && (
          <fieldset className="q3-set__group">
            <legend>Also remove (the safety backup of this reset is always kept)</legend>
            {check('removeBackups', 'Backups')}
            {check('removeThemes', 'Custom themes')}
            {check('removeLogs', 'Logs')}
            {check('removeAssets', 'Logo and other uploaded files')}
          </fieldset>
        )}
        <p>Other branches keep their data and may send it again. Type {level ? WIPE_WORDS[level] : ''} to confirm.</p>
        <Input label={`Type ${level ? WIPE_WORDS[level] : ''}`} value={word} data-autofocus autoComplete="off" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void go() } }} />
        {error && <p role="alert" className="q3-set__error">{error}</p>}
      </Dialog>
    </div>
  )
}
