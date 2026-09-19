import clsx from 'clsx'

type Option<T extends string> = { label: string; value: T }

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
}): React.ReactNode {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-secondary p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded px-2 py-1 text-xs transition-colors',
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
