'use client'

import { useEffect, useImperativeHandle, useRef } from 'react'
import useInitialParticles from '@/hooks/use-initial-particles'
import { animateParticles } from '../animations/fps'
import type { AnimateItem, Particle } from '../types'
import { getCtx } from '../utils/utils'

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
}: {
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
}): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const animationController = useRef<AbortController | null>(null)
  const particles = useRef<Particle[]>([])
  const intermediateParticles = useRef<Particle[]>([])

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
    if (!ref.current || !data || data.length === 0) return

    const canvas = ref.current
    const ctx = getCtx(canvas, width, height)
    if (!ctx) return

    const currentLength = particles.current.length
    if (currentLength === 0) {
      particles.current = data
    } else {
      const newParticles = data
      if (newParticles.length > currentLength) {
        for (let i = 0; i < currentLength; i++) {
          const currentParticle = particles.current[i]
          const newParticle = newParticles[i]
          if (!currentParticle || !newParticle) continue
          currentParticle.homeX = newParticle.homeX
          currentParticle.homeY = newParticle.homeY
          currentParticle.vx = newParticle.vx
          currentParticle.vy = newParticle.vy
          currentParticle.homeR = newParticle.homeR
          currentParticle.homeG = newParticle.homeG
          currentParticle.homeB = newParticle.homeB
        }
        for (let i = currentLength; i <= newParticles.length; i++) {
          const p = newParticles[i - 1]
          const newParticle = structuredClone(
            particles.current[(i - 1) % currentLength],
          )
          if (!newParticle || !p) continue
          newParticle.homeX = p.homeX
          newParticle.homeY = p.homeY
          newParticle.homeR = p.homeR
          newParticle.homeG = p.homeG
          newParticle.homeB = p.homeB
          particles.current.push(newParticle)
        }
      } else {
        if (particles.current.length !== newParticles.length) {
          intermediateParticles.current = particles.current.slice(
            newParticles.length,
          )
          particles.current.length = newParticles.length
        }
        for (let i = 0; i < particles.current.length; i++) {
          const currentParticle = particles.current[i]
          const newParticle = newParticles[i]
          if (!currentParticle || !newParticle) continue
          currentParticle.homeX = newParticle.homeX
          currentParticle.homeY = newParticle.homeY
          currentParticle.vx = newParticle.vx
          currentParticle.vy = newParticle.vy
          currentParticle.homeR = newParticle.homeR
          currentParticle.homeG = newParticle.homeG
          currentParticle.homeB = newParticle.homeB
        }
        for (let i = 0; i < intermediateParticles.current.length; i++) {
          const index = i % newParticles.length
          const intermediateParticle = intermediateParticles.current[i]
          const newParticle = newParticles[index]
          if (!intermediateParticle || !newParticle) continue
          intermediateParticle.homeX = newParticle.homeX
          intermediateParticle.homeY = newParticle.homeY
          intermediateParticle.homeR = newParticle.homeR
          intermediateParticle.homeG = newParticle.homeG
          intermediateParticle.homeB = newParticle.homeB
        }
      }
    }

    // Animation
    animationController.current = new AbortController()
    animateParticles(
      ctx,
      canvas,
      particles,
      intermediateParticles,
      animationController.current.signal,
    )

    return () => {
      animationController.current?.abort()
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
