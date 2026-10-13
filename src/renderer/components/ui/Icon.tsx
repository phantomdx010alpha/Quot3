import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

/** Phosphor weights allowed by the design system: light = nav, bold = active/primary, duotone = empty states. */
export type IconWeight = 'light' | 'bold' | 'duotone'
export type IconSize = 'sm' | 'md' | 'lg'

export interface IconProps {
  icon: PhosphorIcon
  weight?: IconWeight
  size?: IconSize
  className?: string
}

/** The single way to render an icon: size comes from tokens (CSS), colour from currentColor. */
export function Icon({ icon: Glyph, weight = 'light', size = 'md', className }: IconProps): React.JSX.Element {
  const cls = ['q3-icon', size !== 'md' ? `q3-icon--${size}` : '', className ?? ''].filter(Boolean).join(' ')
  return <Glyph className={cls} weight={weight} aria-hidden="true" focusable="false" />
}
