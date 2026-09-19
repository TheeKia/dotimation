import clsx from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'

function loadOpen(title: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`dotimation-playground:section:${title}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}): React.ReactNode {
  const [open, setOpen] = useState(() => loadOpen(title, defaultOpen))
  useEffect(() => {
    try {
      localStorage.setItem(
        `dotimation-playground:section:${title}`,
        open ? '1' : '0',
      )
    } catch {
      // ignore
    }
  }, [title, open])

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{title}</span>
        <span
          className={clsx('transition-transform', open && 'rotate-90')}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 px-4 pb-3 pt-0.5">{children}</div>
      )}
    </div>
  )
}
