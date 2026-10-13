import type { ButtonHTMLAttributes } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: PhosphorIcon
  /** Required: accessible name AND tooltip text. */
  label: string
  shortcut?: string
  active?: boolean
}

export function IconButton({ icon, label, shortcut, active, className, type = 'button', ...rest }: IconButtonProps): React.JSX.Element {
  const cls = ['q3-iconbtn', 'nm-sm', active ? 'q3-iconbtn--active' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <Tooltip label={label} {...(shortcut ? { shortcut } : {})}>
      <button type={type} className={cls} aria-label={label} aria-pressed={active} {...rest}>
        <Icon icon={icon} weight={active ? 'bold' : 'light'} />
      </button>
    </Tooltip>
  )
}
