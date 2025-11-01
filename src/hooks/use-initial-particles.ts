import { useEffect, useRef, useState } from 'react'

import type { AnimateItem, Particle } from '../types'
import { initParticles } from '../utils/utils'

export default function useInitialParticles(
  item: AnimateItem,
  width: number,
  height: number,
): Particle[] {
  const prevData = useRef<Particle[]>([])
  const [data, setData] = useState<Particle[] | null>(null)
  const prevItem = useRef<AnimateItem | null>(null)
  const executionId = useRef(0)

  useEffect(() => {
    if (!item.data) return

    if (prevItem.current && shallowEqual(prevItem.current, item)) return
    prevItem.current = item

    const currentExecution = ++executionId.current
    initParticles(width, height, item).then((data) => {
      if (currentExecution === executionId.current) {
        setData(data)
      }
    })
  }, [width, height, item])

  useEffect(() => {
    if (data) prevData.current = data
  }, [data])

  return data ?? prevData.current
}

function shallowEqual(obj1: AnimateItem, obj2: AnimateItem): boolean {
  const keys1 = Object.keys(obj1)
  const keys2 = Object.keys(obj2)

  if (keys1.length !== keys2.length) return false

  for (const key of keys1) {
    if (obj1[key as keyof AnimateItem] !== obj2[key as keyof AnimateItem])
      return false
  }

  return true
}
