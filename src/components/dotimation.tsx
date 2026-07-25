'use client'

import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { JITTER_AMOUNT } from '@/engine/constants'
import { createEngine, type Engine } from '@/engine/engine'
import { createField, reconcile, snapField } from '@/engine/field'
import { selectBackend } from '@/engine/select'
import { useFieldTargets } from '@/hooks/use-field-targets'
import { useFontEpoch } from '@/hooks/use-font-epoch'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import type {
  AnimateItem,
  BackendKind,
  DotimationStats,
  FieldTargets,
  IdleBehavior,
  ParticleField,
} from '@/types'
import { useIsomorphicLayoutEffect } from '@/utils/isomorphic-layout-effect'
import { getDpr, sizeCanvas } from '@/utils/utils'

type DotimationProps = {
  item: AnimateItem
  width: number
  height: number
  /** React 19 ref to the underlying canvas element. */
  ref?: React.Ref<HTMLCanvasElement>
  /** @deprecated Pass `ref` instead (React 19 forwards it as a regular prop). */
  canvasRef?: React.RefObject<HTMLCanvasElement>
  /**
   * Accessible name for the canvas (rendered with role="img"). Defaults to the
   * text content for text items; supply one for image items.
   */
  ariaLabel?: string
  className?: string
  style?: Omit<React.CSSProperties, 'width' | 'height'>
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** @default 128 */
  alpha?: number
  /** @default 2 */
  pointSpacingCss?: number
  /** Dot footprint in CSS px (scales with devicePixelRatio). @default 1 */
  dotSize?: number
  /** @default 'auto' */
  backend?: BackendKind
  /** @default 'sleep' */
  idle?: IdleBehavior
  /** @default unbounded */
  maxParticles?: number
  /** Density cap for the canvas backing store (devicePixelRatio is clamped to this). @default 2 */
  maxDpr?: number
  /**
   * Force reduced-motion behavior (morphs snap, no shimmer) on or off. Omit to
   * follow the OS prefers-reduced-motion setting — pass this when your app has
   * its own motion preference.
   */
  reducedMotion?: boolean
  onStats?: (stats: DotimationStats) => void
}

