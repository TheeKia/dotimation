import type { ReactNode } from 'react'

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): React.ReactNode {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {children}
      </div>
    </div>
  )
}
