import { useEffect, useState } from 'react'
import { ROUTES } from '@shared/routes'
import { Button, Dialog } from '../ui'
import { useRouter } from '../../router/routerStore'
import { openSettingsSection } from '../../stores/settingsStore'
import { useBackupStore } from '../../stores/backupStore'

/** Phase 50 - when the start-up `integrity_check` failed, say so once and offer the way to the backups. */
export function BackupRecoveryPrompt(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void (async () => {
      await useBackupStore.getState().load()
      const s = useBackupStore.getState().status
      if (s && !s.integrity.ok) { setMessage(s.integrity.message); setOpen(true) }
    })()
  }, [])
  if (!open) return null
  const go = (): void => { setOpen(false); openSettingsSection('backup', useRouter.getState().navigate) }
  return (
    <Dialog open title="The database may be damaged" onClose={() => setOpen(false)}
      footer={<><Button onClick={() => setOpen(false)}>Not now</Button><Button variant="primary" data-autofocus onClick={go}>Open backups</Button></>}>
      <p>The start-up check found a problem ({message}). Your bills may be incomplete. Open Backups and restore the newest backup. Nothing was changed.</p>
      <p className="q3-set__muted">Backups live in Settings ({ROUTES.settings}).</p>
    </Dialog>
  )
}
