'use client'

import { useEffect, useImperativeHandle, useRef } from 'react'
import { createEngine, type Engine } from '@/engine/engine'
import { createField, reconcile } from '@/engine/field'
import { selectBackend } from '@/engine/select'
import { useFieldTargets } from '@/hooks/use-field-targets'
import type {
  AnimateItem,
  BackendKind,
  FieldTargets,
  IdleBehavior,
  ParticleField,
} from '@/types'
import { getCtx } from '@/utils/utils'

type DotimationProps = {
  item: AnimateItem
  width: number
  height: number
  canvasRef?: React.RefObject<HTMLCanvasElement>
  className?: string
  style?: Omit<React.CSSProperties, 'width' | 'height'>
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** @default 128 */
  alpha?: number
  /** @default 2 */
  pointSpacingCss?: number
  /** @default 1 */
  dotSize?: number
  /** @default 'auto' */
  backend?: BackendKind
  /** @default 'sleep' */
  idle?: IdleBehavior
}

export default function Dotimation({
  item,
  width,
  height,
  className,
  canvasRef,
  style,
  defaultFontFamily = 'sans-serif',
  alpha = 128,
  pointSpacingCss = 2,
  dotSize = 1,
  backend = 'auto',
  idle = 'sleep',
}: DotimationProps): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const fieldRef = useRef<ParticleField>(createField(1024))
  const targetsRef = useRef<FieldTargets | null>(null)

  useImperativeHandle(canvasRef, () => ref.current!)

  const targets = useFieldTargets(
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
  )

  // Create / recreate the engine when canvas geometry or backend config changes.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = getCtx(canvas, width, height)
    if (!ctx) return
    const be = selectBackend({ requested: backend, dotSize })
    be.init(canvas, dpr)
    const engine = createEngine({ backend: be, canvas, dpr, idle })
    engineRef.current = engine
    fieldRef.current = createField(1024)
    // Seed the fresh engine with the latest targets so changing dotSize/backend
    // (which recreates the engine but not the targets) doesn't blank the canvas.
    if (targetsRef.current) {
      fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
      engine.setField(fieldRef.current)
    }
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [width, height, backend, dotSize, idle])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    engineRef.current.setField(fieldRef.current)
  }, [targets])

  return (
    <canvas
      ref={ref}
      className={className}
      width={width}
      height={height}
      style={style}
    />
  )
}
