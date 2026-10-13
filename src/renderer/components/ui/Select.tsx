import { useId, type Ref, type SelectHTMLAttributes } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Field, type FieldProps } from './Input'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>, FieldProps {
  options: readonly SelectOption[]
  ref?: Ref<HTMLSelectElement>
}

/** Native <select> (keyboard + a11y for free) styled as an inset well. */
export function Select({ options, label, hint, error, className, id, ref, ...rest }: SelectProps): React.JSX.Element {
  const auto = useId()
  const fid = id ?? auto
  const cls = ['q3-select', 'nm-inset', 'nm-sm', className ?? ''].filter(Boolean).join(' ')
  return (
    <Field id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})} {...(error ? { error } : {})}>
      <span className="q3-select-wrap">
        <select ref={ref} id={fid} className={cls} aria-invalid={error ? true : undefined} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="q3-select-caret">
          <Icon icon={CaretDown} weight="bold" size="sm" />
        </span>
      </span>
    </Field>
  )
}
