import { createEngine, type Engine } from '../engine/engine'
import { createField, reconcile, snapField } from '../engine/field'
import {
  resolveDots,
  resolveMotion,
  type SimParams,
  toSimParams,
} from '../engine/params'
import { BackendRetryError, selectBackend } from '../engine/select'
import type { BackendKind, DotimationStats, FieldTargets } from '../types'
import { getDpr, sizeCanvas } from '../utils/utils'
import {
  systemReducedMotion,
  watchDpr,
  watchFont,
  watchReducedMotion,
} from './environment'
import type { DotimationOptions } from './options'
import { createRasterScheduler, runRasterize } from './raster'

export interface ControllerHost {
  /** The framework must render a new canvas and connect it to this controller. */
  replaceCanvas(): void
}

export interface DotimationController {
  /** Supply a complete snapshot after each committed framework update. */
  update(options: DotimationOptions): void
  /** Connect after DOM commit. The returned cleanup releases this session only. */
  connect(canvas: HTMLCanvasElement): () => void
}

interface Session {
  canvas: HTMLCanvasElement
  abort: AbortController
  dpr: number
  engine: Engine | null
  kind: DotimationStats['backend']
  field: ReturnType<typeof createField>
  targets: FieldTargets | null
  params: SimParams
  reduced: boolean
  cleanups: (() => void)[]
  resizeObserver: ResizeObserver | null
  stopFont: () => void
  fontKey: string
}

/** Internal injection seam for deterministic startup/raster race tests. */
export interface RuntimeDependencies {
  select: typeof selectBackend
  engine: typeof createEngine
  rasterize: typeof runRasterize
}

const dependencies: RuntimeDependencies = {
  select: selectBackend,
  engine: createEngine,
  rasterize: runRasterize,
}

/**
 * Owns browser resources, never framework-owned DOM. Construction is SSR-safe;
 * resources exist only between connect() and its cleanup. Updates during async
 * initialization are replayed from the latest snapshot before the first upload.
 */