export default function Dotimation({
  item,
  width,
  height,
  ref: forwardedRef,
  className,
  canvasRef,
  ariaLabel,
  style,
  defaultFontFamily = 'sans-serif',
  alpha = 128,
  pointSpacingCss = 2,
  dotSize = 1,
  backend = 'auto',
  idle = 'sleep',
  maxParticles = Number.POSITIVE_INFINITY,
  maxDpr = 2,
  reducedMotion,
  onStats,
}: DotimationProps): React.ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const fieldRef = useRef<ParticleField>(createField(1024))
  const targetsRef = useRef<FieldTargets | null>(null)
  const kindRef = useRef<DotimationStats['backend']>('canvas2d')
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  // dotSize is read at draw time, so it can update live without recreating the
  // engine. The creation effect reads it through this ref to avoid listing it
  // as a dependency (which would tear down the engine and reset the field).
  const dotSizeRef = useRef(dotSize)
  dotSizeRef.current = dotSize
  // idle only affects loop policy, so push it to the live engine instead of
  // recreating it (which would tear down the backend — on WebGPU a full
  // device re-acquisition). Same ref pattern as dotSize.
  const idleRef = useRef(idle)
  idleRef.current = idle
  // Latest size, readable by the creation effect without being a dependency —
  // size changes are applied live via engine.resize, never by recreation.
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  // Bumped when devicePixelRatio changes (zoom, monitor move) so the engine
  // and rasterization re-key at the new density instead of rendering blurry.
  const [dprEpoch, setDprEpoch] = useState(0)
  // Under reduced motion, morphs snap to their end state (opacity-only
  // changes) and the shimmer jitter is disabled. The prop, when set, overrides
  // the OS media query. A live flip recreates the engine (rare event) so the
  // jitter setting takes effect.
  const systemReducedMotion = useReducedMotion()
  const reduced = reducedMotion ?? systemReducedMotion
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  useImperativeHandle(forwardedRef, () => ref.current!)
  useImperativeHandle(canvasRef, () => ref.current!)

  const fontEpoch = useFontEpoch(item, defaultFontFamily)
  const targets = useFieldTargets(
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
    maxDpr,
    dprEpoch,
    fontEpoch,
  )

  // Watch for devicePixelRatio changes. The media query matches only the
  // current ratio, so it must be re-armed after every change (hence dprEpoch
  // in the deps).
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): the effect reads devicePixelRatio, which changed exactly when dprEpoch was bumped — the dep re-arms the one-shot media query
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onChange = (): void => setDprEpoch((e) => e + 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dprEpoch])

  // Size the canvas backing store before paint. This is the ONLY writer of the
  // width/height ATTRIBUTES (React re-committing them in CSS px would clear the
  // canvas at the wrong size on every resize); the CSS box is declared in JSX
  // style so server-rendered HTML reserves the right space. Also notifies the
  // live engine, in place, so simulation state survives (the morph continues
  // instead of restarting).
  // biome-ignore lint/correctness/useExhaustiveDependencies(backend): a backend change remounts the canvas (see the key), and the fresh element must be sized again
  // biome-ignore lint/correctness/useExhaustiveDependencies(reduced): same — it participates in the canvas key
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): sizeCanvas reads devicePixelRatio, which changed exactly when dprEpoch was bumped
  useIsomorphicLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const prevW = canvas.width
    const prevH = canvas.height
    sizeCanvas(canvas, width, height, getDpr(maxDpr))
    if (canvas.width !== prevW || canvas.height !== prevH) {
      engineRef.current?.resize(canvas.width, canvas.height)
    }
  }, [width, height, backend, dprEpoch, reduced, maxDpr])

  // Create / recreate the engine when the backend config or device pixel
  // ratio changes. Size changes do NOT recreate it (see the resize effect).
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): sizeCanvas reads devicePixelRatio, which changed exactly when dprEpoch was bumped — the dep recreates the engine at the new density
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    let engine: Engine | null = null

    const dpr = sizeCanvas(
      canvas,
      sizeRef.current.width,
      sizeRef.current.height,
      getDpr(maxDpr),
    )

    void (async () => {
      const constructedDotSize = dotSizeRef.current
      const constructedIdle = idleRef.current
      let selected: Awaited<ReturnType<typeof selectBackend>>
      try {
        selected = await selectBackend({
          requested: backend,
          dotSize: constructedDotSize,
          jitter: reduced ? 0 : JITTER_AMOUNT,
          canvas,
          dpr,
        })
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.error(
            '[dotimation] no rendering backend could initialize',
            err,
          )
        }
        return
      }
      if (cancelled) {
        selected.backend.dispose()
        return
      }
      kindRef.current = selected.kind
      engine = createEngine({
        backend: selected.backend,
        canvas,
        dpr,
        idle: constructedIdle,
      })
      engineRef.current = engine
      // dotSize may have changed while the backend was initializing; the
      // setDotSize effect ran against a null engineRef and was dropped.
      if (dotSizeRef.current !== constructedDotSize) {
        engine.setDotSize(dotSizeRef.current)
      }
      // Likewise idle; its effect was likewise dropped.
      if (idleRef.current !== constructedIdle) {
        engine.setIdle(idleRef.current)
      }
      // So may the size; the resize effect was likewise dropped.
      const { width: w, height: h } = sizeRef.current
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        sizeCanvas(canvas, w, h, dpr)
        engine.resize(canvas.width, canvas.height)
      }
      fieldRef.current = createField(1024)
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        if (reduced) snapField(fieldRef.current)
        engine.setField(fieldRef.current, reduced)
      }
      onStatsRef.current?.({
        backend: selected.kind,
        particles: fieldRef.current.active,
      })
    })()

    return () => {
      cancelled = true
      engine?.dispose()
      engineRef.current = null
    }
    // maxDpr changes density, which backends bake into dot footprints at init.
  }, [backend, dprEpoch, reduced, maxDpr])

  // dotSize only affects draw-time rendering, so push it to the live backend
  // instead of recreating the engine (which would reset every particle).
  useEffect(() => {
    engineRef.current?.setDotSize(dotSize)
  }, [dotSize])

  // idle only affects loop policy; push it live (see idleRef above).
  useEffect(() => {
    engineRef.current?.setIdle(idle)
  }, [idle])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    // Reduced motion: complete the morph instantly (opacity-only change) and
    // force a full GPU re-upload since the field changed outside reconcile.
    const snap = reducedRef.current
    if (snap) snapField(fieldRef.current)
    engineRef.current.setField(fieldRef.current, snap)
    onStatsRef.current?.({
      backend: kindRef.current,
      particles: fieldRef.current.active,
    })
  }, [targets])

  return (
    // A canvas can only ever hold one context type ('2d' | 'webgl2' | 'webgpu')
    // for its lifetime, and a lost/disposed context cannot be reacquired on the
    // same canvas. Keying on backend + dprEpoch remounts a fresh canvas whenever
    // the engine is recreated, so each incarnation gets a clean slate.
    <canvas
      key={`${backend}:${dprEpoch}:${maxDpr}:${reduced ? 'rm' : 'm'}`}
      ref={ref}
      className={className}
      style={{ width: `${width}px`, height: `${height}px`, ...style }}
      role="img"
      aria-label={ariaLabel ?? (item.type === 'text' ? item.data : undefined)}
    />
  )
}
