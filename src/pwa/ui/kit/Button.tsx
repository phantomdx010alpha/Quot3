import type { ReactElement, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'text'

/** The button hierarchy (Phase 190): `primary` (accent fill, ONE per screen), `secondary` (outline), `text` (no border). `label` is required, so a
 *  button always has a name; `hideLabel` keeps it as the accessible name of an icon-only button. 48 px minimum height (a token). */
export function Button(props: {
  label: string
  onClick?: () => void
  variant?: ButtonVariant
  icon?: ReactNode
  hideLabel?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
}): ReactElement {
  const variant = props.variant ?? 'secondary'
  return (
    <button type={props.type ?? 'button'} className={`q3x-btn q3x-btn-${variant}`} aria-label={props.hideLabel ? props.label : undefined} disabled={props.disabled} onClick={props.onClick}>
      {props.icon ? <span className="q3x-btn-icon" aria-hidden="true">{props.icon}</span> : null}
      {props.hideLabel ? null : <span className="q3x-btn-label">{props.label}</span>}
    </button>
  )
}
