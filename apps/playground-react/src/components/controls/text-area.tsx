export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): React.ReactNode {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className="w-44 resize-y rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
