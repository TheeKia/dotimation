import { useEffect, useRef, useState } from 'react'

type Size = { width: number; height: number }

/** Tracks an element's content-box size via ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  Size,
] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.round(width), height: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}
