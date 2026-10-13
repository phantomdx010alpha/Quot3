import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'

export interface FieldProps {
  label?: string
  hint?: string
  error?: string
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldProps {
  ref?: Ref<HTMLInputElement>
}

export function Field({ id, label, hint, error, children }: FieldProps & { id: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="q3-field">
      {label && (
        <label className="q3-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span id={`${id}-err`} className="q3-field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="q3-field__hint">
            {hint}
          </span>
        )
      )}
    </div>
  )
}

/** Inset input well. Single-line with ellipsis; full value is always reachable on focus. */
export function Input({ label, hint, error, className, id, ref, ...rest }: InputProps): React.JSX.Element {
  const auto = useId()
  const fid = id ?? auto
  const cls = ['q3-input', 'nm-inset', 'nm-sm', className ?? ''].filter(Boolean).join(' ')
  return (
    <Field id={fid} {...(label ? { label } : {})} {...(hint ? { hint } : {})} {...(error ? { error } : {})}>
      <input
        ref={ref}
        id={fid}
        className={cls}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        {...rest}
      />
    </Field>
  )
}
