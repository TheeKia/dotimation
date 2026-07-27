'use client'

import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createEngine, type Engine } from '@/engine/engine'
import { createField, reconcile, snapField } from '@/engine/field'
import {
  type DotOptions,
  type MotionOptions,
  resolveDots,
  resolveMotion,
  toSimParams,
} from '@/engine/params'
import { selectBackend } from '@/engine/select'
import { useFieldTargets } from '@/hooks/use-field-targets'
import { useFontEpoch } from '@/hooks/use-font-epoch'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import type {
  AnimateItem,
  BackendKind,
  DotimationStats,
  FieldTargets,
  ParticleField,
} from '@/types'
import { useIsomorphicLayoutEffect } from '@/utils/isomorphic-layout-effect'
import { getDpr, sizeCanvas } from '@/utils/utils'

/** Fixed CSS-px size, or `fill` to track the parent box via ResizeObserver. */
type SizeProps =
  | { width: number; height: number; fill?: false }
  | { fill: true; width?: undefined; height?: undefined }

type DotimationProps = SizeProps & {
  item: AnimateItem
  /** React 19 ref to the underlying canvas element. */
  ref?: React.Ref<HTMLCanvasElement>
  /**
   * Accessible name for the canvas (rendered with role="img"). Defaults to the
   * text content for text items; supply one for image items.
   */
  ariaLabel?: string
  className?: string
  style?: Omit<React.CSSProperties, 'width' | 'height'>
  /** @default 'sans-serif' */
  defaultFontFamily?: string
  /** Dot field appearance/sampling. All fields optional; see DotOptions. */
  dots?: DotOptions
  /** Motion feel (jitter, settle time, damping, fade). All fields optional. */
  motion?: MotionOptions
  /** @default 'auto' */
  backend?: BackendKind
  /** Density cap for the canvas backing store (devicePixelRatio is clamped to this). @default 2 */
  maxDpr?: number
  /**
   * Force reduced-motion behavior (morphs snap, no shimmer) on or off. Omit to
   * follow the OS prefers-reduced-motion setting — pass this when your app has
   * its own motion preference.
   */
  reducedMotion?: boolean
  /**
   * How particles are assigned to the next layout's dots. 'swarm' (random
   * correspondence) reads as a chaotic cloud; 'nearest' pairs each particle
   * with a nearby destination for a calmer, directed morph. Applies from the
   * next content change. @default 'swarm'
   */
  matching?: 'swarm' | 'nearest'
  onStats?: (stats: DotimationStats) => void
}

export default function Dotimation({
  item,
  width: propWidth,
  height: propHeight,
  fill,
  ref: forwardedRef,
  className,
  ariaLabel,
  style,
  defaultFontFamily = 'sans-serif',
  dots,
  motion,
  backend = 'auto',
  maxDpr = 2,
  reducedMotion,
  matching = 'swarm',
  onStats,
}: DotimationProps): React.ReactNode {
  // Resolved to primitives here; every hook/effect below depends on the
  // primitive fields, never object identity — inline literals cost nothing.
  const d = resolveDots(dots)
  const m = resolveMotion(motion)
  // In fill mode the canvas is styled 100%/100% and its CSS content box is the
  // size authority; until the observer reports, size is 0 (renders nothing).
  const fillMode = fill === true
  const [observed, setObserved] = useState<{ w: number; h: number } | null>(
    null,
  )
  const width = fillMode ? (observed?.w ?? 0) : (propWidth ?? 0)
  const height = fillMode ? (observed?.h ?? 0) : (propHeight ?? 0)
  const ref = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const fieldRef = useRef<ParticleField>(createField(1024))
  const targetsRef = useRef<FieldTargets | null>(null)
  const kindRef = useRef<DotimationStats['backend']>('canvas2d')
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
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
  // Sim params are read at step/draw time, so they update live without
  // recreating the engine. The creation effect reads them through this ref to
  // avoid listing them as dependencies (which would tear down the engine and
  // reset the field).
  const simParams = toSimParams(m, d.size, reduced)
  const simParamsRef = useRef(simParams)
  simParamsRef.current = simParams
  // Read at reconcile time; a change applies from the next content change.
  const matchingRef = useRef(matching)
  matchingRef.current = matching

  useImperativeHandle(forwardedRef, () => ref.current!)

  // Fill mode: track the canvas's CSS content box. Deps mirror the canvas key
  // so a remounted element is re-observed. No feedback loop: the observer
  // reacts to CSS size, and this component only writes the backing-store
  // attributes (the CSS box stays 100%/100%).
  // biome-ignore lint/correctness/useExhaustiveDependencies(backend): participates in the canvas key — a remounted element must be re-observed
  // biome-ignore lint/correctness/useExhaustiveDependencies(dprEpoch): same
  // biome-ignore lint/correctness/useExhaustiveDependencies(maxDpr): same
  // biome-ignore lint/correctness/useExhaustiveDependencies(reduced): same
  useEffect(() => {
    if (!fillMode) return
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      setObserved((prev) =>
        prev && prev.w === w && prev.h === h ? prev : { w, h },
      )
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [fillMode, backend, dprEpoch, maxDpr, reduced])

  const fontEpoch = useFontEpoch(item, defaultFontFamily)
  const targets = useFieldTargets(
    item,
    width,
    height,
    defaultFontFamily,
    d.threshold,
    d.spacing,
    d.max,
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
      let selected: Awaited<ReturnType<typeof selectBackend>>
      try {
        selected = await selectBackend({
          requested: backend,
          params: simParamsRef.current,
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
        params: simParamsRef.current,
      })
      engineRef.current = engine
      // Params may have changed while the backend was initializing; the live
      // effect ran against a null engineRef and was dropped. Re-applying is cheap.
      engine.setParams(simParamsRef.current)
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
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current, {
          matching: matchingRef.current === 'nearest' ? 'spatial' : 'index',
        })
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

  // Motion/dot-size changes are pushed to the live engine — never a recreation.
  // Deps are the resolved primitives, not `d`/`m` object identity or
  // simParamsRef, so each field (not the whole `m`/`d` object) is read here —
  // matching the dependency list exactly.
  useEffect(() => {
    engineRef.current?.setParams(
      toSimParams(
        {
          jitter: m.jitter,
          settleTime: m.settleTime,
          damping: m.damping,
          fade: m.fade,
        },
        d.size,
        reduced,
      ),
    )
  }, [d.size, m.jitter, m.settleTime, m.damping, m.fade, reduced])

  // Push new targets into the live field whenever rasterization produces them.
  useEffect(() => {
    targetsRef.current = targets
    if (!targets || !engineRef.current) return
    fieldRef.current = reconcile(fieldRef.current, targets, {
      matching: matchingRef.current === 'nearest' ? 'spatial' : 'index',
    })
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
      style={
        fillMode
          ? { width: '100%', height: '100%', ...style }
          : { width: `${width}px`, height: `${height}px`, ...style }
      }
      role="img"
      aria-label={ariaLabel ?? (item.type === 'text' ? item.data : undefined)}
    />
  )
}
