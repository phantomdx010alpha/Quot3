import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { EmptyState } from '../components/ui'

/** Navigation target for pages whose real content lands in a later phase. */
export default function StubPage({ icon, title, phase }: { icon: PhosphorIcon; title: string; phase: string }): React.JSX.Element {
  return (
    <div className="q3-page">
      <h1 className="q3-page__title">{title}</h1>
      <EmptyState icon={icon} title={`${title} is coming soon`} description={`This page is built in ${phase}. Esc goes back.`} />
    </div>
  )
}
