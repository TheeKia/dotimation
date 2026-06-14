import { useRef } from 'react'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function ResizeHandle({
  onResize,
  maxW,
  maxH,
}: {
  onResize: (w: number, h: number) => void
  maxW: number
  maxH: number
}): React.ReactNode {
  const ref = useRef<HTMLButtonElement>(null)

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault()
    const frame = ref.current?.parentElement
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      onResize(
        clamp(Math.round(ev.clientX - rect.left), 80, maxW),
        clamp(Math.round(ev.clientY - rect.top), 80, maxH),
      )
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Resize stage"
      onPointerDown={onPointerDown}
      className="absolute bottom-0 right-0 size-4 cursor-nwse-resize border-b-2 border-r-2 border-muted-foreground/40 transition-colors hover:border-primary"
    />
  )
}
