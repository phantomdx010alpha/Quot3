import type { ButtonHTMLAttributes } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon, type IconWeight } from './Icon'
import { Kbd } from './Kbd'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  icon?: PhosphorIcon
  iconWeight?: IconWeight
  /** Shown on the button so every action advertises its key (keyboard-first). */
  shortcut?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconWeight,
  shortcut,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const cls = ['q3-btn', `q3-btn--${variant}`, 'nm-sm', size === 'sm' ? 'q3-btn--sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon icon={icon} weight={iconWeight ?? (variant === 'primary' ? 'bold' : 'light')} size={size === 'sm' ? 'sm' : 'md'} />}
      <span className="q3-btn__label">{children}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </button>
  )
}
