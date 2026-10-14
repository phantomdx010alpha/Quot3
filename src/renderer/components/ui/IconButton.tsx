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
  /** Phase 147: a short visible name next to the icon (hidden by CSS on small windows; the tooltip and aria-label stay). */
  text?: string
}

export function IconButton({ icon, label, shortcut, active, text, className, type = 'button', ...rest }: IconButtonProps): React.JSX.Element {
  const cls = ['q3-iconbtn', 'nm-sm', active ? 'q3-iconbtn--active' : '', text ? 'q3-iconbtn--named' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <Tooltip label={label} {...(shortcut ? { shortcut } : {})}>
      <button type={type} className={cls} aria-label={label} aria-pressed={active} {...rest}>
        <Icon icon={icon} weight={active ? 'bold' : 'light'} />
        {text ? <span className="q3-iconbtn__t">{text}</span> : null}
      </button>
    </Tooltip>
  )
}
