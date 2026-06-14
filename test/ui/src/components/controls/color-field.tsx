const HEX = /^#[0-9a-fA-F]{6}$/

export function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.ReactNode {
  const pickerValue = HEX.test(value) ? value : '#000000'
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick color"
        className="size-6 cursor-pointer rounded border border-border bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
      />
    </div>
  )
}
