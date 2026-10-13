import { useEffect, useRef, useState } from 'react'
import { CUTOVER_WORDS, backupSentence } from '@shared/sync/cutover'
import { Button } from '../ui'
import { cutoverBridge, useCutoverStore } from '../../stores/cutoverStore'
import { useSharedSyncStore } from '../../stores/sharedSyncStore'
import { SharedSyncSection } from './SharedSyncSection'

export const hasCutoverBridge = (): boolean => cutoverBridge() !== undefined

/**
 * Phase 140 - the cutover wizard shown in Settings > Sync on a computer that still has the old (v1) sync. It walks the owner through
 * four steps (backup + pause old sync, sign in, compare, customers) and then hands over to the normal shared-notebook screen. The step is
 * given by main (derived from stored facts), so closing the window or restarting resumes in the right place. No secret is ever shown here;
 * the sign-in step is the normal `SharedSyncSection`. Every control is a plain focusable button (keyboard reachable).
 */
export function CutoverWizard(): React.JSX.Element {
  const { status, busy, error, note } = useCutoverStore()
  const signedIn = useSharedSyncStore((s) => s.status?.state === 'activated')
  const [closed, setClosed] = useState(false)
  const [finishedHere, setFinishedHere] = useState(false)
  const actionRef = useRef<HTMLDivElement>(null)

  useEffect(() => { void useCutoverStore.getState().load() }, [signedIn]) // signing in (step 2) moves the wizard on
  const step = status?.step
  useEffect(() => { actionRef.current?.querySelector('button')?.focus() }, [step])

  if (!status) return <p className="q3-set__muted" role="status">{error !== '' ? error : 'Loading.'}</p>
  if (closed || (!status.needed && !finishedHere)) return <SharedSyncSection />

  const words = CUTOVER_WORDS[status.step]
  const st = useCutoverStore.getState()
  const act = async (): Promise<void> => {
    if (status.step === 'backup') await st.begin()
    else if (status.step === 'compare') await st.compare()
    else if (status.step === 'unify') { if (await st.unify(false)) setFinishedHere(true) }
    else setClosed(true)
  }
  const skipUnify = async (): Promise<void> => { if (await st.unify(true)) setFinishedHere(true) }

  return (
    <div className="q3-bk" aria-label="Move to the shared notebook">
      <p className="q3-set__muted" role="status">Step {status.stepNo} of {status.stepCount}</p>
      <h3 className="q3-set__h">{words.title}</h3>
      <p>{words.body}</p>
      {status.backupFile !== '' && <p className="q3-set__muted">{backupSentence(status.backupFile)}</p>}
      {status.step === 'signin' ? <SharedSyncSection /> : (
        <div className="q3-set__row" ref={actionRef}>
          <Button variant="primary" disabled={busy} onClick={() => { void act() }}>{busy ? 'Working' : words.action}</Button>
          {status.step === 'unify' && <Button variant="ghost" disabled={busy} onClick={() => { void skipUnify() }}>Skip this step</Button>}
        </div>
      )}
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {note !== '' && <p role="status" className="q3-set__saved">{note}</p>}
    </div>
  )
}
