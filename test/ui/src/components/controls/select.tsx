export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}): React.ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-44 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
