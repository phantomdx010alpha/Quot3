/** Renders a shortcut like "Ctrl+Shift+K" as separate key caps. */
export function Kbd({ keys }: { keys: string }): React.JSX.Element {
  const parts = keys.split('+').filter(Boolean)
  return (
    <span className="q3-kbds" aria-label={keys}>
      {parts.map((p, i) => (
        <kbd key={`${p}-${i}`} className="q3-kbd">
          {p}
        </kbd>
      ))}
    </span>
  )
}
