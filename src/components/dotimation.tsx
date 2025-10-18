'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { animateParticles } from '../animations/fps'
import type { AnimateItem, Particle } from '../types'
import { getCtx, initParticles } from '../utils'

export default function Dotimation({
  item,
  width,
  height,
  className,
  fontFamily,
}: {
  item: AnimateItem
  width: number
  height: number
  className?: string
  fontFamily?: string
}): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const animationController = useRef<AbortController | null>(null)
  const particles = useRef<Particle[]>([])
  const intermediateParticles = useRef<Particle[]>([])
  const prevData = useRef<Particle[]>([])

  const { data: _data } = useQuery({
    queryKey: ['particles', width, height, item, fontFamily],
    queryFn: () => initParticles(width, height, item, fontFamily),
    enabled: !!item.data,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  useEffect(() => {
    if (_data) prevData.current = _data
  }, [_data])

  useEffect(() => {
    const data = _data ?? prevData.current
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
  }, [_data, width, height])

  return (
    <canvas className={className} ref={ref} width={width} height={height} />
  )
}
