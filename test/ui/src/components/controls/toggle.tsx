import clsx from 'clsx'

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-4 rounded-full transition-transform',
          checked
            ? 'translate-x-4 bg-primary-foreground'
            : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  )
}