export function createController(
  host: ControllerHost,
  deps: RuntimeDependencies = dependencies,
): DotimationController {
  let options: DotimationOptions | null = null
  let session: Session | null = null
  let requested: BackendKind = 'auto'
  let configuration = ''
  let observed = { width: 0, height: 0 }
  let dprEpoch = 0
  let fontEpoch = 0

  const reduced = (): boolean => options?.reducedMotion ?? systemReducedMotion()
  const config = (): string =>
    `${options?.backend ?? 'auto'}:${options?.maxDpr ?? 2}:${reduced()}:${dprEpoch}`
  const params = (): SimParams =>
    toSimParams(
      resolveMotion(options?.motion),
      resolveDots(options?.dots).size,
      reduced(),
    )
  const size = (): { width: number; height: number } =>
    options?.fill
      ? observed
      : { width: options?.width ?? 0, height: options?.height ?? 0 }

  const report = (s: Session): void => {
    options?.onStats?.({ backend: s.kind, particles: s.field.active })
  }
  const upload = (s: Session, targets: FieldTargets): void => {
    s.targets = targets
    if (!s.engine) return
    s.field = reconcile(s.field, targets, {
      matching: options?.matching === 'nearest' ? 'spatial' : 'index',
    })
    if (s.reduced) snapField(s.field)
    s.engine.setField(s.field, s.reduced)
    report(s)
  }
  const raster = createRasterScheduler((targets) => {
    if (session) upload(session, targets)
  }, deps.rasterize)

  const stop = (): void => {
    const s = session
    session = null
    raster.invalidate()
    if (!s) return
    s.abort.abort()
    s.engine?.dispose()
    s.resizeObserver?.disconnect()
    s.stopFont()
    for (const cleanup of s.cleanups) cleanup()
  }

  const replace = (): void => {
    if (!session) return
    stop()
    host.replaceCanvas()
  }

  const syncSize = (s: Session): void => {
    const { width, height } = size()
    const previousWidth = s.canvas.width
    const previousHeight = s.canvas.height
    sizeCanvas(s.canvas, width, height, s.dpr)
    if (
      previousWidth !== s.canvas.width ||
      previousHeight !== s.canvas.height
    ) {
      s.engine?.resize(s.canvas.width, s.canvas.height)
    }
  }

  const syncRaster = (): void => {
    if (!session || !options) return
    const dots = resolveDots(options.dots)
    raster.update({
      item: options.item,
      ...size(),
      defaultFontFamily: options.defaultFontFamily ?? 'sans-serif',
      threshold: dots.threshold,
      spacing: dots.spacing,
      max: dots.max,
      maxDpr: options.maxDpr ?? 2,
      dprEpoch,
      fontEpoch,
    })
  }

  const syncObservers = (s: Session): void => {
    if (
      options?.fill &&
      !s.resizeObserver &&
      typeof ResizeObserver !== 'undefined'
    ) {
      s.resizeObserver = new ResizeObserver((entries) => {
        if (session !== s) return
        const rect = entries[0]?.contentRect
        if (!rect) return
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)
        if (observed.width === width && observed.height === height) return
        observed = { width, height }
        syncSize(s)
        syncRaster()
      })
      s.resizeObserver.observe(s.canvas)
    } else if (!options?.fill && s.resizeObserver) {
      s.resizeObserver.disconnect()
      s.resizeObserver = null
      observed = { width: 0, height: 0 }
    }
    if (!options) return
    const { item, defaultFontFamily = 'sans-serif' } = options
    const fontKey = JSON.stringify(
      item.type === 'text'
        ? [item.data, item.fontFamily ?? defaultFontFamily]
        : null,
    )
    if (s.fontKey === fontKey) return
    s.fontKey = fontKey
    s.stopFont()
    s.stopFont = watchFont(item, defaultFontFamily, () => {
      if (session !== s) return
      fontEpoch++
      syncRaster()
    })
  }

  const environmentChanged = (): void => {
    const next = config()
    if (next === configuration) return
    configuration = next
    requested = options?.backend ?? 'auto'
    replace()
  }

  return {
    update(next): void {
      // Copy nested inputs too: Svelte can mutate proxy-backed options in place.
      options = {
        ...next,
        item: { ...next.item },
        dots: { ...next.dots },
        motion: { ...next.motion },
      }
      environmentChanged()
      const s = session
      if (!s) return
      const nextParams = params()
      if (
        (Object.keys(nextParams) as (keyof SimParams)[]).some(
          (key) => nextParams[key] !== s.params[key],
        )
      ) {
        s.params = nextParams
        s.engine?.setParams(nextParams)
      }
      syncObservers(s)
      syncSize(s)
      syncRaster()
    },
    connect(canvas): () => void {
      if (!options)
        throw new Error('dotimation: update options before connecting a canvas')
      stop()
      observed = { width: 0, height: 0 }
      configuration = config()
      const s: Session = {
        canvas,
        abort: new AbortController(),
        dpr: getDpr(options.maxDpr),
        engine: null,
        kind: 'canvas2d',
        field: createField(1024),
        targets: null,
        params: params(),
        reduced: reduced(),
        cleanups: [],
        resizeObserver: null,
        stopFont: () => {},
        fontKey: '',
      }
      session = s
      s.cleanups.push(
        watchDpr(() => {
          dprEpoch++
          environmentChanged()
        }),
        watchReducedMotion(environmentChanged),
      )
      syncObservers(s)
      syncSize(s)
      syncRaster()
      void (async () => {
        let selected: Awaited<ReturnType<typeof selectBackend>>
        try {
          selected = await deps.select({
            requested,
            params: s.params,
            canvas,
            dpr: s.dpr,
            signal: s.abort.signal,
          })
        } catch (error) {
          if (session !== s) return
          if (error instanceof BackendRetryError) {
            requested = error.next
            replace()
          } else {
            console.error(
              '[dotimation] no rendering backend could initialize',
              error,
            )
          }
          return
        }
        if (session !== s) {
          selected.backend.dispose()
          return
        }
        s.kind = selected.kind
        s.engine = deps.engine({
          backend: selected.backend,
          canvas,
          dpr: s.dpr,
          params: s.params,
        })
        s.engine.setParams(s.params)
        syncSize(s)
        // A layout update may have already resized the canvas while init was
        // pending. The backend still needs its cached dimensions synchronized.
        s.engine.resize(canvas.width, canvas.height)
        if (s.targets) upload(s, s.targets)
        else report(s)
      })()
      return () => {
        if (session === s) stop()
      }
    },
  }
}
