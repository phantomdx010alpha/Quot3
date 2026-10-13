import type { HTMLAttributes } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps): React.JSX.Element {
  const cls = ['q3-badge', tone !== 'neutral' ? `q3-badge--${tone}` : '', className ?? ''].filter(Boolean).join(' ')
  return <span className={cls} {...rest} />
}
