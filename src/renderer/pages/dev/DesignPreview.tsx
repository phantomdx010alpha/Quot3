import { useState } from 'react'
import { ClockCounterClockwise, FilePlus, GearSix, House, Palette, Receipt, Users } from '@phosphor-icons/react'
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Icon, IconButton, Input, Kbd, Select, Surface, Tooltip, useToast } from '../../components/ui'
import { useTheme } from '../../theme/ThemeProvider'

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Surface variant="raised" className="dp-section">
      <h2 className="dp-h2">{title}</h2>
      <div className="dp-row">{children}</div>
    </Surface>
  )
}

/** /dev/design-preview — every primitive, both themes, theme reload. Dev route (Phase 3). */
export default function DesignPreview(): React.JSX.Element {
  const { themes, errors, activeId, setActive, reload } = useTheme()
  const toast = useToast()
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [text, setText] = useState('')

  return (
    <div className="dp-page">
      <header className="dp-header">
        <h1 className="dp-h1">Design preview</h1>
        <a className="dp-link" href="#/">Back</a>
      </header>

      <Section title="Theme">
        <Select
          label="Active theme"
          value={activeId}
          onChange={(e) => void setActive(e.target.value)}
          options={themes.map((t) => ({ value: t.id, label: t.builtin ? t.name : `${t.name} (custom)` }))}
        />
        <Button icon={Palette} onClick={() => void reload().then(() => toast.show('Themes reloaded', 'ok'))}>
          Reload themes
        </Button>
        {errors.length > 0 && (
          <div role="alert" className="dp-errors">
            {errors.map((e) => (
              <div key={e.file}>
                <Badge tone="danger">{e.file}</Badge> {e.message}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Buttons">
        <Button variant="primary" icon={FilePlus} shortcut="Ctrl+N">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Icon buttons and tooltips (hover or Tab to focus)">
        <IconButton icon={House} label="Dashboard" shortcut="Ctrl+0" />
        <IconButton icon={FilePlus} label="Create" shortcut="Ctrl+1" active />
        <IconButton icon={ClockCounterClockwise} label="History" shortcut="Ctrl+2" />
        <IconButton icon={Users} label="Customers" shortcut="Ctrl+3" />
        <IconButton icon={GearSix} label="Settings" shortcut="Ctrl+4" />
        <Tooltip label="Plain tooltip"><Button size="sm">Hover me</Button></Tooltip>
      </Section>

      <Section title="Inputs">
        <Input label="Party name" placeholder="Type a name" value={text} onChange={(e) => setText(e.target.value)} hint="Hint text" />
        <Input label="With error" defaultValue="abc" error="Something is wrong" />
        <Input label="Long value (ellipsis, full on focus)" defaultValue="An extremely long value that must never push the layout sideways or overlap its neighbours at all" />
        <Select label="Select" options={[{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }]} />
        <Input label="Disabled" disabled defaultValue="Disabled" />
      </Section>

      <Section title="Badges, keys, surfaces">
        <Badge>Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="ok">OK</Badge>
        <Badge tone="warn">Warn</Badge>
        <Badge tone="danger">Danger</Badge>
        <Badge tone="info">Info</Badge>
        <Kbd keys="Ctrl+Shift+K" />
        <Surface variant="raised" pad="sm">Raised</Surface>
        <Surface variant="inset" pad="sm">Inset</Surface>
        <Surface variant="pressed" pad="sm">Pressed</Surface>
        <Surface variant="flat" pad="sm">Flat</Surface>
      </Section>

      <Section title="Dialogs and toasts">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>Open confirm</Button>
        <Button onClick={() => toast.show('Saved. PO Q3-0001', 'ok')}>Toast ok</Button>
        <Button onClick={() => toast.show('Check the extra columns', 'warn')}>Toast warn</Button>
        <Button onClick={() => toast.show('Could not save', 'danger')}>Toast danger</Button>
        <Button onClick={() => toast.show('Heads up', 'info')}>Toast info</Button>
      </Section>

      <Section title="Empty state and icon weights">
        <EmptyState icon={Receipt} title="No bills yet" description="Create your first quotation with Ctrl+1." action={<Button variant="primary" icon={FilePlus}>Create bill</Button>} />
        <Icon icon={GearSix} weight="light" size="lg" />
        <Icon icon={GearSix} weight="bold" size="lg" />
        <Icon icon={GearSix} weight="duotone" size="lg" />
      </Section>

      <Dialog open={dialog} title="Example dialog" onClose={() => setDialog(false)} footer={<Button variant="primary" onClick={() => setDialog(false)}>Close</Button>}>
        Esc closes. Tab stays inside. Focus returns to the button that opened it.
      </Dialog>
      <ConfirmDialog open={confirm} danger title="Delete this bill?" message="This is a destructive action; Cancel is focused first." confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); toast.show('Deleted (demo)', 'warn') }} />
    </div>
  )
}
