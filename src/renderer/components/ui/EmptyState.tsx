import type { ReactNode } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon } from './Icon'

export interface EmptyStateProps {
  icon: PhosphorIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="q3-empty">
      <Icon icon={icon} weight="duotone" size="lg" />
      <h3 className="q3-empty__title">{title}</h3>
      {description && <p className="q3-empty__desc">{description}</p>}
      {action}
    </div>
  )
}
