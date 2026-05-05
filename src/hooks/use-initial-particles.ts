import { useEffect, useRef, useState } from 'react'

import type { AnimateItem, Particle } from '../types'
import { initParticles } from '../utils/utils'

export default function useInitialParticles(
  item: AnimateItem,
  width: number,
  height: number,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
): Particle[] {
  const [data, setData] = useState<Particle[]>([])
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

    const currentExecution = ++executionId.current
    initParticles(
      width,
      height,
      item,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
    ).then((data) => {
      if (currentExecution === executionId.current) {
        setData(data)
      }
    })
  }, [width, height, item, defaultFontFamily, alpha, pointSpacingCss])

  return data
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const keysA = Object.keys(a) as (keyof T)[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((k) => a[k] === b[k])
}
