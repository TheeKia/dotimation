'use client'

import { type RefObject, useEffect, useImperativeHandle, useRef } from 'react'
import useInitialParticles from '@/hooks/use-initial-particles'
import { animateParticles } from '../animations/fps'
import type { AnimateItem, Particle } from '../types'
import { getCtx } from '../utils/utils'

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
}: DotimationProps): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const intermediateRef = useRef<Particle[]>([])
  const animationController = useRef<AbortController | null>(null)

  useImperativeHandle(canvasRef, () => ref.current!)

  const data = useInitialParticles(
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
  )

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !data || data.length === 0) return

    const ctx = getCtx(canvas, width, height)
    if (!ctx) return

    reconcileParticles(particlesRef, intermediateRef, data)

    const controller = new AbortController()
    animationController.current = controller
    animateParticles(
      ctx,
      canvas,
      particlesRef,
      intermediateRef,
      controller.signal,
    )

    return () => {
      controller.abort()
      animationController.current = null
    }
  }, [data, width, height])

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

/**
 * Reconciles the live particle buffer with a freshly computed target so the
 * running animation can transition smoothly between layouts.
 *
 * - Empty buffer: adopt the new array directly (no work to migrate).
 * - Growing: keep existing particles in place, then append clones seeded from
 *   the current buffer so the new particles fly in from a believable origin.
 * - Shrinking (or equal length): retarget the overlap and move the surplus
 *   into the intermediate buffer where the animation fades them out toward
 *   recycled home positions.
 *
 * All mutations happen in place.
 */
function reconcileParticles(
  particlesRef: RefObject<Particle[]>,
  intermediateRef: RefObject<Particle[]>,
  next: Particle[],
): void {
  const current = particlesRef.current
  const currentLength = current.length

  if (currentLength === 0) {
    particlesRef.current = next
    return
  }

  if (next.length > currentLength) {
    growParticles(current, next, currentLength)
    return
  }

  shrinkParticles(particlesRef, intermediateRef, next)
}

function growParticles(
  current: Particle[],
  next: Particle[],
  currentLength: number,
): void {
  for (let i = 0; i < currentLength; i++) {
    const target = current[i]
    const source = next[i]
    if (!target || !source) continue
    target.homeX = source.homeX
    target.homeY = source.homeY
    target.vx = source.vx
    target.vy = source.vy
    target.homeR = source.homeR
    target.homeG = source.homeG
    target.homeB = source.homeB
  }

  for (let i = currentLength; i <= next.length; i++) {
    const source = next[i - 1]
    const clone = structuredClone(current[(i - 1) % currentLength])
    if (!clone || !source) continue
    clone.homeX = source.homeX
    clone.homeY = source.homeY
    clone.homeR = source.homeR
    clone.homeG = source.homeG
    clone.homeB = source.homeB
    current.push(clone)
  }
}

function shrinkParticles(
  particlesRef: RefObject<Particle[]>,
  intermediateRef: RefObject<Particle[]>,
  next: Particle[],
): void {
  const current = particlesRef.current
  const nextLength = next.length

  if (current.length !== nextLength) {
    intermediateRef.current = current.slice(nextLength)
    current.length = nextLength
  }

  for (let i = 0; i < current.length; i++) {
    const target = current[i]
    const source = next[i]
    if (!target || !source) continue
    target.homeX = source.homeX
    target.homeY = source.homeY
    target.vx = source.vx
    target.vy = source.vy
    target.homeR = source.homeR
    target.homeG = source.homeG
    target.homeB = source.homeB
  }

  const intermediate = intermediateRef.current
  for (let i = 0; i < intermediate.length; i++) {
    const target = intermediate[i]
    const source = next[i % nextLength]
    if (!target || !source) continue
    target.homeX = source.homeX
    target.homeY = source.homeY
    target.homeR = source.homeR
    target.homeG = source.homeG
    target.homeB = source.homeB
  }
}
