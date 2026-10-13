import type { HTMLAttributes } from 'react'

export type SurfaceVariant = 'flat' | 'raised' | 'inset' | 'pressed'

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant
  pad?: 'none' | 'sm' | 'md' | 'lg'
}

/** Neumorphic container (chrome only — never use inside the bill grid). */
export function Surface({ variant = 'raised', pad = 'md', className, ...rest }: SurfaceProps): React.JSX.Element {
  const cls = ['q3-surface', `nm-${variant}`, pad !== 'none' ? `q3-surface--pad-${pad}` : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return <div className={cls} {...rest} />
}
