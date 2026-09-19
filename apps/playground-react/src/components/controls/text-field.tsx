export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): React.ReactNode {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-44 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
