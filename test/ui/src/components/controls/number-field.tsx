export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
}): React.ReactNode {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? undefined : Number(raw))
      }}
      className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
