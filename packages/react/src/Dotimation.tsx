'use client'

import { createDotimationController } from '@dotimation/core'
import { useImperativeHandle, useRef, useState } from 'react'
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect'
import type { DotimationProps } from './types'

export function Dotimation({
  ref: forwardedRef,
  className,
  style,
  ...options
}: DotimationProps): React.ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [canvasKey, setCanvasKey] = useState(0)
  const [controller] = useState(() =>
    createDotimationController({
      replaceCanvas: () => setCanvasKey((key) => key + 1),
    }),
  )

  // Check every commit so a failed raster can retry even with stable props.
  // The controller compares primitive values and owns all async invalidation.
  useIsomorphicLayoutEffect(() => {
    controller.update(options)
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies(canvasKey): each key owns a distinct canvas session
  useIsomorphicLayoutEffect(() => {
    if (canvas.current) return controller.connect(canvas.current)
  }, [controller, canvasKey])
  useImperativeHandle(forwardedRef, () => canvas.current!)

  return (
    <canvas
      key={canvasKey}
      ref={canvas}
      className={className}
      style={{
        ...style,
        width: options.fill ? '100%' : `${options.width}px`,
        height: options.fill ? '100%' : `${options.height}px`,
      }}
      role="img"
      aria-label={
        options.ariaLabel ??
        (options.item.type === 'text' ? options.item.data : undefined)
      }
    />
  )
}
