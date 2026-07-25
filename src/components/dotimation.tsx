'use client'

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createEngine, type Engine } from '@/engine/engine'
import { createField, reconcile } from '@/engine/field'
import { selectBackend } from '@/engine/select'
import { useFieldTargets } from '@/hooks/use-field-targets'
import type {
  AnimateItem,
  BackendKind,
  DotimationStats,
  FieldTargets,
  IdleBehavior,
  ParticleField,
} from '@/types'
import { sizeCanvas } from '@/utils/utils'

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
  /** Dot footprint in CSS px (scales with devicePixelRatio). @default 1 */
  dotSize?: number
  /** @default 'auto' */
  backend?: BackendKind
  /** @default 'sleep' */
  idle?: IdleBehavior
  /** @default unbounded */
  maxParticles?: number
  onStats?: (stats: DotimationStats) => void
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
  maxParticles = Number.POSITIVE_INFINITY,
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
  // Latest size, readable by the creation effect without being a dependency —
  // size changes are applied live via engine.resize, never by recreation.
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  // Bumped when devicePixelRatio changes (zoom, monitor move) so the engine
  // and rasterization re-key at the new density instead of rendering blurry.
  const [dprEpoch, setDprEpoch] = useState(0)

  useImperativeHandle(canvasRef, () => ref.current!)

  const targets = useFieldTargets(
    item,
    width,
    height,
    defaultFontFamily,
    alpha,
    pointSpacingCss,
    maxParticles,
    dprEpoch,
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

  // Size the canvas before paint. This is the ONLY place the canvas backing
  // store is sized (the JSX deliberately carries no width/height attributes —
  // React re-committing them in CSS px would clear the canvas at the wrong
  // size on every resize). Also notifies the live engine, in place, so
  // simulation state survives (the morph continues instead of restarting).
  // biome-ignore lint/correctness/useExhaustiveDependencies(backend): a backend change remounts the canvas (see the key), and the fresh element must be sized again
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): sizeCanvas reads devicePixelRatio, which changed exactly when dprEpoch was bumped
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const prevW = canvas.width
    const prevH = canvas.height
    sizeCanvas(canvas, width, height)
    if (canvas.width !== prevW || canvas.height !== prevH) {
      engineRef.current?.resize(canvas.width, canvas.height)
    }
  }, [width, height, backend, dprEpoch])

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
    )

    void (async () => {
      const constructedDotSize = dotSizeRef.current
      let selected: Awaited<ReturnType<typeof selectBackend>>
      try {
        selected = await selectBackend({
          requested: backend,
          dotSize: constructedDotSize,
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
      engine = createEngine({ backend: selected.backend, canvas, dpr, idle })
      engineRef.current = engine
      // dotSize may have changed while the backend was initializing; the
      // setDotSize effect ran against a null engineRef and was dropped.
      if (dotSizeRef.current !== constructedDotSize) {
        engine.setDotSize(dotSizeRef.current)
      }
      // So may the size; the resize effect was likewise dropped.
      const { width: w, height: h } = sizeRef.current
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        sizeCanvas(canvas, w, h)
        engine.resize(canvas.width, canvas.height)
      }
      fieldRef.current = createField(1024)
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        engine.setField(fieldRef.current)
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
  }, [backend, idle, dprEpoch])

  // dotSize only affects draw-time rendering, so push it to the live backend
  // instead of recreating the engine (which would reset every particle).
  useEffect(() => {
    engineRef.current?.setDotSize(dotSize)
  }, [dotSize])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets)
    engineRef.current.setField(fieldRef.current)
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
      key={`${backend}:${dprEpoch}`}
      ref={ref}
      className={className}
      style={style}
    />
  )
}
