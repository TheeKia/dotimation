import { useEffect, useRef, useState } from 'react'
import { rasterize } from '@/raster/rasterize'
import type { AnimateItem, FieldTargets } from '@/types'

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}

export function useFieldTargets(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
): FieldTargets | null {
  const [targets, setTargets] = useState<FieldTargets | null>(null)
  const prevItem = useRef<AnimateItem | null>(null)
  const prevSize = useRef({ width: 0, height: 0 })
  const executionId = useRef(0)

  useEffect(() => {
    if (!item.data) return
    const itemChanged =
      !prevItem.current || !shallowEqual(prevItem.current, item)
    const sizeChanged =
      prevSize.current.width !== width || prevSize.current.height !== height
    if (!itemChanged && !sizeChanged) return
    prevItem.current = item
    prevSize.current = { width, height }
    const id = ++executionId.current
    rasterize(
      width,
      height,
      item,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
    ).then((t) => {
      if (id === executionId.current) setTargets(t)
    })
  }, [width, height, item, defaultFontFamily, alpha, pointSpacingCss])

  return targets
}
